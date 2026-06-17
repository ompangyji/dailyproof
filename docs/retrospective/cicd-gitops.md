# 회고 — CI/CD·GitOps 도입 트러블슈팅

CI(GitHub Actions·Jenkins)와 배포(Terraform·ArgoCD)를 붙이며 막혔던 지점과 푼 과정을 정리한다. 각 항목은 **증상 → 시도/가설 → 원인 → 해결 → 교훈** 순. (구체 작업 기록은 `worklog.md`, 절차는 `runbooks/`, 증거는 `screenshots/`.)

---

## 1. ArgoCD에서 web만 Healthy가 안 됨 — `Unregistered API key`

- **증상**: ArgoCD가 차트를 Synced까지 했는데 앱이 Progressing에 멈춤. web 파드의 readiness(`/health/ready`)가 `Unregistered API key`로 계속 실패. worker는 정상.
- **시도/가설**: ConfigMap/Secret에 키를 다시 주입하고 `rollout restart`를 반복 — 그래도 실패. 그래서 ConfigMap에 들어간 그 키로 **직접 `curl`** 을 날려봄 → **HTTP 200**(키 자체는 유효!).
- **원인**: web의 readiness가 쓰는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 **Next.js가 빌드 시점에 번들에 인라인**한다. 런타임 ConfigMap/env로 덮어써도 서버 코드는 **빌드 때 박힌 값**을 쓴다. 키를 교체하자 이미지에 박혀 있던 옛 키가 무효가 되어 readiness가 실패한 것.
- **해결**: web 이미지를 새 키로 **재빌드**(`--build-arg`) → 클러스터로 다시 import → `rollout restart` → Healthy.
- **교훈**: 런타임 설정으로는 못 바꾸는 **빌드타임 값**이 있다(`NEXT_PUBLIC_*`). "curl은 되는데 앱은 안 된다"가 **키 문제가 아니라 빌드 문제**임을 가른 결정적 단서였다. 격리 테스트(curl)로 변수를 하나씩 지워 원인을 좁히는 게 핵심.

---

## 2. 시크릿(service 키) 노출

- **증상**: 디버깅 중 service 키를 명령·대화에 그대로 노출.
- **원인**: 시크릿을 파일/터미널이 아닌 곳에 붙여넣음.
- **해결**: Supabase의 새 API key 모델대로 **새 secret key 생성 → 교체 → 노출된 키 삭제**. (JWT secret 전체를 갈아엎는 방식이 아니라, secret key 단위로 교체)
- **교훈**: 시크릿은 **파일/터미널에만**. 노출되면 "당황하지 말고" 즉시 교체. 새 키 시스템은 키 단위 revoke가 되므로 영향 범위를 좁게 가져갈 수 있다.

---

## 3. Jenkins 스테이지 — `container started but didn't run the expected command`

- **증상**: node 스테이지는 통과하는데 helm 스테이지에서 컨테이너가 즉시 죽고 빌드가 행에 걸림.
- **원인**: `alpine/helm`·`hashicorp/terraform` 이미지의 **ENTRYPOINT가 각 도구**(helm/terraform)다. Jenkins가 컨테이너를 살려두려고 실행하는 `cat`이 `helm cat`이 되어버려 즉시 종료됨.
- **해결**: 두 docker 에이전트에 **`--entrypoint=`** 로 엔트리포인트를 비워 `cat`이 그대로 돌게 함.
- **교훈**: **도구가 ENTRYPOINT인 이미지**를 CI 에이전트로 쓸 때의 함정. 에이전트로 쓸 이미지는 임의 명령(셸)을 받을 수 있어야 한다. 한 스테이지(node)는 됐는데 다른 스테이지(helm)가 죽으면, 공통(Jenkins)이 아니라 **이미지별 차이**(entrypoint)를 의심.

---

## 4. git 히스토리 꼬임

- **증상**: squash merge 커밋 메시지가 엉뚱하게 보이고, 로컬 `main`과 원격이 갈라짐(ahead/behind).
- **원인**: 원격보다 뒤처진(스테일) 로컬 `main`에서 작업, 이미 push된 커밋을 `amend`, 로컬에서 직접 `git merge`로 합침.
- **해결**: `git reset --hard origin/main`으로 원격에 맞춰 정렬. 이후 `amend`는 **push 전에만**, merge는 GitHub의 **Squash and merge 버튼**으로 통일.
- **교훈**: merge 후 항상 `pull`로 로컬을 맞춘다. **push된 커밋은 amend 금지**(force-push 유발). 로컬에서 `main`을 직접 합치지 않는다.

---

## 5. 단일 Jenkins 잡의 한계 — Multibranch Pipeline 전환

- **증상**: Jenkins 파이프라인을 처음 구성할 때 잡이 **브랜치 하나(feature 브랜치)에 고정**돼 있었다. 그래서 ① 그 브랜치를 merge 후 삭제하면 잡이 깨지고, ② 브랜치 Specifier를 `*/main`으로 바꾸면 **merge된 뒤에만** 빌드돼 "merge 전 검사(CI 게이트)" 역할을 못 했다.
- **시도/가설**: 브랜치 Specifier에 패턴(`*/feature/*` 등)을 넣어 여러 브랜치를 한 잡으로 받아볼까 → 단일 Pipeline 잡으로는 여러 브랜치/PR을 깔끔히 다루지 못함.
- **원인**: 단일-브랜치 Pipeline 잡은 본질적으로 "한 브랜치 전용"이다. 모든 브랜치/PR을 자동으로 빌드하는 CI 게이트는 **Multibranch Pipeline**이 담당한다. 발견 기준은 **"Jenkinsfile 존재"** — 그래서 Jenkinsfile을 `main`에 둬야 거기서 딴 모든 브랜치가 물려받아 자동 대상이 된다.
- **해결**: 단일 잡 → **Multibranch Pipeline** 전환. repo를 스캔해 Jenkinsfile 있는 브랜치마다 자동으로 하위 잡을 생성·빌드하고, 브랜치 삭제 시 자동 정리. 로컬 Jenkins는 localhost라 webhook이 안 닿아 **주기 스캔(polling)** 으로 자동화.
- **교훈**: CI 잡을 특정 브랜치에 박지 말 것. "Jenkinsfile 가진 브랜치 = 자동 빌드"가 실무 패턴이다. 관리형(GitHub Actions)은 PR마다 기본으로 그렇게 되지만, self-hosted(Jenkins)는 **Multibranch로 명시적으로 구성**해야 같은 효과를 낸다.

---

## 6. ArgoCD 롤백 — auto-sync·helm 파라미터가 얽힌 지점

롤백을 실제로 시연하다 "왜 안 되돌려지지?"로 헷갈린 부분. 개념을 풀어서 정리한다.

**상황**: 배포를 일부러 바꿨다가(web replicas 1→2) 이전 상태로 되돌려(rollback) 보려 했다.

**먼저 알아야 할 3가지 개념**
1. **배포 이력(revision)**: ArgoCD는 sync할 때마다 그 시점 스냅샷을 이력으로 남긴다(History and Rollback). **롤백 = 과거 스냅샷을 다시 적용**.
2. **auto-sync + selfHeal**: 평소 ArgoCD는 클러스터를 **git과 자동 일치**시킨다. 그래서 수동 롤백을 해도 곧바로 git 기준으로 **다시 끌고 와** 롤백이 안 남는다 → 수동 롤백하려면 **잠깐 auto-sync를 꺼야** 한다.
3. **git revision ≠ helm 파라미터**: 이번엔 replicas를 git이 아니라 **`argocd app set -p`(Application에 박히는 파라미터)** 로 바꿨다.

- **막힌 지점**: auto-sync를 끄고 `argocd app rollback ... 6`을 했더니 **명령은 성공("Synced", Phase Succeeded)** 인데 **replicas는 2 그대로**였다.
- **원인**: `argocd app rollback`은 **과거 git revision의 매니페스트**를 재적용한다. 그런데 replicas=2는 git이 아니라 **Application에 박힌 파라미터**라, 과거 revision을 적용해도 그 파라미터가 **그대로 살아남아** 다시 2로 렌더됐다. (롤백은 git 기준 되돌리기, param은 그 바깥.) 게다가 param만 바꾼 sync는 git commit이 같아 **새 history revision이 안 생기기도** 했다.
- **해결**: 파라미터로 준 변경은 **`argocd app unset -p web.replicas`** 로 제거해야 진짜 되돌려진다(→ web 1 복귀). 끝나면 `--sync-policy automated --self-heal --auto-prune`로 auto-sync 원복.
- **교훈**: GitOps의 "진짜 롤백" = **git을 되돌리는 것**(source of truth). `git revert` 하면 auto-sync가 알아서 이전 상태로 맞춘다(끌 필요도 없음). **`app set -p`(out-of-band 파라미터)** 는 git 밖에 살아 rollback으로 안 사라진다 — 편하지만 롤백·재현성과 어긋날 수 있다(정석은 git/secret store). **변경을 "어디에" 했느냐(git이냐 param이냐)** 에 따라 되돌리는 방법이 다르다.

**사용한 명령어 (무엇을 / 왜)** — 이 실습에서 친 순서대로

| 명령 | 무엇을 | 왜 |
|------|--------|-----|
| `argocd app set <app> --sync-policy none` | auto-sync 끄기 | 안 끄면 selfHeal이 수동 롤백을 곧바로 git 상태로 되돌려버림 |
| `argocd app set <app> -p web.replicas=2` | helm 파라미터로 replicas 2 주입 | "새(잘못된) 배포"를 흉내내 롤백 대상 만들기 |
| `argocd app sync <app>` | 변경을 클러스터에 적용 | 바꾼 desired를 실제 반영(파드 2개로) |
| `argocd app history <app>` | 배포 이력(revision ID) 조회 | 어느 revision으로 되돌릴지 ID 확인 |
| `argocd app rollback <app> <ID>` | 과거 revision 스냅샷 재적용 | 롤백(되돌리기) — 단, git revision 기준이라 param은 안 건드림 |
| `argocd app unset <app> -p web.replicas` | 넣었던 파라미터 제거 | param이 살아있으면 안 되돌려져서 → 진짜 복구(2→1) |
| `argocd app set <app> --sync-policy automated --self-heal --auto-prune` | auto-sync 원복 | 실습 끝나고 평소 자동 동기화 상태로 복귀 |
| `kubectl get pods -n <ns>` | 파드 수/상태 확인 | 변경·롤백이 실제로 먹었는지 눈으로 검증(web 1↔2) |
| `kubectl -n argocd get application <app> -o jsonpath='{.spec.syncPolicy}'` | sync 정책 확인 | auto-sync가 꺼졌나/켜졌나 확인 |

> 보안: `argocd app get`/`-o yaml`이나 helm parameters **값** 덤프는 시크릿(service 키)을 노출하니 쓰지 않는다. 상태 확인은 위처럼 **이름·정책만** 보는 명령으로.

---

## 7. "수동 시연"과 "자동화"는 다르다 — 무엇을 자동화해야 하나

롤백·배포 후 검증을 **명령어로 직접** 해보고 나서 든 의문: *"이거 자동으로 돼야 하는 거 아냐?"* — 맞다. 그 깨달음을 정리한다.

- **상황**: post-deploy smoke·롤백을 `npm run smoke` / `argocd app rollback` / `kubectl`로 **손으로** 시연했다. 작업 이름은 "자동화"였는데 실제론 수동이었다.
- **왜 자동이 아니었나**: 배포를 **ArgoCD(pull, GitOps)** 가 하기 때문. CI(GitHub Actions/Jenkins)가 배포하는 구조가 아니라서, "배포 후 자동 검증·롤백"은 **CI가 아니라 ArgoCD에 훅을 걸어야** 한다. 우리가 만든 건 **재료**(비-0으로 끝나는 smoke 스크립트, 롤백 절차)였지 **자동으로 엮는 wiring**이 아니었다.
- **수동 시연 ↔ 자동화 매핑**:
  - `npm run smoke` 직접 실행 → **ArgoCD PostSync hook**이 sync마다 자동 실행
  - 깨진 배포(ImagePullBackOff)를 눈으로 확인 → health/smoke가 **자동 실패 판정**
  - `argocd app rollback`로 손으로 되돌림 → **Argo Rollouts**(progressive delivery)가 실패 감지 시 **자동 롤백**
- **그래서 수동 시연은 버린 게 아니다**: 각 조각이 어떻게 동작하는지 **이해 + 증거**(정상/비정상/복구)를 만든 것이고, 자동화는 그 위에 "손 안 대도 됨"을 얹는 것이다.
- **자동화 경로(정석)**: ① ArgoCD **PostSync hook** = 배포 후 자동 smoke(실패 시 sync Degraded), ② **Argo Rollouts** = 자동 롤백(canary/blue-green + analysis). ②는 Deployment를 Rollout CRD로 바꾸고 컨트롤러를 깔아야 해 규모가 크다.
- **교훈**: 문서/작업에 "자동화"라고 적어도 **실제 트리거를 엮지 않으면 그건 수동**이다. 자동화는 **배포 방식에 맞춰** 건다(pull GitOps면 CI가 아니라 ArgoCD 훅). 그리고 "손으로 한 번 해보기 → 자동화"는 좋은 순서다 — 메커니즘을 이해해야 자동화도 제대로 건다.

---

## 전체적으로 배운 것

- **관리형 vs self-hosted의 실제 차이**를 몸으로 겪음 — 예: 로컬 Jenkins는 localhost라 GitHub webhook이 안 닿아 push 즉시 자동 빌드가 안 되고 폴링을 써야 한다. GitHub Actions는 그냥 된다.
- **디버깅 루프**: 증상 → 가설 → 변수 격리(curl로 키만 따로 검증) → 원인 규명 → 최소 수정. "되는 것과 안 되는 것의 차이"를 좁히는 게 핵심.
- 반복해서 발목 잡은 함정 세 부류: **시크릿 취급**, **빌드타임/런타임 경계**, **컨테이너 이미지(entrypoint)·git 워크플로**.

<!-- 개인 소감/다음에 다르게 할 점은 여기에 자유롭게 추가 -->
