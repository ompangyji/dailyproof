# 환경 분리 전략 (Environments)

Gap 분석 항목 1(운영 환경 분리, ✅ 직접)의 설계 문서.
`dev` / `staging` / `prod` 세 환경을 어떻게 나누고, 무엇이 환경마다 달라지며, 시크릿은 어디서 주입되는지 정의한다.

기준일: 2026-06-09 · 전제: 로컬(k3s) 직접 구현, AWS는 [추후]

---

## 1. 환경 3종 정의

| 환경 | 목적 | 실행 위치 | 트래픽 |
|------|------|-----------|--------|
| `dev` | 개발·디버깅 | 로컬 (docker-compose 또는 `next dev`) | 개발자 본인 |
| `staging` | 배포 전 검증·smoke test | k3s `dailyproof-staging` 네임스페이스 | 내부 검증용 |
| `prod` | 실제 서비스 | k3s `dailyproof-prod` 네임스페이스 | 실사용자 |

배포 승격(promotion) 흐름:

```
dev (로컬) → staging 자동 배포 → smoke test 통과 → prod 반영
```

---

## 2. 분리 수단

환경은 아래 4개 레이어로 분리한다. "코드는 같고, 환경별로 주입값만 다르다"가 원칙(stateless·12-factor).

| 레이어 | 분리 방법 |
|--------|-----------|
| 애플리케이션 설정 | 환경별 env 값 주입(이미지/코드는 동일) |
| Kubernetes | 네임스페이스 분리 (`dailyproof-staging` / `dailyproof-prod`) + 환경별 values 파일 |
| 배포 권한·시크릿 | GitHub Environment (`staging` / `prod`) — prod는 수동 승인 게이트 |
| 도메인/Ingress | 환경별 호스트 (`staging.dailyproof.local` / `dailyproof.local`) |

> 용어: **k3s**는 우리가 띄우는 클러스터 제품이고, **Kubernetes**는 그 클러스터가 따르는 표준이다. k3s는 쿠버네티스 경량 배포판이라 Namespace·Secret·ConfigMap 같은 리소스 개념을 동일하게 제공하므로, 아래에서 "Kubernetes Secret/네임스페이스"는 곧 k3s에서 쓰는 그 리소스를 가리킨다.

---

## 3. 환경별 차이 매트릭스

| 항목 | dev | staging | prod |
|------|-----|---------|------|
| web replicas | 1 | 1 | 2+ (HPA) |
| worker replicas | 1 | 1 | 1~N (HPA, queue depth 기반) |
| 로그 레벨 | `debug` | `info` | `info`(에러 강조) |
| 리소스 limit | 느슨 | 중간 | 명시적 requests/limits |
| 시크릿 출처 | `.env.local` | Kubernetes Secret(staging) | Kubernetes Secret(prod) |
| 외부 노출 | 없음 | 내부 호스트 | 서비스 호스트 + TLS |
| 트레이싱 샘플링 | 100% | 50% | 10%(비용 고려) |
| 배포 트리거 | 수동/로컬 | main push 시 자동 | staging 검증 후 수동 승인 |

---

## 4. 환경 변수 정리

현재(`current-state.md`)는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 둘뿐이다. 목표 구조에서 추가될 변수를 환경별로 정리한다.

| 변수 | 성격 | dev | staging | prod | 비고 |
|------|------|-----|---------|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | 공개 | ○ | ○ | ○ | 클라이언트 노출 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 공개 | ○ | ○ | ○ | 클라이언트 노출 |
| `SUPABASE_SERVICE_ROLE_KEY` | **시크릿** | ○ | ○ | ○ | worker가 RLS 우회 처리 시. 서버 전용 |
| `DATABASE_URL` | **시크릿** | ○ | ○ | ○ | worker 직접 접속용(선택) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 설정 | ○ | ○ | ○ | 트레이스 콜렉터 주소 |
| `LOG_LEVEL` | 설정 | debug | info | info | |
| `APP_ENV` | 설정 | dev | staging | prod | 로그·메트릭 라벨 |

> 신규로 **서버 전용 시크릿**(`SERVICE_ROLE_KEY` 등)이 등장한다. 현재는 `NEXT_PUBLIC_*`만 있어 클라이언트 노출만 다뤘지만, worker가 생기면서 서버 전용 비밀이 필요해진다. 주입 방식은 5절.

---

## 5. 시크릿 주입 지점 (환경별)

| 환경 | 주입 방식 |
|------|-----------|
| dev | `.env.local` (git 미추적, 이미 `.gitignore` 처리됨) |
| staging/prod | **Kubernetes Secret** (네임스페이스별로 분리). manifest에는 값이 아니라 참조만. |
| CI/CD | **GitHub Actions Secrets** + GitHub Environment(`staging`/`prod`)로 노출 범위 제한 |

원칙:

- 시크릿 값은 **git에 절대 커밋하지 않는다.** manifest는 `secretKeyRef` 참조만 둔다.
- 회전(rotation) 자동화는 환경 제약상 절차 문서로 대체(gap 2: 🔶 혼합). 교체 가능한 구조(Secret 갱신 → rollout restart)는 갖춘다.
- 상세 시크릿 관리는 별도 문서(`runbooks/secrets.md`, 추후)로 확장.

---

## 6. Supabase 환경 분리 (현실적 제약)

이상적으로는 **환경마다 Supabase 프로젝트를 따로** 두는 것이 맞다(데이터 격리). 다만 무료/단일 계정 제약으로 프로젝트를 여러 개 두기 어려울 수 있다.

- 1순위(이상): dev/staging/prod 각각 별도 Supabase 프로젝트 → URL/키가 환경별로 완전 분리.
- 차선(제약 시): 단일 프로젝트를 쓰되 **환경별 키·스키마/접두사 분리**로 최소한의 격리 + 문서에 한계 명시.
- 어느 쪽이든 **앱은 URL/키를 주입값으로만 받으므로 코드 변경 없이 전환** 가능하게 유지한다.

> 이 선택(별도 프로젝트 vs 단일 프로젝트)은 **컨테이너화·k3s 배포 구축 단계**에서 계정 상황을 보고 확정하고, 결정과 근거를 worklog에 남긴다.

---

## 7. 예상 디렉토리/매니페스트 구조 (추후 구현)

```
k8s/
├── base/                 # 공통 manifest (Kustomize base)
│   ├── web.yaml
│   ├── worker.yaml
│   └── ...
└── overlays/
    ├── staging/          # 네임스페이스·replicas·env 오버라이드
    └── prod/
environments/
├── README.md             # 이 문서 연계
├── .env.dev.example
├── .env.staging.example
└── .env.prod.example
```

(Helm을 쓸 경우 `values-staging.yaml` / `values-prod.yaml`로 동일 개념 표현.)

---

## 8. 다음 작업

- [Day1-7] `proof_assets`/`jobs` DB 스키마 초안 — 서버 전용 시크릿이 필요한 worker의 데이터 접근 설계와 연결
- (추후) `.env.*.example`, Kustomize overlays 실제 생성
