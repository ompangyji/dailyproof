# 회고: GitOps 드리프트 해소 — git이 아는 태그에 실제 코드를 담다

보안 알림 데모를 위해 `kubectl set image`로 새 이미지(`:sec`)를 박았더니, live 클러스터가 git/helm이 아는 상태(`:staging`)와 어긋났다. 이 드리프트를 그대로 두면 다음 `helm upgrade`/ArgoCD sync가 `:staging`(보안 코드 없음)으로 되돌려 monitoring이 깨진다. "git = live"가 성립하도록 정리한 기록.

## 무엇이 어긋나 있었나

| | 값 |
|---|---|
| helm/git이 아는 태그 | `image.web.tag: staging` |
| 실제 떠 있던 pod | `dailyproof-web:sec` (`kubectl set image`로 박은 명령형 변경) |
| `:staging` 이미지 내용 | 보안 계측(65-a) 코드 **이전** 빌드 |

→ 진실의 원천(git)과 live가 다르다. `:sec`은 git 밖이라, 다음 동기화에 사라질 시한폭탄.

## "다시 살아나는" 두 경로 — 둘 다 git/매니페스트 기준

드리프트가 왜 위험한지는 "무엇이 무엇을 되살리나"를 보면 분명하다.

- **pod가 죽으면 → k8s Deployment가 되살린다.** helm은 Deployment를 *만들어줄* 뿐, 죽은 pod를 다시 띄우는 건 k8s다. 이때 *Deployment에 적힌 이미지*로 부활한다.
- **클러스터를 새로 구성하면 → helm + git이 되살린다.** "무엇을 배포하나"의 설계도가 차트+values(git)다.

둘 다 **"매니페스트에 적힌 대로"** 살아난다. 그래서 git 밖에서 손댄 `:sec`은 다음 sync/재구성에 사라진다 — 이게 GitOps의 "git이 source of truth" 원칙이다. (ArgoCD `selfHeal`도 같은 원리로 드리프트를 git 기준으로 되돌린다.)

## 해결 — git이 아는 태그(`:staging`)에 현재 코드를 담는다

명령형(`:sec`)을 영속시키려 하지 않고, **git이 참조하는 태그(`:staging`)를 현재 코드로 다시 만들어** git=live를 일치시켰다.

```bash
# 1) 현재 코드(보안 계측 포함)로 :staging 재빌드
docker build -f Dockerfile.web --build-arg BUILD_STANDALONE=1 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=<project-url> \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  -t dailyproof-web:staging .

# 2) k3s containerd에 import(기존 :staging 덮어씀)
docker save dailyproof-web:staging | sudo k3s ctr images import -

# 3) helm 값(:staging)으로 reconcile — 명령형 set image 제거, 선언형으로 일원화
helm upgrade dp deploy/helm/dailyproof -n dailyproof --reset-then-reuse-values --set monitoring.enabled=true

# 4) 확인
kubectl get deploy dp-dailyproof-web -n dailyproof -o jsonpath='{.spec.template.spec.containers[0].image}'
#   → dailyproof-web:staging  (helm 값과 일치)
```

**검증 결과**: 배포 이미지 `dailyproof-web:staging`(helm 값과 일치) + `/metrics`에 `dailyproof_security_events_total` 존재. 이제 `helm upgrade`나 ArgoCD sync가 돌아도 같은 `:staging`이라 monitoring이 깨지지 않는다.

## 교훈

- **드리프트는 "지금 동작하는 것"이 아니라 "다음 sync에도 동작하는가"로 본다.** `:sec`은 지금은 돌지만 git 밖이라 일회용이었다.
- **명령형 변경을 영속시키려 싸우지 말고, 선언형(git/values)에 반영한다.** 태그를 영속시키는 올바른 방법은 "그 태그의 이미지를 올바른 코드로 만드는 것" + "값으로 선언하는 것"이다.
- **태그는 포인터다.** `:staging`이라는 이름이 가리키는 *내용*이 바뀔 수 있다 → "git이 아는 태그 = 실제 배포할 코드"를 일치시키는 게 GitOps 일관성의 핵심. (장기적으로는 가변 태그 대신 커밋 SHA 등 불변 태그 + CI 자동 빌드가 더 안전 — [추후].)
