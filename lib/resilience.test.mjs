import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, withRetry, TimeoutError } from "./resilience.mjs";

test("withTimeout: 제한 안에 끝나면 결과를 반환한다", async () => {
  const v = await withTimeout(() => Promise.resolve(42), 1000);
  assert.equal(v, 42);
});

test("withTimeout: 제한을 넘기면 TimeoutError(code=timeout)로 거부한다", async () => {
  await assert.rejects(
    withTimeout(() => new Promise((r) => setTimeout(() => r("late"), 100)), 10, "db"),
    (e) => e instanceof TimeoutError && e.code === "timeout",
  );
});

test("withRetry: N번째 시도에 성공하면 그 값을 반환한다", async () => {
  let calls = 0;
  const v = await withRetry(
    () => { calls++; if (calls < 3) throw new Error("transient"); return "ok"; },
    { retries: 3, baseMs: 1 },
  );
  assert.equal(v, "ok");
  assert.equal(calls, 3);
});

test("withRetry: 모두 실패하면 마지막 에러를 throw 하고 (1+retries)회 시도한다", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(() => { calls++; throw new Error("always"); }, { retries: 2, baseMs: 1 }),
    /always/,
  );
  assert.equal(calls, 3); // 1 + 2 retries
});
