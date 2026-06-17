# 롤백 + 배포 후 검증 (rollback / post-deploy)

배포가 잘못됐을 때 **이전 상태로 되돌리는 절차**와, 배포 직후 **자동으로 정상 여부를 점검**하는 흐름을 정리한다. 배포 메커니즘이 둘(push=Terraform, pull=ArgoCD)이라 롤백 방법도 갈린다.

기준: `scripts/smoke.mjs`, `deploy/terraform/`, `deploy/argocd/`, `deploy/helm/dailyproof/`.

---

## 1. 배포 후 검증 (post-deploy smoke)

배포(또는 sync) 직후 **반드시 smoke로 게이트**한다 — 실패하면 §2 롤백.

```bash
# 배포 대상 URL을 가리켜 실행 (ingress/host 또는 port-forward 주소)
SMOKE_BASE_URL=http://dailyproof.local npm run smoke
```
점검: `/health/live`(200·ok) · `/health/ready`(200·의존성 도달) · `/metrics`(게이지 노출) · Jaeger 도달. 하나라도 실패 시 **비-0 종료** → 배포 파이프라인/수동 절차에서 롤백 트리거로 쓴다.

**배포 후 확인 체크리스트**
- [ ] `npm run smoke` 통과(전 체크 green)
- [ ] 파드 `kubectl get pods -n <ns>` 모두 `Running`/`Ready`
- [ ] (ArgoCD) 앱 `Synced` + `Healthy`
- [ ] 핵심 화면 1개 수동 확인(업로드 등) — 자동화 밖 영역

> 자동화 지점: ArgoCD는 sync 후 위 smoke를 호출, Terraform은 apply 뒤 같은 명령을 실행해 게이트한다. (smoke가 비-0이면 다음 단계로 안 넘어감)

---

## 2. 롤백 — 메커니즘별

### A. ArgoCD (pull / GitOps)
- **UI**: 앱 → **History and Rollback** → 이전 정상 revision 선택 → **Rollback**.
- **CLI**: `argocd app history dailyproof-staging` → `argocd app rollback dailyproof-staging <revision>`.
- git이 source of truth라, **나쁜 커밋을 `git revert`** 하면 ArgoCD가 알아서 이전 상태로 재동기화(auto-sync). selfHeal이 켜져 있으면 수동 rollback은 git을 먼저 되돌려야 다시 안 끌려온다.

### B. Terraform/Helm (push)
- **이미지 태그 되돌리기(최소 흐름)**: 직전에 정상이던 태그로 values를 되돌려 재적용.
  ```bash
  # 예: values의 image.web.tag / image.worker.tag 를 직전 정상 태그로 변경 후
  terraform -chdir=deploy/terraform apply       # 또는 argocd app set -p image.web.tag=<직전 태그>
  ```
- **Helm 직접**: `helm history dp -n dailyproof` → `helm rollback dp <revision> -n dailyproof`.
  (단, 이 릴리스를 Terraform이 관리하면 helm 직접 rollback은 tfstate와 어긋날 수 있으니, **Terraform으로 되돌리는 것을 우선**한다 — 직전 커밋을 `git revert` 후 `apply`.)

### C. 공통 원칙
- **이전 이미지 태그 보존**: 롤백의 최저 보장선은 "직전 정상 이미지 태그로 되돌리기". 그래서 태그를 덮어쓰지 말고 버전 태그를 남긴다(레지스트리 도입 시 더 명확).
- 롤백 후에도 **§1 smoke로 다시 검증**.

---

## 3. 후속

- **자동 롤백**: post-deploy smoke 실패 시 파이프라인이 자동으로 직전 revision으로 rollback([추후]).
- **이미지 레지스트리 + 버전 태그**: 현재 로컬 import(:staging). 레지스트리에 불변 버전 태그를 쌓아 롤백 대상을 명확히([추후]).

참고: `runbooks/k8s-deploy.md`(배포), `runbooks/argocd.md`(GitOps), `runbooks/local-stack.md`(smoke).
