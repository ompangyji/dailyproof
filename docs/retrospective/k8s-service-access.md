# 회고: k8s 안의 것을 어떻게 접속하나 (Service 타입·port-forward)

jaeger·ArgoCD UI에 접속하려다 "왜 어떤 건 port-forward를 해야 보이고 어떤 건 아닌가?", "worker는 왜 port-forward가 안 되나?"가 헷갈렸다. k8s에서 **무엇이 어떻게 노출되는가**를 정리한 기록.

## pod는 기본적으로 "클러스터 안에 숨어 있다"

pod는 클러스터 내부 네트워크에만 존재한다. 내 PC 브라우저에서 바로 못 닿는다. 외부(또는 내 PC)에서 접근하려면 **노출 경로**가 필요한데, 그 경로가 Service 타입·ingress·port-forward로 갈린다.

## Service 타입 — 노출 범위가 다르다

| 타입 | 접근 범위 | 내 PC에서 보려면 |
|---|---|---|
| **ClusterIP**(기본) | **클러스터 안에서만** | port-forward로 터널 뚫어야 함 |
| **LoadBalancer** | 외부 노출 | 그대로 접근(외부 IP/포트) |
| (Ingress) | 도메인 기반 외부 라우팅 | ingress 컨트롤러(Traefik) 경유 |

이 프로젝트 관측 결과:
- `jaeger`, `dp-dailyproof-web`, `argocd-server` → **ClusterIP** → port-forward 필요.
- `traefik` → **LoadBalancer** → 외부 진입로라 port-forward 불필요(사용자는 ingress로 web 접속).

## port-forward = 내 PC와 클러스터 안 서비스를 잇는 임시 터널

```bash
kubectl port-forward svc/<서비스> <로컬포트>:<원래포트> -n <namespace>
# 예: kubectl port-forward svc/jaeger 16687:16686 -n dailyproof
#     → http://localhost:16687 이 클러스터 안 jaeger:16686 으로 연결
```

- **로컬포트:원래포트** — 내 PC 포트(앞)를 서비스 포트(뒤)에 연결. 앞 번호는 안 겹치게 아무거나.
- 여러 개 동시에 띄우려면 **각각 다른 로컬포트 + 별도 터미널**(jaeger 16687, argocd 8090 …).
- **임시**다 — 명령을 끄면(Ctrl+C) 터널도 닫힌다. 공개 노출(ingress)과 달리 내 PC에서만 보이는 안전한 접근.
- (보안) jaeger UI처럼 **인증 없는 UI**는 ingress로 공개하지 않고 port-forward로만 여는 게 맞다 — 공개하면 누구나 본다.

## worker는 왜 port-forward 대상이 아닌가

**worker에는 Service가 없다.** 그래서 port-forward할 대상 자체가 없다. 이유:
- web은 **요청을 받는** 서버라 포트(3000)가 있고 누가 접속한다 → Service 필요.
- worker는 **아무도 접속하지 않는** 백그라운드 프로세스다. `jobs` 큐를 스스로 폴링해 처리할 뿐, 들어오는 연결을 받지 않는다 → 포트도 UI도 Service도 불필요.
- 그래서 NetworkPolicy(#60)에서도 worker엔 **ingress 정책을 안 만들었다**(받을 트래픽이 없으니 default-deny로 수신 차단 유지).

→ "접속한다"는 개념은 **받는 쪽(서버)에만** 성립한다. worker는 받는 쪽이 아니라 일하는 쪽이다.

## 무엇을 어떻게 보나 (이 프로젝트 정리)

| 대상 | 접근 | 명령/경로 |
|---|---|---|
| 앱(web) | ingress(Traefik) 또는 port-forward | 도메인 / `port-forward svc/...-web 3000:3000` |
| jaeger UI | port-forward | `port-forward svc/jaeger 16687:16686` |
| ArgoCD UI | port-forward(https) | `port-forward svc/argocd-server 8090:443` → https://localhost:8090 |
| worker | (접속 안 함) | 로그로 관찰: `kubectl logs deploy/...-worker` |

## 교훈

- **k8s 안의 것은 기본적으로 숨어 있다** — ClusterIP(내부 전용)가 기본. 외부에서 보려면 port-forward(임시 터널)나 ingress/LoadBalancer(상시 노출)가 필요하다.
- **port-forward는 "내 PC에서만 잠깐 보는" 안전한 접근** — 인증 없는 UI(jaeger 등)는 이걸로 여는 게 보안상 옳다.
- **접속의 대상은 '받는 쪽'뿐** — worker처럼 일만 하는 프로세스는 Service도 port-forward도 없고, 상태는 로그로 본다.
