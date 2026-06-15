# 로그 포맷·예시 (sample logs)

web/worker는 공통 로거(`lib/log.mjs`)로 **JSON 한 줄**씩 로그를 남긴다. 사람이 읽는 문자열이 아니라 필드 구조라, 수집기(Loki 등)에서 `request_id`/`trace_id`/`status` 같은 필드로 바로 질의·집계·상관할 수 있다.

기준: `lib/log.mjs`(공통 로거), `src/lib/log.ts`(web 재export), `worker/worker.mjs`

---

## 1. 공통 필드

모든 로그에 공통으로 들어가는 것:

| 필드 | 의미 |
|------|------|
| `ts` | ISO 타임스탬프 |
| `level` | `debug`/`info`/`warn`/`error` (LOG_LEVEL 이상만 출력) |
| `env` | 환경 라벨(APP_ENV: dev/staging/prod) |
| `msg` | 사람이 읽는 짧은 메시지(=이벤트 종류) |

컨텍스트 필드(있을 때):

| 필드 | 어디서 | 의미 |
|------|--------|------|
| `request_id` | web | 한 HTTP 요청 식별자(미들웨어가 부여, 응답 헤더 `x-request-id`) |
| `trace_id` | web→worker | 업로드 시 부여, asset에 실려 worker까지 전파(비동기 경계 추적) |
| `worker_id` | worker | worker 프로세스 식별자 |
| `job_id` / `asset_id` | worker | 처리 중인 작업/자산 |
| `route` | web | 요청 경로(`/api/media`, `/health/ready` 등) |
| `status` | web/worker | HTTP 상태 또는 처리 결과 상태 |
| `error_code` | worker | 실패 분류(`download_failed`/`asset_not_found`/`timeout`/`unknown`) |

---

## 2. 이벤트별 예시

### web

미디어 서빙(`/api/media`):
```json
{"ts":"2026-06-15T12:10:00.123Z","level":"info","env":"dev","msg":"media served","request_id":"31316c91-c694-4797-aa22-b446871bd809","route":"/api/media","object_path":"<uid>/doits/<uuid>.png","content_type":"image/png","bytes":2869424,"status":200}
```

readiness probe(`/health/ready`):
```json
{"ts":"2026-06-15T12:10:01.000Z","level":"info","env":"dev","msg":"readiness check","request_id":"…","route":"/health/ready","ready":true,"checks":{"db":{"ok":true,"ms":1005}}}
```

graceful shutdown(SIGTERM):
```json
{"ts":"2026-06-15T12:10:05.000Z","level":"warn","env":"dev","msg":"SIGTERM 수신 — readiness 차단(graceful shutdown)","signal":"SIGTERM"}
```

### worker

job 선점 → 완료(성공 경로, trace_id가 web에서 전파됨):
```json
{"ts":"2026-06-15T12:57:53.375Z","level":"info","env":"dev","msg":"job 선점","worker_id":"host-f70c6ebf","job_id":"910914c0-…","asset_id":"93f2eba6-…","trace_id":"85690c5a-9980-4e06-bc0b-391fc2254cef","attempts":1,"type":"process_image"}
{"ts":"2026-06-15T12:57:55.366Z","level":"info","env":"dev","msg":"job 완료","worker_id":"host-f70c6ebf","job_id":"910914c0-…","asset_id":"93f2eba6-…","trace_id":"85690c5a-…","status":"ready","size_bytes":2869424,"width":1536,"height":1024,"checksum":"a23b734ba0ee…"}
```

처리 실패 → 재시도 예약 → 최대 초과 시 failed 확정:
```json
{"ts":"…","level":"warn","env":"dev","msg":"job 실패 — 재시도 예약","worker_id":"host-…","job_id":"bdc54633-…","asset_id":"edea34eb-…","error_code":"download_failed","error":"원본 download 실패: Object not found","attempts":2,"max_attempts":3,"retry_in_ms":10000}
{"ts":"…","level":"error","env":"dev","msg":"job 실패 — 최대 재시도 초과, failed 확정","worker_id":"host-…","job_id":"bdc54633-…","asset_id":"edea34eb-…","error_code":"download_failed","attempts":3}
```

claim 실패(예: 키 오류 — 죽지 않고 폴링 재시도):
```json
{"ts":"…","level":"error","env":"dev","msg":"claim_job 실패","worker_id":"host-…","error":"Invalid API key"}
```

---

## 3. 이 필드로 무엇을 하나 (질의·상관 예시)

| 하고 싶은 것 | 쓰는 필드 |
|--------------|-----------|
| 한 업로드가 worker까지 어떻게 처리됐나 | **`trace_id`** 로 web→worker 로그를 한 줄로 묶기 |
| 한 HTTP 요청의 흐름 | `request_id` |
| 특정 job/자산의 처리 이력 | `job_id` / `asset_id` |
| 실패만, 원인별로 | `level=error` + `error_code` (download_failed/timeout 등) |
| 에러율·응답 상태 분포 | `status` 집계 |
| 특정 worker 인스턴스 | `worker_id` |

---

## 4. 후속

- 지금은 stdout/stderr로 JSON을 출력만 한다. [추후] **Loki**로 수집해 위 필드로 검색하고, **Grafana**에서 대시보드/알림으로 연결한다.
- OpenTelemetry `trace_id`(분산 트레이싱)와 결합하면 web→worker span까지 시각화 가능([추후]).

참고: `architecture/worker.md`(상태·로그 메시지), `runbooks/runbook.md`(관측 지점).
