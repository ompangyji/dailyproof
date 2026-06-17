// 성능 베이스라인 (k6). 두 시나리오를 '순차로' 돌려 대비한다.
//   ① health_live : GET /health/live        — DB 없음, 프레임워크 기준선
//   ② grass_read  : GET /api/grass/:token    — get_grass RPC + SVG 렌더, 실제 읽기 경로(DB 왕복)
// 둘을 비교해 "DB 의존이 더하는 지연"을 병목 가설로 본다.
// (동시에 돌리면 서로 부하를 간섭하므로 startTime으로 시차를 둬 순차 실행한다.)
//
// 실행:
//   k6 run -e BASE_URL=http://127.0.0.1:3000 -e GRASS_TOKEN=<공개토큰> scripts/load/baseline.js
// 옵션: -e VUS=20 -e DURATION=20s
// 결과 JSON 저장: K6_SUMMARY=docs/performance/results/<name>.json k6 run ...  (handleSummary)
//
// threshold는 "성능 기준 미달이면 run 실패"로 동작한다(초기값 — 첫 측정 뒤 조정).

import http from "k6/http";
import { check } from "k6";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

const BASE = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const TOKEN = __ENV.GRASS_TOKEN || "";
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || "20s";

export const options = {
  scenarios: {
    health_live: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      exec: "healthLive",
      startTime: "0s",
      tags: { scenario: "health_live" },
    },
    grass_read: {
      executor: "constant-vus",
      vus: VUS,
      duration: DURATION,
      exec: "grassRead",
      // health_live(DURATION) 끝난 뒤 2s 여유를 두고 시작 → 간섭 없는 순차 측정
      startTime: `${parseInt(DURATION, 10) + 2}s`,
      tags: { scenario: "grass_read" },
    },
  },
  thresholds: {
    // 순수 앱: 빠르고 에러 거의 없어야 한다
    "http_req_duration{scenario:health_live}": ["p(95)<200"],
    "http_req_failed{scenario:health_live}": ["rate<0.01"],
    // DB 경로: 더 느려도 되지만 상한과 에러율을 둔다
    "http_req_duration{scenario:grass_read}": ["p(95)<800"],
    "http_req_failed{scenario:grass_read}": ["rate<0.05"],
  },
};

export function healthLive() {
  const res = http.get(`${BASE}/health/live`, { tags: { scenario: "health_live" } });
  check(res, {
    "health_live 200": (r) => r.status === 200,
    "health_live status:ok": (r) => r.body && r.body.includes('"status":"ok"'),
  });
}

export function grassRead() {
  const res = http.get(`${BASE}/api/grass/${TOKEN}`, { tags: { scenario: "grass_read" } });
  check(res, {
    "grass_read 200": (r) => r.status === 200,
    "grass_read svg": (r) => r.body && r.body.includes("<svg"),
  });
}

// k6 기본 요약(시나리오별 percentile·threshold 합/불 포함)을 콘솔에 그대로 출력하고,
// K6_SUMMARY 지정 시 전체 메트릭을 JSON으로도 저장한다.
export function handleSummary(data) {
  const out = { stdout: textSummary(data, { indent: " ", enableColors: true }) };
  if (__ENV.K6_SUMMARY) out[__ENV.K6_SUMMARY] = JSON.stringify(data, null, 2);
  return out;
}
