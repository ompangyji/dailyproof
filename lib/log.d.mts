// lib/log.mjs 의 타입 선언 (TS 소비자용).
export type Fields = Record<string, unknown>;

export type Logger = {
  debug: (msg: string, fields?: Fields) => void;
  info: (msg: string, fields?: Fields) => void;
  warn: (msg: string, fields?: Fields) => void;
  error: (msg: string, fields?: Fields) => void;
  with: (ctx: Fields) => Logger;
};

export function createLogger(base?: Fields): Logger;
export const log: Logger;
