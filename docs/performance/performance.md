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

**After (개선 후):** _재측정 후 채움._

| 시나리오 | 요청수 | RPS | p50 | p95 | max | 실패율 |
|---|---|---|---|---|---|---|
| `health_live` (순수 앱) | _ | _ | _ | _ | _ | _ |
| `metrics_read` (조회+DB) | _ | _ | _ | _ | _ | _ |

## 병목 분석 & 개선

- **관찰**: `/metrics` 단건은 정상(배포 후 smoke 통과)인데 **동시 부하에서만** ~10초 타임아웃·100% 실패 → 엔드포인트가 깨진 게 아니라 **동시성/리소스 병목**.
- **원인 가설**: `/metrics`가 **요청마다 Supabase 클라이언트를 새로 만들고 `metrics_snapshot` RPC**를 친다. 20 VU가 동시에 DB 커넥션을 잡아 **포화** → 대기 끝에 ~10초 한계에서 타임아웃. (커넥션 재사용·결과 캐시 없음. 보조 요인: 단일 web pod `replicas:1`/`cpu:1`, Supabase 등급 커넥션 한도.)
- **개선**: `/metrics`에 **짧은 TTL(기본 3s) 인메모리 캐시 + single-flight**를 적용(`src/app/metrics/route.ts`).
  - TTL 동안은 DB를 안 치고 캐시된 본문을 반환.
  - 캐시 미스 시 동시 요청은 **진행 중인 한 번의 조회를 공유**(single-flight)해 DB 호출을 1회로 합침 → 커넥션 포화 제거.
  - 메트릭은 scrape 주기보다 짧은 staleness라 정확도 영향 미미.
- **기대 효과**: `metrics_read`가 타임아웃에서 벗어나 p95<800ms·실패율<5% 충족(threshold 통과). after 표에서 검증.

> 측정·개선 기록은 `worklog.md`, 도구 선택 근거는 회고 참고.
