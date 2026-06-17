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

## 전체적으로 배운 것

- **관리형 vs self-hosted의 실제 차이**를 몸으로 겪음 — 예: 로컬 Jenkins는 localhost라 GitHub webhook이 안 닿아 push 즉시 자동 빌드가 안 되고 폴링을 써야 한다. GitHub Actions는 그냥 된다.
- **디버깅 루프**: 증상 → 가설 → 변수 격리(curl로 키만 따로 검증) → 원인 규명 → 최소 수정. "되는 것과 안 되는 것의 차이"를 좁히는 게 핵심.
- 반복해서 발목 잡은 함정 세 부류: **시크릿 취급**, **빌드타임/런타임 경계**, **컨테이너 이미지(entrypoint)·git 워크플로**.

<!-- 개인 소감/다음에 다르게 할 점은 여기에 자유롭게 추가 -->
