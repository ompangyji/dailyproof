# 확장성 (scaling)

사용자/부하가 늘면 **어디가 먼저 막히고, 어떤 순서로 늘려야 하는가**. 추측이 아니라 우리가 한 부하 측정(k6 · `/metrics` 병목 분석)을 근거로 잡는다.

## 현재 구조 (확장 관점)

| 컴포넌트 | 현황 | 확장 성격 |
|---|---|---|
| **web** | Next.js standalone, **stateless**, `replicas: 1`, cpu limit `1` | 수평 확장 쉬움 |
| **worker** | 독립 Node 폴링 프로세스, `replicas: 1`, cpu limit `500m`. **`claim_job`(`FOR UPDATE SKIP LOCKED`)으로 한 번에 한 job 선점** | **이미 다중 worker 안전** |
| **큐** | 별도 큐 없음 — `jobs` 테이블을 worker가 폴링(`claim_job`). 큐 깊이 = pending 수 = `/metrics`의 `dailyproof_jobs_total{status="pending"}` | 메트릭으로 관측됨 |
| **DB · 저장소** | Supabase(Postgres + Storage), RLS | 외부 관리형, 한도 존재 |

## 병목 컴포넌트 — 늘릴 때 먼저 막히는 순서

1. **DB(Supabase)** — 읽기 부하·커넥션 한도·폴링 부하. *실측 근거*: `/metrics`가 동시성 20에서 ~10초 행·100% 실패(3-way 진단으로 DB-측 경로로 격리). worker를 늘릴수록 폴링 횟수도 같이 는다. → **진짜 천장은 DB.**
2. **web** — stateless라 늘리긴 쉽지만 지금은 **단일 pod·cpu 1**이 즉시 상한.
3. **worker** — claim은 이미 원자적이라 정합성 문제 없음. 처리량이 큐 유입을 못 따라가면 `pending`이 쌓인다(backlog).
4. **storage** — 업로드/다운로드 대역폭.

## 확장 순서 — 무엇을 먼저, 왜

1. **web 수평 확장 + HPA(CPU/RPS)** — stateless라 가장 쉽고 즉효. `replicas: 1` + cpu limit 1이 첫 상한이라 여기부터.
2. **worker 수평 확장 + 큐 깊이 기반 HPA** — `claim_job`이 `SKIP LOCKED`라 **코드 변경 0으로** replicas만 늘리면 각 worker가 서로 다른 job을 안전하게 가져간다. HPA는 CPU가 아니라 **`pending` 큐 깊이**(이미 `/metrics`에 노출) 기준으로 걸어 backlog를 자동 흡수. (worker 문서의 "큐 적체 기반 HPA"를 실현)
3. **DB 부하 완화** — 천장을 올리는 단계. ① 읽기 캐시(우리가 `/metrics`에 이미 적용한 TTL 캐시+single-flight 패턴), ② 커넥션 풀러(Supabase pooler/PgBouncer)로 커넥션 한도 흡수, ③ 읽기 복제본, ④ worker 폴링 자체를 줄이기(`LISTEN/NOTIFY`로 push 전환).
4. **저장소 CDN + 전용 큐(장기)** — Storage 앞 CDN, `jobs` 테이블 폴링 → 전용 큐(Redis/SQS 등)로 분리해 폴링 부하 제거·픽업 지연 단축.

## 병목 분석 메모 (실측 근거)

- **`/metrics` 부하 행** — 동시성 20에서 100% 실패, 쿼리 3.6ms·REST 130ms인데 앱 pod 경유만 ~10초 → DB-측 경로가 먼저 한계임을 직접 보여줌. ([retrospective/metrics-load.md](../retrospective/metrics-load.md) · [performance/performance.md](../performance/performance.md))
- **web tail 지연** — `health_live`가 296 rps에서 p95 274ms(cpu 1·단일 pod). 처리량 자체보다 tail이 먼저 나빠짐 → web replicas/HPA의 근거.
- **worker scale-out 비용 낮음** — `claim_job` `FOR UPDATE SKIP LOCKED`로 다중화 정합성이 이미 보장돼, 확장은 "replicas + 큐깊이 HPA"만으로 된다.

## 구현 (HPA / KEDA)

위 1·2단계는 차트에 매니페스트로 들어가 있다(기본 off — 켜면 정적 `replicas`는 생략되고 오토스케일러가 관리).

- **web** — `templates/web-hpa.yaml`(`HorizontalPodAutoscaler` v2, CPU). `values: autoscaling.web.enabled=true`로 켠다. **metrics-server 필요**(k3s 기본 번들이라 즉시 동작) → `kubectl get hpa`로 확인.
- **worker** — `templates/worker-scaledobject.yaml`(KEDA `ScaledObject` + `TriggerAuthentication`). `pending` 수가 `pendingThreshold`를 넘으면 scale out. **KEDA 설치 + jobs 테이블 조회용 Postgres 연결 시크릿**(`autoscaling.worker.kedaConnectionSecret`, gitignored) 전제. claim_job이 `SKIP LOCKED`라 다중 worker는 그대로 안전.

```bash
helm upgrade ... --set autoscaling.web.enabled=true --set autoscaling.worker.enabled=true
```

## 후속

- 실제 부하가 발생하는 환경(클라우드 클러스터)에서 단계별 한계점 재측정. 로컬 k3s는 web HPA(CPU)까지 즉시 검증 가능, worker KEDA는 KEDA 설치 후.
