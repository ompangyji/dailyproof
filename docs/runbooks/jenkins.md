# Jenkins 파이프라인 (self-hosted CI)

GitHub Actions(`.github/workflows/ci.yml`)와 **같은 CI 검사**를 self-hosted Jenkins로도 돌려, "관리형(GitHub Actions) + 자체 호스팅(Jenkins) 양쪽으로 같은 파이프라인을 구현"함을 보인다. 파이프라인 정의는 repo의 **`Jenkinsfile`**.

| 스테이지 | 이미지(에이전트) | 검사 |
|----------|------------------|------|
| typecheck + tests | `node:22` | `npm ci` → `tsc --noEmit` → `npm test` |
| helm lint | `alpine/helm` | `helm lint` + staging/prod 렌더 |
| terraform validate | `hashicorp/terraform` | `fmt -check` → `init -backend=false` → `validate` |
| docker build | `docker:cli`(+호스트 소켓) | worker·web 이미지 빌드 |

각 스테이지는 도구가 든 컨테이너에서 돌아 Jenkins 컨트롤러에 도구를 안 깔아도 된다(컨트롤러는 Docker만 접근 가능하면 됨).

---

## 1. 로컬 Jenkins 실행 (Docker)

Jenkins가 스테이지용 컨테이너를 띄우고 이미지를 빌드하려면 **호스트 Docker 소켓 접근**이 필요하다.

```bash
docker run -d --name jenkins \
  -p 8082:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -u root \
  jenkins/jenkins:lts-jdk17

# Jenkins 컨트롤러 안에 docker CLI 설치(스테이지 docker 에이전트를 띄우기 위해)
docker exec jenkins bash -c "apt-get update -qq && apt-get install -y -qq docker.io"
```
> `-u root` + 소켓 마운트는 로컬 데모용 단순화다. 운영에선 DinD/전용 에이전트·소켓 프록시로 권한을 좁힌다([추후]).

초기 비밀번호 → 플러그인:
```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```
- 브라우저 `http://localhost:8082` → 위 비번으로 unlock → **Install suggested plugins**.
- 추가로 **Docker Pipeline** 플러그인 설치(Manage Jenkins → Plugins) — `agent { docker { ... } }` 에 필요.

---

## 2. private repo 자격증명 등록

`Jenkinsfile`을 SCM에서 가져오려면 private repo 접근용 PAT가 필요하다.
- Manage Jenkins → **Credentials** → (global) → Add Credentials → Kind: *Username with password*
- Username: GitHub 사용자명, Password: **read-only PAT**, ID: 예 `github-pat`

---

## 3. Multibranch Pipeline 잡 생성·실행

단일 브랜치에 잡을 박지 않고, **Jenkinsfile이 있는 모든 브랜치를 자동 발견·빌드**하는 Multibranch Pipeline을 쓴다 — 브랜치를 지워도 안 깨지고, merge 전 브랜치도 검사하는 pre-merge 게이트가 된다(GitHub Actions가 브랜치/PR마다 도는 것과 동일).

- New Item → 이름 입력 → **Multibranch Pipeline** → OK
- **Branch Sources** → Add source → **Git**
  - Repository URL: `https://github.com/ompangyji/dailyproof.git`, Credentials: 위 `github-pat`
- **Build Configuration**: `by Jenkinsfile`, Script Path: `Jenkinsfile` (기본)
- **Scan Multibranch Pipeline Triggers** → **Periodically if not otherwise run** → 예: 1~5분
  (로컬 Jenkins는 localhost라 GitHub webhook이 안 닿아 **주기 스캔(polling)** 으로 자동화)
- Save → repo를 스캔해 **Jenkinsfile 있는 브랜치마다 하위 잡을 자동 생성·빌드**한다.

결과: 잡 안에 브랜치 목록이 뜨고(예: `main`, `feature/*`), 각 브랜치가 **자기 Jenkinsfile로 독립 빌드**된다. 모든 스테이지 초록이면 GitHub Actions CI와 동등하게 통과한 것. (기존 단일 Pipeline 잡이 있으면 삭제)

> Jenkinsfile이 없는 브랜치는 빌드 정의가 없으므로 자동 제외된다. Jenkinsfile을 `main`에 두면 거기서 딴 모든 브랜치가 물려받아 자동 대상이 된다.

---

## 4. GitHub Actions와의 관계

| | GitHub Actions | Jenkins |
|---|---|---|
| 형태 | 관리형(SaaS) | self-hosted(직접 운영) |
| 정의 | `.github/workflows/ci.yml` | `Jenkinsfile` |
| 검사 | typecheck/test·helm·terraform·docker build | **동일**(미러링) |
| 트리거 | push/PR(자동) | Multibranch 주기 스캔(자동, 지연 有) / webhook([추후]) |
| 브랜치 커버 | 모든 브랜치·PR(기본) | Multibranch가 Jenkinsfile 있는 브랜치 자동 발견 |

같은 단계를 양쪽으로 구현해, 파이프라인 설계가 도구에 종속되지 않음을 보인다.

---

## 5. 후속

- **즉시 트리거**: 로컬은 주기 스캔(polling)으로 자동(지연 있음). push 즉시 빌드를 원하면 Jenkins를 외부에 노출(ngrok 등)해 GitHub webhook 연결([추후]).
- **권한 최소화**: 소켓 직마운트 대신 DinD·소켓 프록시·전용 에이전트([추후]).
- **배포 연계**: 빌드 후 ArgoCD가 git을 동기화(GitOps) — Jenkins는 build/test에 집중([추후]).

참고: `.github/workflows/ci.yml`(동등 CI), `runbooks/k8s-deploy.md`·`runbooks/argocd.md`(배포).
