// 외부 호출 견고화 유틸 — 무한 대기/행 방지(withTimeout), 일시 오류 재시도(withRetry).
// web/worker가 공유하는 순수 함수(외부 의존성 없음). node:test 로 결정적으로 검증한다.
// (web에서의 사용은 모듈 경계상 web/worker 공통화 단계에서 연결 — 현재는 worker가 사용.)

export class TimeoutError extends Error {
  constructor(ms, label) {
    super(`${label ?? "operation"} timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.code = "timeout";
  }
}

/**
 * fn()이 반환하는 Promise를 ms 안에 끝내지 못하면 TimeoutError로 거부한다.
 * (취소까지는 하지 않는다 — "무한정 기다리지 않는다"가 목적.)
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export function withTimeout(fn, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms, label)), ms);
    Promise.resolve()
      .then(fn)
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * fn을 최대 (1 + retries)회 시도. 실패하면 baseMs * 2^(시도-1) 만큼 쉬고 재시도,
 * 모두 실패하면 마지막 에러를 throw 한다. (지수 백오프)
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ retries?: number, baseMs?: number, label?: string }} [opts]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, { retries = 2, baseMs = 100 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      lastErr = e;
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, baseMs * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr;
}
