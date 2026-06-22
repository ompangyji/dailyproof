# 로컬 스택 (local stack)

web · worker · jaeger를 docker-compose로 한 번에 띄워, 관측 가능한 전체 파이프라인을 한 머신에서 재현한다. 그동안 흩어져 있던 `npm run dev` / `npm run worker` / 수동 `docker run jaeger`를 한 명령으로 묶은 것.

기준: `docker-compose.yml`, `Dockerfile.web`, `Dockerfile.worker`, `scripts/smoke.mjs`.

---

## 1. 구성

| 서비스 | 이미지/빌드 | 포트(host) | 역할 |
|--------|-------------|-----------|------|
| `web` | `Dockerfile.web` (Next standalone) | `3000` | 앱·API·헬스·메트릭. 업로드 등록 시 trace 시작 |
| `worker` | `Dockerfile.worker` | (없음) | 큐 소비·이미지 후처리. web→worker span의 자식 구간 |
| `jaeger` | `jaegertracing/all-in-one` | `16686`(UI) · `4318`(OTLP) | trace 수집·조회 |

web·worker는 컨테이너 네트워크에서 `http://jaeger:4318`로 span을 보낸다(호스트의 `localhost`가 아니라 서비스명).

---

## 2. 사전 준비

- Docker / Docker Compose.
- `.env.local`(git 미추적)에 시크릿·설정:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (공개값, web 빌드 시 인라인)
  - `SUPABASE_SERVICE_ROLE_KEY` (worker 전용 시크릿, **커밋 금지**)
  - 형식은 `.env.example` 참고.

---

## 3. 실행

```bash
docker compose --env-file .env.local up --build
```

- `--env-file .env.local`: compose 변수 치환(빌드 arg `NEXT_PUBLIC_*`)과 컨테이너 주입을 같은 파일로 통일.
- 첫 실행은 `npm ci` + `next build`로 수 분 소요. 이후는 캐시로 빠름.

접속:

| 대상 | URL |
|------|-----|
| web | http://localhost:3000 |
| Jaeger UI | http://localhost:16686 |
| 메트릭 | http://localhost:3000/metrics |
| 헬스 | http://localhost:3000/health/live · `/health/ready` |

종료: `Ctrl+C` 후 `docker compose down` (네트워크·컨테이너 정리).

---

## 4. smoke test

스택이 트래픽 받을 준비가 됐는지 빠르게 점검(의존성 없음):

```bash
npm run smoke
```

점검 항목: `/health/live`(200·ok) · `/health/ready`(200·의존성 도달) · `/metrics`(게이지 노출) · Jaeger UI 도달. 하나라도 실패하면 비-0 종료라 CI 게이트로 쓸 수 있다. 환경변수 `SMOKE_BASE_URL` / `SMOKE_JAEGER_URL` / `SMOKE_TIMEOUT_MS`로 대상·타임아웃 조정.

> 업로드→worker→trace 경로는 로그인 사용자가 필요해 자동화에서 제외한다. 수동 확인: 앱에서 이미지 업로드 1건 → Jaeger UI에서 `dailyproof-web`→`dailyproof-worker` trace 확인(`architecture/tracing.md`).

---

## 5. 트러블슈팅

| 증상 | 원인·조치 |
|------|-----------|
| jaeger 포트 바인딩 실패(16686/4318) | 수동으로 띄운 jaeger가 점유 중 → `docker rm -f jaeger` 후 재기동 |
| web 빌드에서 클라이언트가 Supabase에 못 붙음 | `.env.local`에 `NEXT_PUBLIC_*`가 없음 → 채우고 `--build`(빌드 시 인라인이라 재빌드 필요) |
| worker가 즉시 종료 | `SUPABASE_SERVICE_ROLE_KEY` 누락/오류 → `.env.local` 확인(JWT는 점 2개·200자+) |
| trace가 안 뜸 | worker가 job 처리 시에만 span 전송(배치) → 업로드 후 수 초 대기. OTLP endpoint가 `jaeger:4318`인지 확인 |
| 로컬 `npm run build`가 EPERM | WSL drvfs 전용 현상 — 컨테이너 빌드는 무관(`runbook.md` §9 참고) |

---

## 6. 후속

- **jaeger 이미지 고정**: 현재 `:latest`(v1)는 EOL deprecation 경고가 뜬다. 재현성을 위해 특정 버전 태그로 고정하거나 Jaeger v2로 전환한다(OTLP 4318·UI 16686은 동일, 코드 불변).
  - compose는 still `:latest`, k8s 차트(`deploy/helm/dailyproof/values.yaml`)는 `1.62.0`으로 고정돼 있음 — 재현성을 위해 compose도 같은 버전으로 고정 권장([추후]).
- **관측 스택 통합**: Prometheus(`/metrics` scrape)·Grafana·Loki를 compose에 추가해 메트릭·로그·trace를 한 대시보드로([추후]).
- **헬스 게이트**: compose `depends_on`에 healthcheck 조건을 걸어 web ready 후 트래픽 흐르게([추후]).

참고: `runbooks/runbook.md`(운영 절차), `architecture/tracing.md`(트레이싱), `architecture/metrics.md`(메트릭).
