# 회고/참고: 자주 쓰는 kubectl·helm 명령

k8s/helm을 처음 다루며 실제로 쓴 명령들을 용도별로 정리. 까먹었을 때 여기만 보면 되도록.

> 공통 옵션: `-n <namespace>`(네임스페이스 지정, 없으면 `default`) · `-A`(전체 네임스페이스) · `get`(조회=안전) · `logs`(로그) · `describe`(상세 진단).

## 조회 (읽기만, 안전)

```bash
kubectl get nodes
# 클러스터(k3s)가 살아있나 + 노드 상태. STATUS=Ready면 정상.

kubectl get pods -A
# 모든 네임스페이스의 pod. STATUS=Running이면 정상.

kubectl get pods,svc,networkpolicy -n dailyproof
# 특정 네임스페이스의 pod·service·networkpolicy를 한 번에(쉼표로 여러 종류).

kubectl get ns
# 네임스페이스(앱이 격리돼 사는 공간) 목록.

kubectl get applications -A
# ArgoCD가 관리하는 앱 목록 + 동기화 상태(Synced/Healthy).
```

## helm (앱 묶음 배포 도구)

```bash
helm list -A
# 모든 네임스페이스의 helm 릴리스(배포된 앱 묶음) 목록.

helm template dp deploy/helm/dailyproof
# 차트를 '렌더'만 함(클러스터에 안 올림). 매니페스트가 제대로 생성되는지 확인.

helm lint deploy/helm/dailyproof
# 차트 문법·구조 검사.

helm upgrade dp deploy/helm/dailyproof -n dailyproof --reset-then-reuse-values
# 배포된 'dp' 릴리스를 새 차트로 업그레이드.
#   --reset-then-reuse-values = 내가 줬던 값(키 등) 유지 + 새로 생긴 설정은 차트 기본값으로 채움.
#   (--reuse-values만 쓰면 옛 값에 없던 새 키에서 nil pointer 에러가 날 수 있다.)
```

- 구조: `helm <동작> <릴리스이름> <차트경로> -n <네임스페이스>`.
- 예: `dp`=릴리스명, `deploy/helm/dailyproof`=차트경로.

## 디버깅·접속

```bash
kubectl logs deploy/dp-dailyproof-worker -n dailyproof --tail=30
# 해당 Deployment pod의 최근 로그 30줄. 에러·동작 확인.

kubectl describe pod <pod이름> -n dailyproof
# pod 상세(이벤트·실패 원인). 안 뜨거나 죽을 때 진단.

kubectl port-forward svc/jaeger 16687:16686 -n dailyproof
# 클러스터 안 서비스(jaeger UI 16686)를 내 PC 포트(16687)로 연결.
#   → 브라우저 http://localhost:16687 접속. Ctrl+C로 종료.
#   형식: <로컬포트>:<컨테이너포트>
```

## 외워두면 좋은 3패턴

| 하고 싶은 것 | 명령 |
|---|---|
| 뭐가 떠있나 | `kubectl get pods -n <ns>` |
| 로그 보기 | `kubectl logs deploy/<이름> -n <ns> --tail=30` |
| UI 접속 | `kubectl port-forward svc/<서비스> <로컬포트>:<원래포트> -n <ns>` |

## 주의 (보안)

- `helm get values <릴리스>` 는 **시크릿(service_role 키 등)을 평문 출력**한다 → 화면 공유·기록 시 노출 위험. 꼭 필요할 때만, 노출 시 키 회전.
- `kubectl port-forward`로 jaeger UI를 여는 건 로컬 임시 접속이라 안전(공개 ingress와 다름).
