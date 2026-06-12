#!/usr/bin/env node
/**
 * DailyProof 후처리 worker (골격).
 *
 * jobs 큐(Day2에서 만든)를 소비하는 독립 프로세스. service_role 키로 접속해 RLS를
 * 우회하고, claim_job(FOR UPDATE SKIP LOCKED)으로 한 번에 한 job을 안전하게 선점한다.
 * 여러 worker를 띄워도 같은 job을 잡지 않는다.
 *
 * 실행: npm run worker  (= node --env-file=.env.local worker/worker.mjs, Node 20.6+)
 *   앱과 공용인 기존 .env.local(git 미추적)에 아래 한 줄만 추가하면 된다:
 *   - SUPABASE_SERVICE_ROLE_KEY   (서버 전용 시크릿! 절대 커밋 금지)
 *   URL은 이미 있는 NEXT_PUBLIC_SUPABASE_URL 을 재사용한다(아래 fallback).
 *
 * 범위(현재 골격): 폴링 루프·선점·구조화 로그·graceful shutdown 까지.
 *   실제 후처리(원본 download·checksum·메타데이터)와 정식 상태 전이,
 *   실패 재시도/백오프/error_code는 후속 단계에서 채운다.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_IDLE_MS = Number(process.env.WORKER_POLL_IDLE_MS ?? 2000);

// --- 구조화 로거: src/lib/log.ts 와 같은 JSON 한 줄 포맷(Day5에서 공통 모듈로 통합 예정) ---
const APP_ENV = process.env.APP_ENV ?? "dev";
function emit(level, msg, fields) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, env: APP_ENV, msg, ...fields });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}
const WORKER_ID = `${hostname()}-${randomUUID().slice(0, 8)}`;
const logger = (ctx = {}) => ({
  info: (m, f) => emit("info", m, { worker_id: WORKER_ID, ...ctx, ...f }),
  warn: (m, f) => emit("warn", m, { worker_id: WORKER_ID, ...ctx, ...f }),
  error: (m, f) => emit("error", m, { worker_id: WORKER_ID, ...ctx, ...f }),
});
const log = logger();

if (!URL || !SERVICE_ROLE) {
  log.error("worker 시작 실패: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다");
  process.exit(1);
}

const supabase = createClient(URL, SERVICE_ROLE, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = true;

/**
 * 선점한 job 처리. (현재 골격: 실제 후처리 없이 상태만 전이.)
 * 후속 단계에서 원본 download·checksum·메타데이터 산출로 교체한다.
 */
async function processJob(job) {
  const jlog = logger({ job_id: job.id, asset_id: job.asset_id });
  jlog.info("job 선점", { attempts: job.attempts, type: job.type });

  // TODO(후속): media에서 원본 download → checksum/size/차원 산출 → proof_assets 채우기
  await supabase.from("proof_assets").update({ status: "ready" }).eq("id", job.asset_id);
  await supabase.from("jobs").update({ status: "done" }).eq("id", job.id);

  jlog.info("job 완료(stub)", { asset_status: "ready", job_status: "done" });
}

async function loop() {
  log.info("worker 시작", { poll_idle_ms: POLL_IDLE_MS });
  while (running) {
    let job;
    try {
      const { data, error } = await supabase.rpc("claim_job", { p_worker: WORKER_ID });
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
      // 실패 분류/재시도/백오프/error_code 는 후속 단계에서. 지금은 로그만.
      log.error("job 처리 중 오류", { job_id: job.id, error: e.message });
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
