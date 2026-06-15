// 구조화 로그 유틸 — web/worker 공통 단일 구현(`lib/log.mjs`)을 재export 한다.
// web 코드는 기존처럼 `@/lib/log`에서 import 하면 되고, 실제 포맷/로직은 한 곳(lib/log.mjs)에 있다.
export { createLogger, log } from "../../lib/log.mjs";
export type { Logger, Fields } from "../../lib/log.mjs";
