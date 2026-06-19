# Incident Log (장애 등록부)

배포·운영 중 실제로 겪은 장애를 **통일 포맷으로 요약·색인**한다. 깊은 분석은 여기 적지 않고, 상세 진단·교훈은 회고(`retrospective/...`)로, 대응 절차는 runbook(`runbooks/...`)으로 링크아웃한다. 각 장애는 증상/탐지 → 원인 → 조치 → 재발 방지 → 사용한 신호(로그/메트릭/trace) → 연결 → 자료 순으로 정리한다.

## 장애 목록

| # | 장애 | 주 신호 | 회고 | runbook |
|---|------|---------|------|---------|
| 1 | 빈 build-arg → web readiness 503 (`Unregistered API key`) | 로그·이벤트 | cicd-gitops §1 | argocd.md |
| 2 | 깨진 이미지 태그 → ImagePullBackOff → 무중단 + 복구 | 이벤트·메트릭(pod 상태) | — | rollback.md |
| 3 | `/metrics` 부하 시 ~10초 행·100% 실패 | 메트릭(k6)·로그 | metrics-load.md | runbook.md |
| 4 | CI 플레이크 — docker `npm ci` ECONNRESET (transient) | 로그(CI) | cicd-gitops §10 | — |
| 5 | PostSync smoke hook이 Ingress health에 막힘 | 이벤트·로그 | cicd-gitops §8 | argocd.md |

신호 표기: **로그**(pod/CI/smoke 로그), **메트릭**(k6 결과·pod ready 상태), **trace**(아래 장애엔 직접 추적 수단으로 쓰이진 않았고, request_id/trace_id correlation은 회고 `async-pipeline.md` 참고).

---

## 1. 빈 build-arg로 빌드된 web → readiness 503 (`Unregistered API key`)

- **증상/탐지**: ArgoCD가 차트를 Synced까지 했는데 앱이 Progressing에 멈춤. web pod가 `0/1`(NotReady), readiness probe(`/health/ready`)가 `Unregistered API key`로 계속 503. worker는 정상. pod 로그·readiness 응답 본문으로 탐지.
- **원인**: web이 readiness에서 쓰는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 Next.js가 **빌드 시점에 번들에 인라인**한다. 런타임 ConfigMap/env로 덮어써도 서버 코드는 빌드 때 박힌 값을 쓴다. 키를 rotate하자 이미지에 박힌 옛 키가 무효가 되어 readiness가 실패. (ConfigMap의 새 키로 직접 `curl` → HTTP 200 → "키가 아니라 빌드 문제"로 판별.)
- **조치**: web 이미지를 새 키로 **재빌드**(`--build-arg`) → 클러스터로 다시 import → `rollout restart` → Healthy.
- **재발 방지**: `NEXT_PUBLIC_*`는 빌드타임 값임을 문서화 — 런타임 교체가 필요하면 server를 비-public env로 읽도록 리팩터(또는 런타임 config 주입). 시크릿(service_role)은 런타임 Secret 주입이라 영향 없음을 확인.
- **사용한 신호**: 로그(pod readiness 503 본문 `Unregistered API key`) + 이벤트(ArgoCD Progressing) + 격리 테스트(curl로 키만 단독 검증).
- **연결**: [retrospective/cicd-gitops.md](../retrospective/cicd-gitops.md) §1 · [runbooks/argocd.md](../runbooks/argocd.md)
- **자료**: 별도 스샷 없음(과정 기록은 worklog).

---

## 2. 깨진 이미지 태그 → ImagePullBackOff (무중단 유지 + 복구)

- **증상/탐지**: 깨진 web 이미지 태그(`image.web.tag=broken`)로 배포하자 **새 web pod가 sustained ImagePullBackOff**. `kubectl get pods`에서 새 pod NotReady, `kubectl describe`의 Events에 `dailyproof-web:broken` pull 실패(ErrImagePull), ArgoCD가 Degraded로 표시.
- **원인**: 존재하지 않는 이미지 태그 → 레지스트리/로컬 import에서 pull 불가. 롤링 업데이트라 **옛 pod는 1/1로 계속 서비스**(readiness 게이트가 새 pod를 트래픽에서 제외) → 잘못된 배포가 서비스를 죽이지 않음.
- **조치**: `argocd app unset -p image.web.tag`(out-of-band 파라미터 제거)로 정상 태그 복구 → 깨진 pod 사라지고 web 1/1로 복귀.
- **재발 방지**: 롤백의 최저 보장선은 "직전 정상 이미지 태그로 되돌리기"로 runbook에 고정. 레지스트리 도입 시 버전 태그·자동 롤백(Argo Rollouts)은 후속.
- **사용한 신호**: 이벤트(`describe` Events의 ErrImagePull) + 메트릭/상태(`kubectl get pods`의 ready 카운트, ArgoCD Degraded). "옛 pod 1/1 유지"가 무중단의 증거.
- **연결**: [runbooks/rollback.md](../runbooks/rollback.md)
- **자료**: `110-deploy-bad-image-imagepullbackoff-20260618.png`(비정상: 새 pod ImagePullBackOff + 옛 pod 1/1) · `111-deploy-bad-image-events-20260618.png`(원인: Events ErrImagePull) · `112-deploy-recovered-healthy-20260618.png`(복구: web 1/1).

---

## 3. `/metrics` 부하 시 ~10초 행·100% 실패

- **증상/탐지**: k6 baseline에서 `metrics_read`(`/metrics`, `metrics_snapshot` RPC)가 부하 시 **20초 동안 40건만 처리, 전부 ~10.5초 타임아웃·100% 실패**. 같은 run의 `health_live`(DB 없음)는 296 rps·에러 0%. 단건 호출·배포 후 smoke는 정상. k6 메트릭과 smoke 로그로 탐지.
- **원인**: "DB 탓"으로 단정하지 않고 **3-way로 격리** — 쿼리 직접 `explain analyze` 3.6ms / REST API(개발자 머신→PostgREST) ~130ms / **앱 pod 경유 ~10s**. 느린 건 **pod ↔ Supabase 네트워크 경로**뿐. 부하 무관하게 좋은/나쁜 구간이 분 단위로 출렁(VUS=20: 통과↔70%↔100% 실패) → 로컬 WSL2/k3s 환경성 네트워크(stale keep-alive 소켓 ~10초 타임아웃)로 결론.
- **조치**: 앱 코드로 가린다 — ① TTL 캐시 + single-flight, ② fail-fast 타임아웃(AbortController 2s, 행을 10초→2초로 끊고 소켓 폐기 → 다음 호출 자가복구), ③ serve-stale(신선화 실패 시 직전 정상값 200 반환).
- **재발 방지**: 환경성 한계는 앱 코드로 "가린다"지 "없애지" 못함을 정직하게 기록 — 진짜 검증은 안정적 네트워크의 클라우드 클러스터로 미룸. k6 threshold(p95·실패율)를 run 합/불 게이트로 강제.
- **사용한 신호**: 메트릭(k6 RPS/p95/실패율, before 40건·p95 10.5s·100% → after 8,423건·p95 112ms·0%) + 로그(smoke `503 → FAIL: /metrics`).
- **연결**: [retrospective/metrics-load.md](../retrospective/metrics-load.md) · [performance/performance.md](../performance/performance.md) · [runbooks/runbook.md](../runbooks/runbook.md)
- **자료**: `129-perf-k6-baseline-run-20260618.png`(k6 첫 실행) · `130-perf-k6-baseline-result-20260618.png`(첫 baseline 결과). k6 결과 원본은 `docs/performance/results/`.

---

## 4. CI 플레이크 — docker `npm ci` ECONNRESET (transient)

- **증상/탐지**: 코드 변경이 없는데 CI가 한 번씩 빨갛게 죽음. `docker build` 잡의 `npm ci`가 약 25분을 끌다 `npm error code ECONNRESET / network aborted`로 실패. 같은 커밋·같은 Dockerfile인데 **다음 실행은 그냥 통과**. (별개로 `e2e (playwright)` 잡이 미러 지연으로 11분째 멈춘 사례도 있었음.) GitHub Actions 로그로 탐지.
- **원인**: 러너 ↔ 외부 레지스트리(npm/playwright 브라우저) **네트워크의 일시 장애**. 코드·설정 문제가 아님. "같은 커밋 재실행 시 통과"가 플레이크의 결정적 증거.
- **조치**: 멈춘 run을 취소 → **Re-run**(transient 실패는 재실행이 정석).
- **재발 방지**: 재실행 기준 = "일회성이면 재실행 OK, 반복되면 덮지 말고 원인 수정". 빈도가 늘면 `npm ci --fetch-retries`/타임아웃, playwright 브라우저 캐시(`actions/cache`)로 구조적으로 줄임.
- **사용한 신호**: 로그(CI Actions 로그의 ECONNRESET, 재실행 통과 여부).
- **연결**: [retrospective/cicd-gitops.md](../retrospective/cicd-gitops.md) §10
- **자료**: `131-deploy-ci-flake-econnreset-20260618.png`(ECONNRESET 실패 화면).

---

## 5. PostSync smoke hook이 Ingress health에 막혀 안 돎

- **증상/탐지**: 배포 후 자동 smoke(ArgoCD PostSync hook) Job을 차트에 넣고 `argocd app sync` 했는데, 명령이 **hang**하고 smoke Job/pod가 **아예 안 생김**(`kubectl get pods | grep smoke` → 없음). ArgoCD Application의 `operationState.phase=Running`, message=`waiting for healthy state of …/Ingress/…-web`로 탐지.
- **원인**: ArgoCD는 **Sync 단계 리소스가 전부 Healthy가 돼야 PostSync 단계(hook)로 넘어간다.** k3s 기본 Traefik가 **Ingress에 LB status(주소)를 발행하지 않아** Ingress가 영원히 Progressing(`status.loadBalancer={}`) → Sync 단계가 안 끝남 → PostSync hook이 영원히 대기. 앞서 Ingress를 추가했을 때(그땐 hook이 없어) 드러나지 않던 잠복 부작용이 hook을 붙이자 터짐.
- **조치**: 로컬 staging에선 `values-staging.yaml`에 `ingress.enabled: false`(차트 템플릿은 유지, 실제 LB 있는 prod/클러스터에선 켬). Sync 단계가 막힘 없이 끝나 PostSync smoke가 자동 실행됨. (부수: auto-prune로 살아있던 Ingress가 자동 삭제 — GitOps 정상 동작.)
- **재발 방지**: health가 보장 안 되는 리소스(LB status 미발행 환경의 Ingress)는 환경별로 sync phase를 막을 수 있음을 인지. 대안으로 ArgoCD `resource.customizations.health…Ingress`로 Healthy 간주(클러스터 설정).
- **사용한 신호**: 이벤트/상태(ArgoCD `operationState` jsonpath, Ingress `loadBalancer` 빈 값) + 로그(`kubectl get pods`에 smoke Job 부재).
- **연결**: [retrospective/cicd-gitops.md](../retrospective/cicd-gitops.md) §8 · [runbooks/argocd.md](../runbooks/argocd.md)
- **자료**: 정상 동작 증거는 `113-deploy-postsync-smoke-ok-20260618.png`·`114-deploy-argocd-postsync-synced-main-20260618.png`(fix 후 smoke 자동 실행).

---

## 참고 — 게이트 작동 (장애 아님)

보안 hard gate가 `readOnlyRootFilesystem` 미설정(KSV-0014 HIGH)을 merge 전에 막은 건 **장애가 아니라 게이트가 의도대로 작동한 사례**다. throwaway 브랜치에서 일부러 KSV-0014를 재발시키자 trivy 게이트가 탐지 → `security` 잡 RED → merge 차단. 상세는 [security/findings-triage.md](../security/findings-triage.md) · [retrospective/security-scanning.md](../retrospective/security-scanning.md). 자료: `133-sec-hardgate-block-red-20260619.png`(게이트 차단) · `128-sec-hardgate-pass-green-20260619.png`(정상 통과).
