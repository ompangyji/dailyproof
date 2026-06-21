# 분산 트레이싱 (tracing)

업로드 한 건이 web에서 시작해 비동기 큐를 거쳐 worker·DB까지 어떻게 처리되는지를 **하나의 OpenTelemetry trace(span 트리)** 로 본다. 로그가 "이 한 건이 무슨 일을 겪었나"를 개별 줄로 남긴다면, trace는 "각 단계가 누구의 하위이고 몇 ms 걸렸나"를 **부모-자식·구간 시간**으로 보여준다.

기준: `src/instrumentation.ts`(web SDK), `src/app/api/proof-assets/route.ts`(trace 시작점), `worker/tracing.mjs`·`worker/worker.mjs`(worker SDK·span).

---

## 1. 구성

| 구성요소 | 무엇 | 비고 |
|----------|------|------|
| web 계측 | `@vercel/otel`의 `registerOTel()` (instrumentation 훅) | 요청마다 root span + HTTP/fetch auto-instrument |
| worker 계측 | `@opentelemetry/sdk-node`의 `NodeSDK` (`worker/tracing.mjs`) | 독립 프로세스라 web과 별도 SDK, `service.name=dailyproof-worker` |
| exporter | 양쪽 모두 **OTLP/HTTP** → `OTEL_EXPORTER_OTLP_ENDPOINT`(기본 `http://localhost:4318`)의 `/v1/traces` | 표준 OTLP라 백엔드 교체 시 endpoint만 변경 |
| 백엔드(현재) | 로컬 **Jaeger all-in-one**(단일 컨테이너, UI 16686 / OTLP 4318) | 컨테이너화·운영 스택은 후속 |

서비스는 trace에서 **`dailyproof-web` / `dailyproof-worker`** 둘로 분리되어 보인다(worker는 NodeSDK에 `serviceName`을 명시해 env보다 우선).

---

## 2. 비동기 경계를 넘는 컨텍스트 전파

가장 까다로운 지점은 **web→worker**다. 둘은 HTTP로 직접 이어지지 않고 **DB 큐**를 사이에 두므로, 표준인 HTTP 헤더(`traceparent`) 전파를 쓸 수 없다. 게다가 업로드는 `"use client"` 코드라 브라우저가 직접 Storage·DB에 쓰는데, **브라우저는 OTel 계측 대상이 아니다**(서버만 계측). 그래서 두 가지를 했다.

1. **trace 시작점을 서버로 끌어옴** — asset 등록을 새 서버 라우트 `POST /api/proof-assets` 경유로 바꿨다. 이 라우트는 `@vercel/otel`이 span으로 감싸므로 여기서 trace가 시작된다. (파일 업로드 자체는 8MB를 서버로 우회시키지 않으려고 브라우저→Storage 직행 유지.)
2. **컨텍스트를 데이터에 실어 큐를 넘김** — 서버 라우트가 활성 span에서 **W3C `traceparent`** 문자열(`00-<trace-id>-<span-id>-<flags>`)을 만들어 `proof_assets.traceparent` 컬럼에 저장한다. worker는 job을 집을 때 그 값을 `propagation.extract`로 **부모 컨텍스트로 복원**하고, 그 아래에서 worker span을 연다. 이것이 메시지큐 트레이싱의 표준 패턴이다.

```
[브라우저]  파일 → Storage 직행 (계측 밖)
     │  POST /api/proof-assets
     ▼
[web 서버 라우트]  span 시작 → traceparent 생성 → proof_assets.traceparent 저장
     │  (DB 큐: jobs 행 enqueue)
     ▼
[worker]  job 선점 → asset.traceparent 를 부모로 복원 → worker span (web의 자식)
              ├ storage.download
              └ db.update proof_assets ready
```

---

## 3. trace_id 와 OTel trace 의 관계

둘 다 "web→worker를 잇는" 식별자라 헷갈리기 쉬운데, **역할이 다르고 공존**한다.

| | `trace_id` (기존) | OTel `traceparent` / trace |
|---|---|---|
| 정체 | 우리가 부여한 상관용 문자열(UUID) | W3C 표준 컨텍스트(트리 구조 포함) |
| 쓰임 | **로그** 줄을 같은 업로드로 묶기(Loki 등에서 질의) | **span 트리**(부모-자식·구간 시간) 시각화 |
| 보는 곳 | 로그 수집기 | Jaeger/Tempo 등 trace 백엔드 |

즉 메트릭(얼마나/빠른가) · 로그(이 건이 무슨 일을 겪었나) · trace(단계가 어떻게 이어졌나)의 3축 중 trace를 담당한다. 이상을 trace에서 발견하면 같은 시점의 로그를 `trace_id`로 좁혀 원인까지 내려간다.

---

## 4. 확인 방법·증거

로컬에서:

```bash
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
npm run dev      # web
npm run worker   # worker (별도 터미널)
# 앱에서 이미지 업로드 1건 → http://localhost:16686 → Service: dailyproof-web → Find Traces
```

확인된 결과(스크린샷):

- `080-trace-otel-jaeger-search-20260616.png` — Search 목록. `POST /api/proof-assets` trace가 **`dailyproof-web (4)` + `dailyproof-worker (3)` = 7 spans**로 한 trace에 묶임(두 서비스가 같은 trace).
- `082-trace-otel-web-worker-tree-20260616.png` — 그 trace 상세(waterfall). **Services 2 · Depth 4 · Total Spans 7**. `dailyproof-web POST /api/proof-assets/route`(root) 아래 `executing api route` → **`dailyproof-worker worker process_image`(자식)** → `storage.download` · `db.update proof_assets ready`. worker 구간이 뒤로 떨어진 건 큐 대기(비동기 처리)로, 부모-자식은 ID로 유지된다.
- `081-db-proof-assets-traceparent-20260616.png` — `proof_assets.traceparent` 컬럼에 W3C 값이 실제로 저장됨(전파 매개체).

---

## 5. k8s 배포 (jaeger)

로컬은 docker-compose에 jaeger가 있지만, k8s(helm) 차트엔 없어 배포 환경에서 트레이스 수신처가 없었다(`http://jaeger:4318`은 자리표시자였다). 이를 차트에 추가해 k8s에서도 트레이스를 수집한다. 차트 `templates/jaeger.yaml`, `values.jaeger.enabled`(기본 on).

- **Service 이름 = `jaeger`**: web·worker의 `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`이 이 이름으로 해석되도록 고정 → 코드·설정 변경 0.
- **UI(16686)는 ingress로 노출하지 않는다**: jaeger all-in-one UI는 **인증이 없어** 공개하면 누구나 트레이스(요청 메타데이터)를 본다. NetworkPolicy·보안 기조와 모순이므로 **`kubectl port-forward`로만 접근**한다.
  ```bash
  kubectl port-forward svc/jaeger 16687:16686 -n <ns>   # http://localhost:16687
  ```
- **NetworkPolicy 연동**: jaeger도 default-deny 대상이라 수신이 막힌다 → `jaeger-ingress` 정책으로 web·worker→jaeger:4318(OTLP)과 같은 ns의 UI(16686)만 허용([network.md](network.md)).
- **한계**: all-in-one + **in-memory 저장**이라 재시작 시 트레이스 소실(데모용). prod급은 별도 백엔드(ES/Tempo) 필요 → 후속.
- **환경 격리**: 같은 PC에서 compose와 k3s를 같이 띄워도 두 jaeger는 다른 네트워크라 트레이스가 섞이지 않는다([retrospective/dev-vs-k8s-environments.md](../retrospective/dev-vs-k8s-environments.md)).
- **관측 스택 분리**: 실무는 관측 스택을 앱 차트와 분리(별도 차트/네임스페이스)하지만, 여기선 단순성 위해 같은 차트에 포함했다.

## 6. 후속

- **백엔드**: 운영에선 Grafana 스택과 일관되게 **Tempo**로 export(코드 불변, endpoint만 변경). 컨테이너화·collector 도입은 후속.
- **auto-instrumentation 확대**: 현재 worker는 수동 span 중심. DB 드라이버·HTTP 계측을 더 붙이면 구간이 촘촘해진다.
- **trace_id 통합**: 로그의 `trace_id`를 OTel trace-id와 동일하게 맞추면 로그↔trace 점프가 1:1이 된다([추후]).
- **sampling**: 현재 전수. 트래픽이 늘면 tail-based sampling 등으로 비용 조절([추후]).

참고: `architecture/logging.md`(로그 필드·상관), `architecture/metrics.md`(메트릭), `architecture/worker.md`(처리 단계).
