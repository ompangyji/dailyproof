# 회고: Prometheus는 긁는데 메트릭이 없다 — 배포 이미지가 구버전

보안 이벤트 계측(`dailyproof_security_events_total`)을 kube-prometheus-stack으로 수집·알림하려는데, **Prometheus Targets는 UP인데 그 메트릭이 안 보였다.** scrape 설정을 한참 의심했지만, 진짜 원인은 **클러스터에 떠 있는 web 이미지가 계측 코드 이전 버전**이었다. "git에 머지됐다 ≠ 클러스터에서 돈다"를 새긴 기록.

## 상황

- 65-a에서 `/metrics`에 보안 카운터(`dailyproof_security_events_total{type}`)를 추가하고 로컬 dev에서 0→5 증가까지 검증했다.
- 65-b에서 ServiceMonitor/PrometheusRule/scrape NetworkPolicy를 적용하고 Prometheus가 web을 scrape하게 했다.
- 그런데 트래픽(grass 폭주)을 줘도 Prometheus에 보안 메트릭이 안 나오고 알림도 안 떴다.

## 잘못 의심한 것 (그리고 배제한 방법)

처음엔 scrape 파이프라인을 의심했다. 클러스터 쪽에서 하나씩 배제:

| 점검 | 명령 | 결과 |
|---|---|---|
| web에 살아있는 endpoint | `kubectl get endpoints dp-dailyproof-web -n dailyproof` | `10.42.0.44:3000` ✓ |
| ServiceMonitor 포트 이름 = Service 포트 이름 | `kubectl get servicemonitor … -o jsonpath='{.spec.endpoints[*].port}'` | `http` = `http` ✓ |
| monitoring ns 라벨(netpol 매칭) | `kubectl get ns monitoring -o jsonpath='{.metadata.labels}'` | `kubernetes.io/metadata.name: monitoring` ✓ |
| Prometheus의 ServiceMonitor 선택 라벨 | `kubectl get prometheus -n monitoring -o jsonpath='{…serviceMonitorSelector}'` | `release: kps` = 우리 라벨 ✓ |

→ **파이프라인은 전부 정상**이었다. Targets에도 web이 UP으로 떠 있었다.

## 진짜 원인 — 배포 이미지가 계측 코드 이전

트래픽을 클러스터 *내부*에서 직접 만들어(port-forward 불안정을 우회) `/metrics`를 직접 확인하니 답이 나왔다:

```bash
# 내부에서 web에 트래픽 + /metrics 확인 (port-forward 없이, 일회성 pod)
kubectl run sec-check --rm -i --restart=Never --image=curlimages/curl:8.11.1 -n dailyproof \
  --command -- sh -c 'curl -s "http://dp-dailyproof-web:3000/metrics"' | grep -E "security_events|jobs_total"
```
결과: `dailyproof_jobs_total`만 있고 **`dailyproof_security_events_total`이 없었다.**

```bash
kubectl get deploy dp-dailyproof-web -n dailyproof -o jsonpath='{.spec.template.spec.containers[0].image}'
# → dailyproof-web:staging  (계측 코드 머지 이전에 빌드된 이미지)
```

즉 **계측 코드는 git에 있지만, 클러스터의 web pod는 그 코드가 없는 옛 이미지**로 돌고 있었다. Prometheus는 그 옛 `/metrics`를 정상적으로 긁고 있었고(그래서 Target은 UP), 단지 거기에 보안 메트릭이 *존재하지 않았다*.

## 해결 단계 — 새 이미지 빌드 → k3s import → 롤아웃

k3s는 로컬 레지스트리 없이 containerd에 import한 이미지를 쓴다(`pullPolicy: IfNotPresent`). 그래서 ① 새로 빌드 → ② containerd에 import → ③ Deployment 이미지 교체 순서다.

```bash
# 1) 계측 코드가 담긴 새 web 이미지 빌드 (NEXT_PUBLIC_*는 공개값, 빌드 타임 인라인)
docker build -f Dockerfile.web \
  --build-arg BUILD_STANDALONE=1 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=<project-url> \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  -t dailyproof-web:sec .

# 2) k3s containerd에 이미지 import (레지스트리 없이)
docker save dailyproof-web:sec | sudo k3s ctr images import -

# 3) Deployment가 새 이미지를 쓰도록 교체 + 롤아웃 대기
kubectl set image deploy/dp-dailyproof-web web=dailyproof-web:sec -n dailyproof
kubectl rollout status deploy/dp-dailyproof-web -n dailyproof
```
→ 새 pod의 `/metrics`에 `dailyproof_security_events_total`이 생기고, Prometheus가 다음 scrape(≤30s)에 수집한다.

## 교훈

- **"git에 머지" ≠ "클러스터에서 실행".** 코드는 *이미지*로 패키징돼 배포된다. 새 코드를 보려면 이미지를 다시 빌드·배포해야 한다. CI/CD가 자동 빌드·롤아웃하지 않는 환경에선 이 단계가 수동이고, 빼먹으면 "코드는 있는데 안 보이는" 착시가 생긴다.
- **계층을 끝에서부터 확인하라.** scrape 설정(중간)을 의심하기 전에, *맨 끝*인 `/metrics` 응답에 그 메트릭이 실제로 있는지부터 봤어야 했다. 출력의 *존재*를 먼저 확인하면 중간 디버깅을 줄인다.
- **port-forward가 불안정하면 클러스터 내부에서 검증.** 일회성 `kubectl run … curl` pod로 서비스를 직접 때리면 로컬 터널 문제를 우회하고 더 빠르다.
- **Target UP ≠ 원하는 메트릭 존재.** UP은 "엔드포인트가 200을 준다"일 뿐, 그 본문에 특정 메트릭이 있다는 보장이 아니다.
