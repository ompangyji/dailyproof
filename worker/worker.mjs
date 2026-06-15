#!/usr/bin/env node
/**
 * DailyProof 후처리 worker.
 *
 * jobs 큐(앞서 만든)를 소비하는 독립 프로세스. service_role 키로 접속해 RLS를
 * 우회하고, claim_job(FOR UPDATE SKIP LOCKED)으로 한 번에 한 job을 안전하게 선점한다.
 * 여러 worker를 띄워도 같은 job을 잡지 않는다.
 *
 * 실행: npm run worker  (= node --env-file=.env.local worker/worker.mjs, Node 20.6+)
 *   앱과 공용인 기존 .env.local(git 미추적)에 아래 한 줄만 추가하면 된다:
 *   - SUPABASE_SERVICE_ROLE_KEY   (서버 전용 시크릿! 절대 커밋 금지)
 *   URL은 이미 있는 NEXT_PUBLIC_SUPABASE_URL 을 재사용한다(아래 fallback).
 *
 * 처리: 원본 download → sha256 checksum·size·차원(PNG/JPEG) 산출 → proof_assets 채우고
 *   상태 전이 uploaded→processing→ready, job done.
 *   실패 시 지수 백오프 재시도(attempts/max_attempts·run_after), 초과 시 failed+error_code.
 *   썸네일·적극 중복차단은 후속.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { withTimeout } from "../lib/resilience.mjs";
import { createLogger } from "../lib/log.mjs";

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_IDLE_MS = Number(process.env.WORKER_POLL_IDLE_MS ?? 2000);
const RETRY_BASE_MS = Number(process.env.WORKER_RETRY_BASE_MS ?? 5000); // 지수 백오프 기준
const CALL_TIMEOUT_MS = Number(process.env.WORKER_CALL_TIMEOUT_MS ?? 10000); // 외부 호출 상한

// 공통 로거(lib/log.mjs) — web과 같은 JSON 포맷. worker_id를 기본 컨텍스트로 고정.
const WORKER_ID = `${hostname()}-${randomUUID().slice(0, 8)}`;
const log = createLogger({ worker_id: WORKER_ID });

if (!URL || !SERVICE_ROLE) {
  log.error("worker 시작 실패: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coded = (code, msg) => Object.assign(new Error(msg), { code }); // error_code 분류용

let running = true;

/** 의존성 없이 PNG/JPEG 차원만 가볍게 파싱. 그 외 포맷은 null(차원 비움). */
function imageDimensions(buf) {
  // PNG: \x89PNG 시그니처 + IHDR (width@16, height@20, big-endian)
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: 0xFFD8 ... SOFn 마커에서 높이/너비
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: buf.readUInt16BE(o + 5), width: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return { width: null, height: null };
}

/**
 * 선점한 job 처리: 원본을 받아 메타데이터를 산출하고 상태를 전이한다.
 * uploaded→processing(시작)→ready(완료). 실패 시 throw → 루프에서 로그(재시도는 후속).
 */
async function processJob(job) {
  // 자산을 먼저 조회(trace_id 포함) → 모든 job 로그에 업로드 때 부여된 trace_id를 붙여
  // web→worker 흐름을 같은 id로 상관시킨다.
  const { data: asset, error: aErr } = await supabase
    .from("proof_assets").select("id, source_path, trace_id").eq("id", job.asset_id).single();
  if (aErr || !asset) throw coded("asset_not_found", `asset 조회 실패: ${aErr?.message ?? "not found"}`);

  const jlog = log.with({ job_id: job.id, asset_id: job.asset_id, trace_id: asset.trace_id ?? null });
  jlog.info("job 선점", { attempts: job.attempts, type: job.type });

  // 처리 중 표시
  await supabase.from("proof_assets").update({ status: "processing" }).eq("id", job.asset_id);

  const { data: blob, error: dErr } = await withTimeout(
    () => supabase.storage.from("media").download(asset.source_path),
    CALL_TIMEOUT_MS, "download",
  );
  if (dErr || !blob) throw coded("download_failed", `원본 download 실패: ${dErr?.message ?? "no data"}`);

  // 후처리(가볍게): sha256 체크섬·실제 크기·차원
  const buf = Buffer.from(await blob.arrayBuffer());
  const checksum = createHash("sha256").update(buf).digest("hex");
  const { width, height } = imageDimensions(buf);

  // 결과 반영 → ready
  const patch = { status: "ready", size_bytes: buf.length, width, height, checksum };
  if (blob.type) patch.content_type = blob.type;
  await supabase.from("proof_assets").update(patch).eq("id", job.asset_id);
  await supabase.from("jobs").update({ status: "done" }).eq("id", job.id);

  jlog.info("job 완료", {
    status: "ready", size_bytes: buf.length, width, height,
    checksum: checksum.slice(0, 12) + "…",
  });
}

/**
 * 처리 실패 분기. attempts < max_attempts면 지수 백오프로 재시도(job→pending + run_after),
 * 도달했으면 job/asset을 failed로 확정하고 error_code를 남긴다.
 * (attempts는 claim_job이 선점 시 이미 +1 해둔 값이다.)
 */
async function handleFailure(job, e) {
  const jlog = log.with({ job_id: job.id, asset_id: job.asset_id });
  const code = e.code ?? "unknown";

  if (job.attempts < job.max_attempts) {
    const delayMs = RETRY_BASE_MS * 2 ** (job.attempts - 1); // 지수 백오프
    const runAfter = new Date(Date.now() + delayMs).toISOString();
    await supabase.from("jobs").update({
      status: "pending", run_after: runAfter, last_error: e.message,
      locked_at: null, locked_by: null, // 잠금 해제 → run_after 후 재선점
    }).eq("id", job.id);
    jlog.warn("job 실패 — 재시도 예약", {
      error_code: code, error: e.message,
      attempts: job.attempts, max_attempts: job.max_attempts, retry_in_ms: delayMs,
    });
    return;
  }

  // 최대 재시도 초과 → 확정 실패 (job·asset 모두 failed, error_code 기록)
  await supabase.from("jobs").update({ status: "failed", last_error: e.message }).eq("id", job.id);
  await supabase.from("proof_assets").update({
    status: "failed", error_code: code, error_message: e.message,
  }).eq("id", job.asset_id);
  jlog.error("job 실패 — 최대 재시도 초과, failed 확정", {
    error_code: code, error: e.message, attempts: job.attempts,
  });
}

async function loop() {
  log.info("worker 시작", { poll_idle_ms: POLL_IDLE_MS });
  while (running) {
    let job;
    try {
      const { data, error } = await withTimeout(
        () => supabase.rpc("claim_job", { p_worker: WORKER_ID }),
        CALL_TIMEOUT_MS, "claim_job",
      );
      if (error) throw error;
      job = data;
    } catch (e) {
      log.error("claim_job 실패", { error: e.message });
      await sleep(POLL_IDLE_MS);
      continue;
    }

    // claim_job(RETURNS public.jobs)은 빈 큐에서 NULL을 반환하는데, PostgREST가 이를
    // "전 컬럼이 null인 한 행"으로 표현한다. 따라서 job.id 로 실제 선점 여부를 판별한다.
    if (!job || job.id == null) {
      await sleep(POLL_IDLE_MS); // 빈 큐 백오프
      continue;
    }

    try {
      await processJob(job);
    } catch (e) {
      await handleFailure(job, e);
    }
  }
  log.info("worker 종료 완료");
}

// graceful shutdown: 신호를 받으면 루프를 멈추되, 진행 중 job은 마무리되고 종료된다.
function shutdown(signal) {
  log.info("종료 신호 수신 — graceful shutdown", { signal });
  running = false;
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

loop().catch((e) => {
  log.error("worker 치명적 오류", { error: e.message });
  process.exit(1);
});
