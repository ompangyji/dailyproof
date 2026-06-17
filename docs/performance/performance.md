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

## threshold (성능 기준 = run 합/불)

`scripts/load/baseline.js`에 박아 둔 초기 기준(첫 측정 뒤 환경에 맞게 조정):

| 시나리오 | p95 지연 | 실패율 |
|---|---|---|
| `health_live` (순수 앱) | `< 200 ms` | `< 1%` |
| `metrics_read` (조회+DB) | `< 800 ms` | `< 5%` |

threshold 미달이면 k6가 **non-zero로 종료** → 추후 CI 성능 게이트로도 쓸 수 있다(merge 전/배포 후 게이트와 같은 결).

## baseline 결과

> 측정 환경: (예) k3s staging web Pod, VUS=20, 시나리오당 20s. _실측 후 채움._

| 시나리오 | RPS | p50 | p95 | p99 | max | 실패율 |
|---|---|---|---|---|---|---|
| `health_live` (순수 앱) | _ | _ | _ | _ | _ | _ |
| `metrics_read` (조회+DB) | _ | _ | _ | _ | _ | _ |

## 병목 가설

- **DB 왕복이 지연의 지배 요인일 것**: `metrics_read` p95 − `health_live` p95 ≈ `metrics_snapshot` RPC + 직렬화 비용. 이 차이가 크면 DB(RPC 쿼리·집계·커넥션)부터 본다.
- **개선 후보**: ① `metrics_snapshot` 쿼리/집계 비용 점검, ② 결과 캐시(짧은 TTL — 메트릭은 약간의 staleness 허용 가능), ③ DB 커넥션 풀/위치(앱↔DB 왕복 거리), ④ 앱 직렬화 경로.
- 개선 적용 후 같은 시나리오로 재측정해 before/after를 비교한다.

> 측정·개선 기록은 `worklog.md`, 도구 선택 근거는 회고 참고.
