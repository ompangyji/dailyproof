# 네트워크 설계 (network)

외부 트래픽이 앱까지 어떻게 들어오는지(진입로·라우팅·HTTP 정책)를 정리한다. 그동안 외부 접속은 `kubectl port-forward`라는 임시 터널뿐이었는데, **Ingress**로 정식 진입로를 둔다.

기준: `deploy/helm/dailyproof/templates/ingress.yaml`, `values.yaml`의 `ingress`.

---

## 1. 트래픽 흐름

```
클라이언트(브라우저)
   │  http(s)://dailyproof.local
   ▼
[Ingress Controller]  ← k3s 기본 = Traefik (host 기반 라우팅, TLS 종단)
   │  host=dailyproof.local, path=/  → 매칭
   ▼
[Service]  dp-dailyproof-web (ClusterIP :3000)
   │  파드 셀렉터로 로드밸런싱
   ▼
[Pod]  web 컨테이너 :3000  (Next.js)
```

- web Service는 **ClusterIP**(클러스터 내부 전용) — 외부 노출은 **Ingress가 전담**한다(현관문).
- worker는 HTTP를 안 열어 Ingress 대상이 아니다(큐 소비 프로세스).
- **업로드 파일 자체**는 이 경로가 아니라 브라우저→Supabase Storage로 직행한다. 여기를 지나는 건 앱/API 트래픽이다.

---

## 2. HTTP / HTTPS

- **로컬(k3s)**: Traefik가 80(http)/443(https) entrypoint로 받는다. 로컬 데모는 http로 충분하다.
- **TLS**: 운영에선 Ingress에서 TLS 종단(인증서). [추후] `cert-manager`로 Let's Encrypt 자동 발급, `ingress.tls`에 호스트·시크릿 연결.
- 호스트 라우팅: `host: dailyproof.local`. 로컬에선 노드 IP를 `/etc/hosts`에 매핑하거나 `*.localhost`를 쓴다.

---

## 3. HTTP 정책 (body size · timeout · keep-alive)

정책은 **Ingress 컨트롤러별로 거는 위치가 다르다.** 차트는 `ingress.annotations`로 통과시키며, 컨트롤러에 맞는 키를 넣는다.

| 정책 | 왜 필요 | NGINX ingress | Traefik(k3s) |
|------|---------|---------------|--------------|
| **body size** | 업로드 8MB 대응(작으면 413) | `nginx.ingress.kubernetes.io/proxy-body-size: "8m"` | Middleware `buffering.maxRequestBodyBytes` |
| **read/response timeout** | 느린 요청 끊기 | `.../proxy-read-timeout: "60"` | Middleware/entrypoint 타임아웃 |
| **keep-alive** | 커넥션 재사용 | 기본 on, `upstream-keepalive-*` | entrypoint transport 설정 |

> 본문(업로드)·앱 응답은 짧아 기본값으로도 동작하지만, **8MB body size**는 업로드 한도(Supabase 버킷 `file_size_limit`)와 짝을 맞춰 명시하는 게 안전하다.

**Traefik(k3s) body size 예시** — Middleware CRD + Ingress annotation:
```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata: { name: dailyproof-buffering, namespace: dailyproof-staging }
spec:
  buffering:
    maxRequestBodyBytes: 8388608   # 8MB
```
```yaml
# ingress.annotations 에:
traefik.ingress.kubernetes.io/router.middlewares: dailyproof-staging-dailyproof-buffering@kubernetescrd
```

---

## 4. 로컬에서 접속

```bash
# 노드 IP 확인 후 /etc/hosts 에 매핑
kubectl get nodes -o wide          # INTERNAL-IP 확인
echo "<노드IP> dailyproof.local" | sudo tee -a /etc/hosts
# 브라우저: http://dailyproof.local
```
이러면 **port-forward 없이** 호스트네임으로 앱에 접속한다(정식 진입로).

---

## 5. NetworkPolicy (네트워크 최소권한)

pod 간·외부 트래픽을 **default-deny(전부 차단) 후 필요한 흐름만 허용**한다. 한 pod가 뚫려도 옆으로 번지는 lateral movement를 막는 네트워크 최소권한. k3s는 NetworkPolicy를 강제한다(kube-router netpol 컨트롤러 내장)라 정책이 실제로 동작한다. 차트 `templates/networkpolicy.yaml`, `values.networkPolicy.enabled`(기본 on).

| 정책 | 대상 | 방향 | 허용 | 이유 |
|---|---|---|---|---|
| default-deny | 전 pod | ingress·egress | (없음) | 기준선 — 명시 안 한 건 전부 차단 |
| allow-dns | 전 pod | egress | kube-dns :53 | 이름 해석. **없으면 Supabase·서비스 DNS 실패로 전부 깨짐** |
| web-ingress | web | ingress | ingress 컨트롤러 ns → :3000 | 외부 사용자 요청(Traefik 경유)만 수신 |
| app-egress | web·worker | egress | 외부 :443, 같은 ns :4318 | Supabase(HTTPS) + 트레이스(OTLP, jaeger 배포 시) |

- **worker는 ingress 정책 없음** — 아무도 worker로 들어올 필요가 없다(폴링만 하는 프로세스). default-deny가 그대로 적용돼 수신 차단.
- **egress 순서 의존성**: DNS(allow-dns)가 별도 정책으로 먼저 열려 있어야 443/4318 연결의 이름 해석이 된다. NetworkPolicy는 가산적(additive)이라 여러 정책의 허용이 합쳐진다.

**한계 (반드시 인지)**: NetworkPolicy는 **IP·포트·라벨** 기준이라 **도메인(`*.supabase.co`)을 직접 좁힐 수 없다.** 그래서 외부 egress는 "**HTTPS(443)로 클러스터 밖(사설 대역 제외)**"까지가 한계다. 특정 도메인만 허용하는 **FQDN 기반 정책은 Cilium 등 별도 CNI**가 필요(k3s 기본 미지원) → [추후] 과제. 사설 대역(10/172.16/192.168)을 `except`로 빼 내부로의 임의 egress는 막았다.

**검증**: `helm template`로 on(정책 4개)·off(0개) 렌더 확인. 런타임 검증은 적용 후 `kubectl exec`로 *차단된 연결은 timeout / 허용된 건 성공*을 확인(예: worker에서 web으로 직접 연결 시도 → 차단).

## 6. 후속

- **TLS**: cert-manager + Let's Encrypt로 https 자동화([추후]).
- **정책 강제**: Traefik Middleware(body size/timeout)를 차트에 옵션으로 포함([추후], 지금은 annotation 패스스루 + 문서).
- **prod 호스트네임 / DNS**: env별 host 분리(values-prod)·실DNS 연결([추후]).
- **관측**: ingress 레벨 접근 로그·지표를 Prometheus/Grafana로([추후]).

참고: `runbooks/k8s-deploy.md`(차트·배포), `runbooks/argocd.md`(GitOps), `architecture/environments.md`(환경 분리).
