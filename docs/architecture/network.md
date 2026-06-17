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

## 5. 후속

- **TLS**: cert-manager + Let's Encrypt로 https 자동화([추후]).
- **정책 강제**: Traefik Middleware(body size/timeout)를 차트에 옵션으로 포함([추후], 지금은 annotation 패스스루 + 문서).
- **prod 호스트네임 / DNS**: env별 host 분리(values-prod)·실DNS 연결([추후]).
- **관측**: ingress 레벨 접근 로그·지표를 Prometheus/Grafana로([추후]).

참고: `runbooks/k8s-deploy.md`(차트·배포), `runbooks/argocd.md`(GitOps), `architecture/environments.md`(환경 분리).
