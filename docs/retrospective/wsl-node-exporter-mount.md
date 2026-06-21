# 회고: WSL2에서 node-exporter가 안 뜬 문제 (shared mount)

kube-prometheus-stack을 k3s(WSL2)에 설치하니 다른 컴포넌트(Prometheus·Alertmanager·Grafana·operator·kube-state-metrics)는 다 떴는데 **node-exporter만 `CreateContainerError`로 무한 재시도**했다. WSL2 환경의 마운트 제약이 원인이었고, 한 줄로 풀었다.

## 증상

```
kps-prometheus-node-exporter-xxxxx   0/1   CreateContainerError
```

`kubectl describe`의 Events:
```
Warning  Failed  kubelet  Error: failed to generate container spec: failed to generate spec:
         path "/" is mounted on "/" but it is not a shared or slave mount
```
이미지 pull은 성공했고, **컨테이너 spec 생성 단계**에서 실패한다(재시도만 반복).

## 원인

node-exporter는 **노드(호스트 머신)의 디스크·파일시스템 메트릭**을 읽으려고 호스트 루트 `/`를 컨테이너에 **마운트 전파(mount propagation)** 로 받는다. 이때 루트 마운트가 **shared(또는 slave)** 여야 propagation이 성립한다.

그런데 **WSL2의 루트 `/`는 기본적으로 private mount**라(shared가 아님), node-exporter가 요구하는 mount propagation을 만들 수 없어 컨테이너 spec 생성이 실패한다. WSL2 특유의 제약이며, 일반 리눅스 노드에선 안 나는 문제다.

## 해결

루트 마운트를 **재귀적으로 shared로 전환**:
```bash
sudo mount --make-rshared /
# 그 뒤 pod 재생성(즉시 재시도)
kubectl delete pod -n monitoring -l app.kubernetes.io/name=prometheus-node-exporter
```
→ node-exporter가 `1/1 Running`으로 떴고, 스택 전체(Prometheus·Alertmanager·Grafana·operator·kube-state-metrics·node-exporter)가 정상화됐다.

**영속성 주의**: `mount --make-rshared /`는 **현재 부팅 한정**이다. WSL을 재시작하면 풀린다. 매번 자동 적용하려면 WSL 시작 시 실행되도록 `/etc/wsl.conf`의 `[boot] command` 또는 부팅 스크립트에 넣는다([추후], 데모 환경이라 수동으로 둠).

## 대안 (해결이 안 되거나 불필요할 때)

node-exporter 없이도 **우리 목표(보안 이벤트 모니터링)는 영향 없다** — 그건 web `/metrics`를 scrape하는 거라 node-exporter와 무관하다. 또 WSL2는 가상화 위 가상화라 **노드 메트릭 자체가 부정확**하다. 그래서 끄는 것도 합리적 선택이었다:
```bash
helm upgrade kps prometheus-community/kube-prometheus-stack -n monitoring \
  --set nodeExporter.enabled=false --reuse-values
```
→ 이번엔 `make-rshared`로 살리는 쪽을 택해 풀스택을 완성했지만, 환경이 불안정하면 비활성화가 정답이다.

## 교훈

- **에러 메시지의 한 줄을 정확히 읽는다** — "not a shared or slave mount"가 mount propagation 문제임을 가리켰다. 추측 대신 `describe` Events로 단계(이미지 pull은 OK, spec 생성에서 실패)를 좁혔다.
- **환경 특이 제약을 구분한다** — 코드/차트 버그가 아니라 **WSL2 호스트 마운트** 특성. 같은 차트가 일반 노드에선 잘 된다.
- **목표에 필수가 아닌 컴포넌트는 끄는 것도 선택지** — node-exporter는 보안 이벤트 모니터링과 무관하다. "다 떠야 한다"에 매이지 말고 *무엇을 위한 설치인지*로 판단한다.
