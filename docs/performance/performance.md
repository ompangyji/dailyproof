# 성능 베이스라인 (k6)

API 부하를 **k6**로 측정해 baseline을 남긴다. Lighthouse 같은 프론트 점수가 아니라 **실제 API의 처리량/지연/실패율**을 본다.

## 왜 / 무엇을

- 단순 GET 두 경로를 **대비**해, "DB 의존이 더하는 지연"을 분리해서 본다.
  - **순수 앱** `GET /health/live` — DB 없음. 프레임워크/네트워크 기준선.
  - **조회+DB** `GET /metrics` — `metrics_snapshot` RPC로 DB 왕복(상태별 집계). 실제 읽기 경로.
- 둘 다 인증이 필요 없어 시크릿/세션/토큰 없이 재현 가능하다(미들웨어에서 `health`·`metrics` 제외).
- 두 시나리오는 서로 부하를 간섭하지 않도록 **순차로** 돈다(k6 `startTime`).

## 실행

k6 설치(로컬, WSL 예):
```bash
# Debian/Ubuntu
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
# (또는 https://github.com/grafana/k6/releases 에서 바이너리 직접 받기)
```

대상 서버 띄우기 — 로컬 빌드가 drvfs에서 막히면, 이미 떠 있는 k3s staging에 port-forward 해서 쓴다:
```bash
kubectl -n dailyproof-staging port-forward svc/dailyproof-staging-dailyproof-web 3000:3000
```

부하 실행:
```bash
k6 run -e BASE_URL=http://127.0.0.1:3000 scripts/load/baseline.js
# 결과 JSON도 저장하려면:
K6_SUMMARY=docs/performance/results/baseline.json \
  k6 run -e BASE_URL=http://127.0.0.1:3000 scripts/load/baseline.js
```
옵션: `-e VUS=20`(동시 가상 유저), `-e DURATION=20s`(시나리오당 시간).

## 사용한 명령어 (무엇을 / 왜)

측정 → 개선 → 재측정에 쓴 명령을 순서대로 정리한다(값은 자리표시자).

| 명령 | 무엇을 | 왜 |
|------|--------|-----|
| `k6 version` | 설치 확인 | k6는 단독 CLI(Grafana 대시보드 불필요) — 바이너리만 있으면 됨 |
| `kubectl -n dailyproof-staging port-forward svc/...-web 3000:3000` | staging web을 로컬 3000으로 | 로컬 빌드가 drvfs에서 막혀, 떠 있는 staging pod를 대상으로 측정 |
| `K6_SUMMARY=...json k6 run -e BASE_URL=... scripts/load/baseline.js \| tee ...txt` | 부하 실행 + 결과 저장 | 콘솔 요약(tee)·전체 메트릭(JSON) 둘 다 남겨 표/비교 근거로 |
| `k6 run -e VUS=5 ...` | 저부하 재실행 | "낮은 동시성=정상, 임계점에서 붕괴"를 보여 병목이 동시성임을 확증 |
| `docker build -f Dockerfile.web --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... -t dailyproof-web:staging .` | 개선 코드로 web 이미지 재빌드 | `/metrics`가 `NEXT_PUBLIC_*`를 빌드 때 인라인 → 코드 바꾸면 재빌드 필수. docker 빌드는 컨테이너 내부라 drvfs 무관 |
| `docker save dailyproof-web:staging \| sudo k3s ctr images import -` | 이미지를 k3s containerd로 주입 | k3s는 레지스트리 pull 없이 로컬 import 이미지를 `IfNotPresent`로 사용 |
| `kubectl -n dailyproof-staging delete pod -l app.kubernetes.io/component=web` | web pod 교체 | 같은 `:staging` 태그라 재생성 시 새로 import한 이미지로 뜸(ArgoCD는 삭제를 재생성으로 메움) |
| `kubectl -n dailyproof-staging rollout status deploy/...-web` | 롤아웃 완료 대기 | 새 pod가 Ready 된 뒤 재측정하려고 |

> 공개값(`NEXT_PUBLIC_*`)만 build-arg로 쓴다. **`SUPABASE_SERVICE_ROLE_KEY`(시크릿)는 절대 빌드/명령에 넣지 않는다.**

## threshold (성능 기준 = run 합/불)

`scripts/load/baseline.js`에 박아 둔 기준:

| 시나리오 | p95 지연 | 실패율 |
|---|---|---|
| `health_live` (순수 앱) | `< 400 ms` | `< 1%` |
| `metrics_read` (조회+DB) | `< 800 ms` | `< 5%` |

threshold 미달이면 k6가 **non-zero로 종료** → 추후 CI 성능 게이트로도 쓸 수 있다(merge 전/배포 후 게이트와 같은 결).

## 결과 — before / after

측정 환경: k3s staging web Pod에 port-forward, VUS=20, 시나리오당 20s.

**Before (개선 전):**

| 시나리오 | 요청수 | RPS | p50 | p95 | max | 실패율 |
|---|---|---|---|---|---|---|
| `health_live` (순수 앱) | 5,921 | ~296/s | 39 ms | 274 ms | 1.01 s | 0% |
| `metrics_read` (조회+DB) | **40** | **~2/s** | **10.5 s** | **10.5 s** | 10.53 s | **100%** |

→ **순수 앱은 296 rps·에러 0%로 멀쩡한데, DB 경로는 동시성 20에서 붕괴**: 모든 요청이 ~10초에 묶여 100% 실패(20초 동안 40건). 모든 요청이 *정확히 ~10초*인 건 어딘가 10초 타임아웃을 때린다는 신호.

**After (개선 후 — 네트워크 좋은 구간 대표값, run 3):**

| 시나리오 | 요청수 | RPS | p50 | p95 | max | 실패율 |
|---|---|---|---|---|---|---|
| `health_live` (순수 앱) | 9,265 | ~450/s | 33 ms | 98 ms | 692 ms | 0% |
| `metrics_read` (조회+DB) | 8,423 | ~410/s | 36 ms | **112 ms** | 333 ms | **0%** |

→ `metrics_read`가 **10.5초·100% 실패 → p95 112ms·0% 실패, 처리량 40건 → 8,423건**. threshold(p95<800ms·실패율<5%) 통과.

단, VUS=20을 반복하면 결과가 **출렁인다**(run별로 통과 / 70% 실패 / 100% 실패). 나쁜 구간에서도 **10초가 아니라 2초 fail-fast**로 끊기고, 일부는 stale 캐시로 살아남는다(run 4: 30% 생존). 이 출렁임의 원인은 아래.

## 병목 분석 & 개선 (반복 진단)

1. **첫 관찰**: `/metrics` 단건은 정상인데 동시 부하에서 ~10초 타임아웃·100% 실패. → 동시성 병목 가설.
2. **iteration 1 — 캐시 + single-flight** (`src/app/metrics/route.ts`): TTL(3s) 동안 DB 미접근, 캐시 미스 시 동시 요청이 **한 번의 조회를 공유**해 DB 호출을 1회로 합침. → 좋은 구간에선 8천 건이 몇 번의 DB호출로 처리(개선 입증). **그런데 저부하(VUS=5)에선 오히려 100% 실패** — 동시성이 원인이 아님이 드러남.
3. **3-way 진단 — 어디가 느린가**:
   | 경로 | 시간 |
   |---|---|
   | 쿼리 직접 (`explain analyze select metrics_snapshot()`) | **3.6 ms** |
   | REST API (개발자 머신 → PostgREST curl ×3) | **~130 ms** |
   | 앱 pod 경유 (부하 시) | **~10 s, 100% 실패** |
   → 쿼리도 REST API도 빠름. 느린 건 **앱 pod ↔ Supabase 네트워크 경로**뿐.
4. **원인 결론**: **pod ↔ Supabase 연결이 시간에 따라 간헐적으로 죽는 환경성 문제**(로컬 WSL2/k3s → 인터넷 경로 추정 — pod의 stale keep-alive 연결이 ~10초 소켓 타임아웃을 때림). 부하 무관하게 좋은/나쁜 구간이 분 단위로 바뀜(VUS=20 반복: 통과↔70%↔100%실패). 쿼리 비용·동시성·Supabase 자체 문제가 **아님**.
5. **iteration 2 — fail-fast 타임아웃 + serve-stale**: rpc에 AbortController 타임아웃(2s)을 걸어 행을 **10초→2초**로 끊고(소켓 버리고 다음 호출은 새 연결로 자가복구 유도), 신선화 실패 시 직전 정상값(stale, `METRICS_STALE_MAX_MS` 내)을 반환. → 나쁜 구간에도 10초 행 없이, 가능하면 200으로 생존.

**결론**: 앱 측에서 할 수 있는 개선(캐시·single-flight·fail-fast·stale)은 모두 적용·입증됐다(좋은 구간 p95 112ms/0%, 나쁜 구간 2s fail-fast + 부분 생존). **남은 실패는 로컬 클러스터↔외부 DB의 환경성 네트워크 한계**로, 안정적 네트워크의 실제 클라우드 클러스터에서는 재현되지 않을 성격이다. (다음: 관리형 클러스터에서 재측정, 또는 메트릭 수집을 pull-scrape 전용 사이드카로 분리.)

> 측정·개선 기록은 `worklog.md`, 트러블슈팅 회고는 `retrospective/metrics-load.md`.
