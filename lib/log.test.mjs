import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./log.mjs";

// console.log/error 출력(JSON 한 줄)을 가로채 파싱한다.
function capture(fn) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (l) => lines.push(l);
  console.error = (l) => lines.push(l);
  try { fn(); } finally { console.log = origLog; console.error = origErr; }
  return lines.map((l) => JSON.parse(l));
}

test("createLogger: JSON 한 줄에 ts/level/env/msg + 컨텍스트 포함", () => {
  const [rec] = capture(() => createLogger({ worker_id: "w1" }).info("hello", { job_id: "j1" }));
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "hello");
  assert.equal(rec.worker_id, "w1"); // 기본 컨텍스트
  assert.equal(rec.job_id, "j1");    // 호출 시 필드
  assert.ok(rec.ts && rec.env);
});

test("with(): 컨텍스트를 누적한다", () => {
  const [rec] = capture(() => createLogger({ a: 1 }).with({ b: 2 }).warn("x"));
  assert.equal(rec.level, "warn");
  assert.equal(rec.a, 1);
  assert.equal(rec.b, 2);
});
