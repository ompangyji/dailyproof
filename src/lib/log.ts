// 구조화 로그 유틸 (JSON line) — 관측성(로그 수집·검색·상관)의 기반.
//
// 왜 구조화인가: 사람이 읽는 문자열("user x uploaded ...") 대신 JSON 한 줄로 남기면
// Loki/CloudWatch 등에서 `request_id`, `route`, `status` 같은 필드로 바로 질의·집계할 수 있다.
// 레벨은 LOG_LEVEL, 환경 라벨은 APP_ENV 환경변수를 따른다(environments.md).

type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const APP_ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? "dev";
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;

export type Fields = Record<string, unknown>;

function emit(level: Level, msg: string, fields?: Fields) {
  if (LEVELS[level] < MIN) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    env: APP_ENV,
    msg,
    ...fields,
  });
  // error/warn → stderr, 나머지 → stdout (수집기에서 스트림 분리)
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export type Logger = {
  debug: (msg: string, fields?: Fields) => void;
  info: (msg: string, fields?: Fields) => void;
  warn: (msg: string, fields?: Fields) => void;
  error: (msg: string, fields?: Fields) => void;
  /** 고정 컨텍스트(예: { request_id })를 붙인 하위 로거를 만든다. */
  with: (ctx: Fields) => Logger;
};

export function createLogger(base: Fields = {}): Logger {
  const make = (level: Level) => (msg: string, fields?: Fields) =>
    emit(level, msg, { ...base, ...fields });
  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    with: (ctx: Fields) => createLogger({ ...base, ...ctx }),
  };
}

/** 컨텍스트 없는 기본 로거. 요청 스코프에선 `log.with({ request_id })`를 쓴다. */
export const log = createLogger();
