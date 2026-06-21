# Admission control (Kyverno) — 정책 강제

배포되는 워크로드가 보안 기준을 **클러스터 입구(admission)에서 강제로** 지키게 한다. CI(trivy)가 못 막는 "CI 우회 `kubectl apply`"까지 거부한다. 정책 정립 방법론은 [retrospective/policy-as-code-methodology.md](../retrospective/policy-as-code-methodology.md).

## 왜 — 예방·강제·탐지 (defense in depth)

같은 "non-root" 요구를 여러 시점에서 통제한다.

| 시점 | 도구 | 막는 것 |
|---|---|---|
| **예방(배포 전)** | trivy (CI) | PR/머지 전 매니페스트 검사 — CI를 거치면 잡힘 |
| **강제(배포 순간)** | **Kyverno (admission)** | CI를 우회한 직접 apply도 클러스터 입구에서 거부 |
| **탐지(런타임)** | Prometheus 알림 | 이상 징후 사후 관측 |

trivy는 CI에서만 본다 → CI 안 거친 apply는 통과한다. Kyverno admission은 *어떤 경로로 들어와도* 막는다.

## 정책 목록 (`deploy/kyverno/`)

근거: Pod Security Standards "restricted" + 우리 [threat-model.md](threat-model.md)의 권한 상승(EoP)·공급망 위협.

| 정책 | 강제 내용 | 근거 |
|---|---|---|
| `require-non-root` | `runAsNonRoot=true` (pod 또는 모든 컨테이너) | EoP — root 컨테이너 침해 시 영향 큼 |
| `require-ro-rootfs` | `readOnlyRootFilesystem=true` | 침해 시 디스크 변조·악성 실행 차단 |
| `require-drop-all-caps` | `capabilities.drop`에 `ALL` 포함 | 최소 권한 — 불필요한 커널 권한 제거 |
| `disallow-latest-tag` | `:latest`/태그 생략 금지 | 공급망·재현성 — 배포 내용 추적성 |

- 모두 `validationFailureAction: Enforce`(위반 차단). 단계는 Audit(관찰)에서 시작해 우리 워크로드 PASS 확인 후 Enforce로 승격했다.
- **scope/예외**: `exclude`로 시스템 네임스페이스(`kube-system`·`kyverno`·`monitoring`·`sealed-secrets`)는 제외 — 그쪽 워크로드는 root·rwfs가 많아 막으면 클러스터가 깨진다. 정책은 앱 네임스페이스(`dailyproof*`)에 적용.

## 우리 워크로드는 이미 준수

web·worker·jaeger·postsync-smoke는 securityContext(non-root·readOnly·drop ALL·seccomp)와 고정 태그를 이미 갖췄다. 그래서 Enforce로 켜도 **기존 배포는 통과**하고, **위반 pod만 거부**된다. (보안을 *먼저* 갖춰둔 것이 admission 강제로 이어진다.)

## 검증 (실측)

```bash
kubectl get clusterpolicy   # 4개 정책 Ready

# 위반 → 거부 (admission webhook denied)
kubectl run bad-latest --image=nginx:latest -n dailyproof
#   → disallow-latest-tag: ... :latest 금지
kubectl run bad-root --image=busybox:1.36 -n dailyproof -- sleep 3600
#   → require-non-root / require-drop-all-caps: ... 거부

# 정상(non-root·ro-rootfs·drop ALL·고정태그) → 통과
```
- policyreport에서 web·worker·jaeger·smoke **PASS 0 FAIL** 확인.
- 위반 pod는 `admission webhook "validate.kyverno.svc-fail" denied the request`로 생성 거부.

## 한계 / 후속

- **단일 admission controller**(replica 1) — HA 아님(데모 규모). 운영은 ≥2.
- PolicyException·이미지 서명 검증(cosign)·추가 PSS 항목은 후속.
- 실무에선 Kyverno/Gatekeeper **표준 정책 라이브러리**(PSS·CIS 기반)에서 가져와 scope만 커스터마이징하는 게 일반적 — 여기선 학습 목적으로 직접 작성했다.
