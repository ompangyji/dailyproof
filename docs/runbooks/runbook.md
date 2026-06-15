# 운영 Runbook (초안)

DailyProof 비동기 파이프라인(web + worker + Supabase)의 운영 절차 — **"무엇이 이상하면 어디를 보고 무엇을 하는가"** 를 모은다. k3s·ArgoCD·Grafana 등 배포/관측 스택은 [추후] 단계라, 지금은 **수동 절차 + 그 단계에서 자동화될 지점**을 함께 적는다.

기준: `worker.md`(상태·동작), `environments.md`(환경·시크릿), `supabase/schema.sql`(테이블/함수)

---

## 1. 구성과 신호

| 컴포넌트 | 역할 | 상태/신호 |
|----------|------|-----------|
| web (Next) | 사용자 요청·업로드 | `/health/live`·`/health/ready` |
| worker (node) | `jobs` 큐 소비(`claim_job` 폴링) | 구조화 JSON 로그 |
| Supabase | Postgres(`proof_assets`/`jobs`) + Storage(`media`) | — |

핵심 상태: `jobs.status`(pending→processing→done\|failed), `proof_assets.status`(uploaded→processing→ready\|failed).

---

## 2. Health / Probe

| endpoint | 의미 | 실패 시(오케스트레이터) | 정상 응답 |
|----------|------|------------------------|-----------|
| `/health/live` | 프로세스가 살아있나(의존성 0) | **재시작** | `200 {"status":"ok"}` |
| `/health/ready` | 트래픽 받을 준비(Supabase 도달·종료중 아님) | **트래픽 제외(503)** | `200 {"ready":true,"checks":{…}}` |

- `ready 503` + `checks.db.error` → Supabase 도달 문제(§7).
- `ready 503` + `checks.shutdown` → **graceful shutdown 중**(정상, 곧 교체됨).

---

## 3. 서비스 재시작

- **web**: (k3s) pod 재시작 / (로컬) dev 재실행. 무상태라 안전.
- **worker**: 그냥 재시작해도 안전 — `claim_job`이 `FOR UPDATE SKIP LOCKED`라 다른 worker와 같은 job을 중복 선점하지 않는다. 단, **처리 중 죽은 job**은 `processing`+`locked_at`으로 남는다(→ §6 stuck 회수).

---

## 4. Graceful shutdown

- `SIGTERM` 수신 → readiness 503 → 오케스트레이터가 트래픽을 빼고 grace period로 drain → 종료. worker는 진행 중 job을 마무리한 뒤 종료.
- 전체 동작의 실증은 k3s 배포에서 완성([추후]).

---

## 5. 롤백

- **지금**: git에서 직전 정상 커밋으로 되돌려 재배포(web=Vercel 자동 / 또는 revert PR).
- **[추후] ArgoCD**: 직전 정상 리비전으로 sync rollback(GitOps — Git 상태가 곧 배포 상태).

---

## 6. stuck / failed job 대응

**조회 — 실패 job + 원인**
```sql
select j.id, j.asset_id, j.status, j.attempts, j.last_error,
       a.status as asset_status, a.error_code
from jobs j join proof_assets a on a.id = j.asset_id
where j.status = 'failed'
order by j.updated_at desc;
```

**재처리 — failed를 다시 큐로**
```sql
update jobs set status='pending', attempts=0, run_after=now(), last_error=null
where id = '<job_id>';
update proof_assets set status='uploaded', error_code=null, error_message=null
where id = '<asset_id>';
```

**stuck 회수 — `processing`인데 오래 잠긴 것(worker 크래시 등)**
```sql
update jobs set status='pending', locked_at=null, locked_by=null, run_after=now()
where status='processing' and locked_at < now() - interval '10 minutes';
```
(자동 회수 로직은 [추후] worker에 추가.)

---

## 7. 흔한 incident 대응

**Storage 다운/느림**
- 증상: worker 로그에 download 실패 / `error_code=timeout`, job 재시도 반복.
- 대응: Supabase Storage 상태 확인. 일시적이면 재시도로 회복. 지속되면 §6로 정리.

**큐 적체 (pending 급증)**
- 증상: `pending` job 다수, 처리 지연.
```sql
select status, count(*) from jobs group by status;  -- queue_depth
```
- 대응: worker 수를 늘린다([추후] HPA가 queue_depth 기반 자동). 처리 실패로 인한 적체면 §6.

**worker가 계속 `Invalid API key`**
- 증상: `claim_job 실패` 로그 반복, worker는 죽지 않고 폴링 재시도(복원력이 설정 오류를 가림).
- 원인: `.env.local`의 `SUPABASE_SERVICE_ROLE_KEY` 잘림/만료.
- 점검·복구: 키 형식(JWT — 점 2개·길이 ~200) 확인 → Supabase 대시보드 Settings>API에서 **전체 복사**로 교체 후 재시작.

**readiness 503 지속**
- `checks.db.error`가 있으면 DB 도달 불가 → Supabase 프로젝트 상태/네트워크 확인.

---

## 8. 관측 지점

- 구조화 JSON 로그(stdout/stderr): `request_id`·`worker_id`·`job_id`·`error_code`·`status`.
- 주요 로그 메시지: `worker 시작` / `job 선점` / `job 완료` / `job 실패 — 재시도 예약` / `job 실패 — 최대 재시도 초과, failed 확정` / `claim_job 실패` / `readiness check`.
- [추후] Prometheus 메트릭(`queue_depth` 등) + Grafana 대시보드 + Loki 로그 집계.

---

## 9. 참고 문서

- `architecture/worker.md` — 상태 전이·동작 상세
- `architecture/environments.md` — 환경·시크릿 주입
- `supabase/schema.sql` — 테이블·`claim_job`
