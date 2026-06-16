#!/usr/bin/env node
/**
 * 로컬 스택 smoke test.
 *
 * docker compose로 띄운 스택(web·worker·jaeger)이 "살아서 트래픽을 받을 준비가 됐는지"를
 * 의존성 없이 빠르게 점검한다. 헬스/메트릭/관측 백엔드 도달을 확인하고, 하나라도 실패하면
 * 0이 아닌 코드로 종료해 CI/스크립트에서 게이트로 쓸 수 있다.
 *
 * 실행:  npm run smoke
 *   환경변수:
 *     SMOKE_BASE_URL    web 주소 (기본 http://localhost:3000)
 *     SMOKE_JAEGER_URL  Jaeger UI 주소 (기본 http://localhost:16686)
 *     SMOKE_TIMEOUT_MS  요청 타임아웃 (기본 5000)
 *
 * 업로드→worker→trace 경로는 로그인 사용자가 필요해 자동화에서 제외한다(수동 확인).
 * 여기선 그 경로의 양 끝(web 헬스/메트릭, jaeger 도달)만 본다.
 */
const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const JAEGER = (process.env.SMOKE_JAEGER_URL ?? "http://localhost:16686").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 5000);

const GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", RESET = "\x1b[0m";

async function fetchWithTimeout(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal });
    const text = await res.text();
    return { status: res.status, text };
  } finally {
    clearTimeout(t);
  }
}

/** 각 체크: { name, run() -> { ok, detail } }. 예외는 실패로 처리. */
const checks = [
  {
    name: "web /health/live = 200 {status:ok}",
    async run() {
      const { status, text } = await fetchWithTimeout(`${BASE}/health/live`);
      const ok = status === 200 && /"status"\s*:\s*"ok"/.test(text);
      return { ok, detail: `status=${status}` };
    },
  },
  {
    name: "web /health/ready = 200 (의존성 도달)",
    async run() {
      const { status, text } = await fetchWithTimeout(`${BASE}/health/ready`);
      const ok = status === 200 && /"ready"\s*:\s*true/.test(text);
      return { ok, detail: `status=${status}${ok ? "" : ` body=${text.slice(0, 120)}`}` };
    },
  },
  {
    name: "web /metrics = 200 + 게이지 노출",
    async run() {
      const { status, text } = await fetchWithTimeout(`${BASE}/metrics`);
      const hasJobs = text.includes("dailyproof_jobs_total");
      const hasLatency = text.includes("dailyproof_job_processing_seconds_avg");
      const ok = status === 200 && hasJobs && hasLatency;
      return { ok, detail: `status=${status} jobs_total=${hasJobs} processing_avg=${hasLatency}` };
    },
  },
  {
    name: "jaeger UI 도달 = 200",
    async run() {
      const { status } = await fetchWithTimeout(`${JAEGER}/`);
      return { ok: status === 200, detail: `status=${status}` };
    },
  },
];

const run = async () => {
  console.log(`smoke: BASE=${BASE} JAEGER=${JAEGER} timeout=${TIMEOUT_MS}ms\n`);
  let failed = 0;
  for (const c of checks) {
    let ok = false, detail = "";
    try {
      ({ ok, detail } = await c.run());
    } catch (e) {
      ok = false;
      detail = `error=${e.name === "AbortError" ? `timeout(${TIMEOUT_MS}ms)` : e.message}`;
    }
    if (!ok) failed++;
    const mark = ok ? `${GREEN}PASS${RESET}` : `${RED}FAIL${RESET}`;
    console.log(`  ${mark}  ${c.name}  ${DIM}${detail}${RESET}`);
  }
  console.log(`\n${failed === 0 ? GREEN + "all passed" : RED + `${failed} failed`}${RESET} (${checks.length} checks)`);
  process.exit(failed === 0 ? 0 : 1);
};

run();
