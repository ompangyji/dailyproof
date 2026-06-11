// 요청 추적용 request_id 헬퍼.
// 미들웨어가 모든 요청에 `x-request-id`를 주입하고(없으면 생성), 응답 헤더로도 돌려준다.
// 그 ID를 로그·다운스트림에서 읽어 한 요청의 처리 흐름을 상관(correlate)할 수 있다.

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * route handler(Request 객체가 있는 곳)에서 요청 ID를 읽는다.
 * 미들웨어가 안 거치는 경로(예: /api/grass)면 새로 생성한다.
 */
export function requestIdFrom(req: Request): string {
  return req.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
}
