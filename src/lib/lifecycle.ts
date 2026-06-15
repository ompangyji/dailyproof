// 프로세스 수명주기 플래그(모듈 싱글톤).
// 종료 신호(SIGTERM)를 받으면 readiness를 떨군다 → /health/ready 가 503 →
// 오케스트레이터(k3s)가 이 인스턴스를 endpoint에서 빼서 새 트래픽을 보내지 않는다.
// 실제 in-flight drain·종료는 플랫폼이 grace period 동안 처리한다(앱은 readiness만 내림).

let shuttingDown = false;

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function beginShutdown(): void {
  shuttingDown = true;
}
