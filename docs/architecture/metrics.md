# 메트릭 목록·질의 (metrics)

`/metrics`는 Prometheus 텍스트 포맷으로 서비스 상태를 노출한다. 값은 `metrics_snapshot()`(SECURITY DEFINER, 집계만 반환)에서 받아 게이지로 출력하므로, raw row 노출이나 web의 service_role 없이 anon으로도 안전하게 수집할 수 있다. Prometheus가 주기적으로 scrape한다([추후] k3s).

기준: `src/app/metrics/route.ts`(노출), `supabase/schema.sql`의 `metrics_snapshot()`(집계). 인증 제외(미들웨어 matcher) — 운영에선 내부망 제한 [추후].

---

## 1. 메트릭 사전

모두 **gauge**(스냅샷 현재값). `_total` 접미사지만 counter가 아니라 "상태별 현재 건수"임에 주의.

| 메트릭 | 라벨 | 의미 | 출처 |
|--------|------|------|------|
| `dailyproof_jobs_total` | `status` = `pending`/`processing`/`done`/`failed` | 후처리 job을 상태별로 센 값. `pending` = **현재 큐 깊이**(처리 대기), `processing` = 선점되어 처리 중, `failed` = 최대 재시도 초과 확정 | `jobs` 테이블 `group by status` |
| `dailyproof_assets_total` | `status` = `uploaded`/`processing`/`ready`/`failed` | 업로드된 자산을 상태별로 센 값. `ready` = 처리 완료, `failed` = 업로드/처리 실패 | `proof_assets` 테이블 `group by status` |
| `dailyproof_job_processing_seconds_avg` | (없음) | 최근 `done` job 100건의 **claim→done 평균 처리 시간(초)**. `locked_at`(선점)→`updated_at`(완료) 기준이라 큐 대기 시간은 제외한 순수 처리 시간 근사 | `metrics_snapshot()` 내 `avg(extract(epoch from (updated_at - locked_at)))` |
| `dailyproof_security_events_total` | `type` = `rate_limited`/`forbidden`/`unauthorized` | **보안 거부 응답을 타입별로 센 counter**. 거부 지점(grass·proof-assets의 429/403/401)에서 증가. 위 게이지와 달리 **진짜 counter**(단조 증가, in-process) — Prometheus가 `rate()`로 합산·평가 | `lib/security-events.ts`(in-process), `/metrics`가 always-fresh로 덧붙임 |

> `*_total`은 Prometheus 관례상 counter를 뜻하지만 여기선 상태별 스냅샷 게이지다. 정식 counter(`*_created_total` 등 단조 증가)와 처리 시간 histogram은 [추후] worker가 직접 expose하도록 분리한다.

---

## 2. PromQL 질의 예시

scrape가 붙은 뒤([추후]) 쓸 수 있는 질의.

큐가 쌓이는지(처리 대기 적체):
```promql
dailyproof_jobs_total{status="pending"}
```

실패 비중(전체 job 대비 failed):
```promql
dailyproof_jobs_total{status="failed"}
  / ignoring(status) sum without(status)(dailyproof_jobs_total)
```

자산이 ready로 잘 넘어가는지(처리 적체/실패 감지):
```promql
dailyproof_assets_total{status="processing"}   # 오래 높으면 worker 정체
dailyproof_assets_total{status="failed"}        # 증가하면 처리 실패
```

처리 시간이 느려지는지(현재는 평균값 게이지):
```promql
dailyproof_job_processing_seconds_avg
```

---

## 3. 알림 후보 (rule 후속)

[추후] Prometheus alerting rule로 옮길 1차 후보. 임계값은 부하 측정 후 조정.

| 알림 | 조건(예) | 의미 |
|------|----------|------|
| 큐 적체 | `dailyproof_jobs_total{status="pending"} > 50` (5m) | worker 처리량 < 유입량 |
| 처리 지연 | `dailyproof_job_processing_seconds_avg > 10` (5m) | job당 처리 시간 급증 |
| 실패 누적 | `increase(...)` — counter 분리 후 | 실패율 상승 |

> 현재 게이지(스냅샷)만으로는 비율(rate)·증가량(increase) 알림이 부정확하다. counter/histogram 분리가 알림 정확도의 선결 과제([추후]).

---

## 3.1 보안 이벤트 모니터링·알림

거부(deny) 응답을 메트릭·로그로 잡아 **공격 시도 신호**를 본다. 거부 지점에서 `recordSecurityEvent()`가 ① `dailyproof_security_events_total{type}` counter 증가 + ② 구조화 로그(`security_event` 필드)를 함께 남긴다.

**계측 지점 / 타입**
| type | 거부 코드 | 지점 | 공격 신호 |
|---|---|---|---|
| `rate_limited` | 429 | grass(IP)·proof-assets(uid) | brute-force·scraping·스팸 폭주 |
| `forbidden` | 403 | proof-assets `source_path` 소유 위반 | IDOR/권한 우회 시도 |
| `unauthorized` | 401 | proof-assets 비로그인 호출 | 비인가 접근 시도 |

**알림 룰 (PromQL — 65-b에서 Prometheus rule로)**
| 알림 | 조건(예) | 의미 |
|---|---|---|
| rate-limit 폭주 | `sum(rate(dailyproof_security_events_total{type="rate_limited"}[5m])) > 1` | 누군가 한도를 지속적으로 때림(자동화 의심) |
| 권한 공격 시도 | `sum(rate(dailyproof_security_events_total{type="forbidden"}[5m])) > 0.2` | 타인 경로 등록 등 우회 시도 급증 |
| 비인가 접근 급증 | `sum(rate(dailyproof_security_events_total{type="unauthorized"}[5m])) > 0.5` | 로그인 없는 API 호출 폭증 |

- **counter라 `rate()`가 정확**: 게이지(§3)와 달리 단조 증가하는 진짜 counter라 비율 알림에 적합.
- **다중 pod**: in-process라 pod별로 분리·재시작 시 0 → Prometheus가 pod별 시계열을 `sum`으로 합산(표준 사용법). 절대 누적이 아니라 `rate`/`increase`로 본다.
- **edge 한계**: 미들웨어(edge 런타임)의 인증 리다이렉트는 이 모듈을 공유 못 해 **로그로만** 잡힌다(`security_event` 미포함). API 라우트(node)의 401/403/429만 카운터에 집계.
- **로그 기반 보강**: Loki/LogQL에서 `security_event` 필드로 같은 신호를 질의·알림 가능(다중 pod에서 중앙 수집되는 로그가 더 견고). 메트릭=빠른 집계·알림, 로그=개별 추적.

임계값은 65-b 배포 후 실측으로 보정한다.

---

## 4. scrape·대시보드 (후속)

- **scrape**([추후] k3s): Prometheus가 web 서비스의 `/metrics`를 주기 수집. 예시 scrape config —
  ```yaml
  scrape_configs:
    - job_name: dailyproof-web
      metrics_path: /metrics
      static_configs:
        - targets: ["dailyproof-web:3000"]
  ```
  worker는 web과 별도 프로세스라, 처리 시간 histogram 등 worker 자체 지표는 worker가 별도 포트로 expose하도록 분리한다([추후]).
- **Grafana**([추후]): 위 질의로 큐 깊이·상태 분포·처리 시간 패널을 구성하고, §3 알림과 연결한다.
- **로그와의 관계**: 메트릭은 "얼마나 많이/빠른가"의 집계, 로그는 "특정 건이 어떻게 됐나"의 개별 추적이다. 메트릭에서 이상을 감지하면 `trace_id`/`job_id`로 로그를 좁혀 원인까지 내려간다(`architecture/logging.md`).

참고: `architecture/worker.md`(상태 전이·처리 시간 정의), `architecture/logging.md`(로그 필드·상관), `runbooks/runbook.md`(관측 지점).
