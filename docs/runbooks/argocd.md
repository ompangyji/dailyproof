# ArgoCD GitOps 배포

Terraform이 **push**(내가 apply→클러스터)였다면, ArgoCD는 **pull(GitOps)** — 클러스터 안 ArgoCD가 **git을 source of truth로 삼아** 차트를 끌어와 동기화한다. git에 merge되면 ArgoCD가 알아서 클러스터를 그 상태로 맞춘다(auto-sync). 둘은 다른 네임스페이스로 공존시킨다(Terraform→`dailyproof`, ArgoCD→`dailyproof-staging`).

기준: `deploy/argocd/application.yaml`(Application), `deploy/argocd/repo-secret.example.yaml`(git 크리덴셜).

---

## 1. ArgoCD 설치 (k3s)

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl -n argocd rollout status deploy/argocd-server   # 기동 대기
```

UI 접속(별도 터미널, port-forward):
```bash
kubectl -n argocd port-forward svc/argocd-server 8081:443
# → https://localhost:8081  (자체서명 인증서 경고는 무시)
# 초기 admin 비밀번호:
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d; echo
```

---

## 2. private repo 크리덴셜 등록

repo가 private이라 ArgoCD가 클론하려면 읽기 PAT가 필요하다. `repo-secret.example.yaml`을 복사해 실값을 채운다:
```bash
cp deploy/argocd/repo-secret.example.yaml deploy/argocd/repo-secret.yaml   # gitignored
#  password 에 read-only PAT 입력
kubectl apply -n argocd -f deploy/argocd/repo-secret.yaml
```

---

## 3. Application 적용 + 시크릿 주입

```bash
kubectl apply -f deploy/argocd/application.yaml          # git→클러스터 동기화 시작
```

**argocd CLI 설치 + 로그인** (시크릿 주입 전 필수 — 이게 없으면 `app set`이 `Argo CD server address unspecified`로 실패).
전제: §1의 `port-forward svc/argocd-server 8081:443`가 떠 있어야 하고, 비밀번호는 §1에서 조회한 `argocd-initial-admin-secret` 값.
```bash
# CLI 설치 (Linux; macOS는 brew install argocd)
sudo curl -sSL -o /usr/local/bin/argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo chmod +x /usr/local/bin/argocd
# 로그인 (port-forward 8081 유지된 상태)
argocd login localhost:8081 --username admin --password <초기 admin 비번> --insecure
```

시크릿은 git에 안 넣으므로(차트엔 placeholder), 실값은 **클러스터에만** 주입한다(로그인 후):
```bash
argocd app set dailyproof-staging \
  -p secrets.SUPABASE_SERVICE_ROLE_KEY=<실제 service_role> \
  -p config.NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트>.supabase.co \
  -p config.NEXT_PUBLIC_SUPABASE_ANON_KEY=<실제 anon>
argocd app sync dailyproof-staging
```
> 이 파라미터는 git이 아니라 클러스터의 Application 리소스에만 저장된다(git 깨끗). 정식 시크릿 관리(sealed-secrets/external-secrets)는 후속.

**값을 바꾼 뒤엔 떠 있는 파드에 자동 반영되지 않는다** — `kubectl -n dailyproof-staging rollout restart deploy dailyproof-staging-dailyproof-web dailyproof-staging-dailyproof-worker`로 재시작해야 반영된다(checksum 어노테이션 자동화는 후속).

> ⚠️ **`NEXT_PUBLIC_*`(예: ANON_KEY)는 런타임 주입으로 안 바뀐다** — Next.js가 빌드 시점에 번들에 박기 때문. 키를 바꿨다면 web 이미지를 재빌드해야 한다(§5 트러블슈팅 참조).

이미지는 k3s containerd에 import된 `:staging` 태그를 그대로 쓴다(레지스트리 미사용).

---

## 4. 확인

```bash
kubectl get applications -n argocd                       # SYNC=Synced, HEALTH=Healthy
kubectl get pods -n dailyproof-staging                   # web·worker Running
```
또는 ArgoCD UI에서 `dailyproof-staging` 앱의 리소스 트리(Deployment→ReplicaSet→Pod)와 Synced/Healthy 상태를 본다.

> **완료/원복 판단은 명령 exit가 아니라 상태로.** `argocd app sync`가 실패해도(`another operation in progress` 등) auto-sync가 desired로 수렴시키니, "됐다"는 `argocd app get`의 **`Synced`(원하는 revision) + `Healthy`** 로 본다. 선언형의 source of truth는 명령이 아니라 **관찰된 상태**다.

**배포 후 검증**: sync 후 `SMOKE_BASE_URL=<앱 주소> npm run smoke`로 게이트. 실패 시 `runbooks/rollback.md`로 롤백.

---

## 5. 트러블슈팅

- **`app set`이 `Argo CD server address unspecified`로 실패** → argocd CLI 미로그인. §1 port-forward(8081)를 띄운 뒤 `argocd login localhost:8081 --username admin --password <초기 비번> --insecure`.
- **web 파드가 `Unregistered API key`로 readiness 실패(앱이 Healthy 안 됨)** → web의 `/health/ready`가 쓰는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 **Next.js가 빌드 시점에 번들에 인라인**한다. `-p config...` 런타임 주입으론 서버 코드 값이 안 바뀐다. 키를 rotate/변경했다면 **web 이미지를 새 키로 재빌드**해야 한다:
  ```bash
  docker build -f Dockerfile.web \
    --build-arg NEXT_PUBLIC_SUPABASE_URL=<URL> \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<새 키> -t dailyproof-web:staging .
  docker save dailyproof-web:staging | sudo k3s ctr images import -
  kubectl -n dailyproof-staging rollout restart deploy dailyproof-staging-dailyproof-web
  ```
  키 자체가 유효한지는 `curl "<URL>/rest/v1/<table>?select=id&limit=1" -H "apikey: <키>"`가 200인지로 확인해 "빌드 문제 vs 키 문제"를 구분한다. (worker의 `SUPABASE_SERVICE_ROLE_KEY`는 NEXT_PUBLIC_이 아니라 런타임 Secret 주입이라 무관)
- **config/secret을 바꿨는데 반영 안 됨** → 떠 있는 파드는 자동 반영되지 않음. `kubectl rollout restart deploy -n dailyproof-staging`.
- **시크릿 노출 시** → Supabase에서 **새 secret key 생성 → 클러스터/빌드 값 교체 → 옛 키 삭제**(JWT secret 전체 rotate가 아님). anon(publishable)은 공개 키라 덜 민감하나, 바꾸면 위 빌드타임 함정으로 web 재빌드가 필요하다.

---

## 6. Terraform(push)과 ArgoCD(pull) 비교

| | Terraform | ArgoCD |
|---|---|---|
| 방식 | push(`terraform apply`로 내가 밀어넣음) | pull(클러스터가 git을 끌어와 맞춤) |
| source of truth | tfstate | git |
| 드리프트 | 다음 apply에서 교정 | selfHeal로 자동 교정 |
| 네임스페이스 | `dailyproof` | `dailyproof-staging` |

## 7. 후속

- **이미지 레지스트리**: 로컬 import → CI에서 ghcr 빌드/푸시 후 태그 참조([추후]).
- **시크릿 관리**: `argocd app set -p`(클러스터 저장) → sealed-secrets/external-secrets로 정식화([추후]).
- **app-of-apps / 다중 환경**: staging/prod Application 분리·일괄 관리([추후]).

참고: `runbooks/k8s-deploy.md`(차트·Terraform), `architecture/environments.md`(환경 분리).
