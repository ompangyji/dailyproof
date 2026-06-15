// 구조화 로그 유틸(JSON line) — web/worker 공통 단일 모듈. 관측성(검색·집계·상관)의 기반.
//
// JSON 한 줄로 남겨 Loki/CloudWatch 등에서 request_id·trace_id·worker_id·status 같은
// 필드로 바로 질의할 수 있다. 레벨은 LOG_LEVEL, 환경 라벨은 APP_ENV 환경변수를 따른다.
// web(TS)은 src/lib/log.ts 재export로, worker(.mjs)는 직접 import 해서 같은 포맷을 쓴다.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const APP_ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev";
const MIN = LEVELS[process.env.LOG_LEVEL ?? "info"] ?? LEVELS.info;

function emit(level, msg, fields) {
  if (LEVELS[level] < MIN) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, env: APP_ENV, msg, ...fields });
  // error/warn → stderr, 나머지 → stdout (수집기에서 스트림 분리)
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/**
 * 고정 컨텍스트(예: { request_id } / { worker_id })를 붙인 로거를 만든다.
 * @param {Record<string, unknown>} [base]
 */
export function createLogger(base = {}) {
  const make = (level) => (msg, fields) => emit(level, msg, { ...base, ...fields });
  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    /** 컨텍스트를 더 얹은 하위 로거 */
    with: (ctx) => createLogger({ ...base, ...ctx }),
  };
}

/** 컨텍스트 없는 기본 로거. 요청/작업 스코프에선 log.with({ … })를 쓴다. */
export const log = createLogger();
