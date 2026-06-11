# 작업 일지 (Worklog)

DailyProof DevOps 포트폴리오 작업의 진행 기록.
구조: **날짜(하루) → task(큰 제목, 순서 번호) → 작업한 일(내용)**.
관련 스크린샷은 `docs/screenshots/`에 전역 순번(`NNN-...`)으로 보관한다(git 미추적).

---

## 2026-06-09

### 1. docs 디렉토리 구조 생성 + source of truth 확정

**한 일**

- `docs/` 하위에 `plan/`, `architecture/`, `runbooks/`, `incidents/`, `performance/`, `screenshots/` 골격 생성. 빈 폴더는 `.gitkeep`으로 추적.
- 모든 산출물 원본을 repo 내부 `docs/`로 고정(source of truth). Notion은 문서 원본이 아니라 공유/정리 채널로만 사용하고, `git push → GitHub Actions → docs/** Notion sync` 구조를 목표로 함. → `docs/README.md`
- `docs/screenshots/`는 로컬 보관용으로 git 미추적(`.gitignore` 처리).
- 스크린샷 명명 규칙 수립: `<NNN>-<영역>-<대상>-<YYYYMMDD>.png`. 맨 앞 `NNN`은 유형과 무관한 **작업 전체 진행 순번**이라, 이름순 정렬 = 작업한 순서.
- worklog를 `docs/plan/`에서 `docs/worklog.md`(최상위)로 이동하고 README 인덱스 반영.

**왜**

- 이후 모든 산출물(코드·문서·증거)이 한 곳에 누적되도록 기반을 먼저 고정하기 위함.
- 스샷이 흩어지지 않고 "작업 순서"라는 맥락을 파일명만으로 갖도록 하기 위함.

**증거**

- `001-docs-directory-structure-20260609.png` — 생성된 `docs/` 디렉토리 트리

### 2. 현재 프로젝트 구조 분석

**한 일**

- 현재 코드베이스 분석: `package.json`, `src/`(actions/api/components/lib), `supabase/schema.sql`, `middleware.ts`, 업로드/미디어 프록시/grass 라우트를 읽고 정리.
- `docs/architecture/current-state.md` 작성: 기술 스택, 코드 구조, 데이터 모델(6개 테이블 + RLS + get_grass), 파일 업로드/미디어 흐름, 인증/네트워크 경계, DevOps 관점 "이미 있는 것 vs 아직 없는 것".

**핵심 파악 — 전체 구조**

- Next.js 15 App Router 단일 앱이 인증·데이터·파일 저장을 모두 Supabase(Postgres + Auth + Storage)에 위임하는 구조다.
- 서버 로직은 server actions(doits/logs/pages/preferences/templates/trackers)와 route handler(`/api/media`, `/api/grass`, `/auth/signout`)로 나뉜다.
- 데이터는 6개 테이블(`activity_templates`, `activity_logs`, `doits`, `pages`, `user_preferences`, `trackers`)로 구성되고, 모두 RLS owner-only가 걸려 있다.
- 환경 변수는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 두 개뿐이며 둘 다 클라이언트 노출 키다(서버 전용 시크릿 미사용).

**핵심 파악 — 이미 확보된 강점 (DevOps 출발점)**

- 파일 업로드 기반이 이미 있다. 업로드(`lib/supabase/upload.ts`)에 MIME 검사(`image/*`), 8MB 크기 제한, 확장자 sanitize가 들어가 있고, 저장 경로가 `media/<userId>/<kind>/<uuid>.<ext>`로 사용자별 격리된다. → 파일 저장소 정책·인증 접근 제어·업로드 실패 처리·크기 제한·캐시 정책·후처리 같은 운영 실습으로 자연스럽게 확장 가능.
- 인증된 접근 제어가 구현돼 있다. 비공개 `media` 버킷을 `/api/media` 프록시가 사용자 세션으로 download → Storage RLS(`media: read own`)가 게이트. 비소유자/익명은 404. 서명 URL 만료가 없어 Tiptap 본문에서도 안정적.
- 공개/비공개 표면이 분리돼 있다. 외부 임베드(`/api/grass/[token]`)는 추측 불가능한 토큰 + `get_grass` SECURITY DEFINER 함수로 **일자별 카운트만** 노출(원본 행 비노출), CORS·캐시(`s-maxage`, `swr`) 정책까지 표면별로 구분돼 있다.
- 운영 포인트가 명확하다. 업로드 성공률, 업로드 후 처리 지연, DB 응답 시간, 사용자별 권한 문제, 미디어 프록시 응답 성능, 재배포 시 세션/환경변수/스토리지 연동 문제 등 실제 운영에서 측정·관측할 지점이 이미 코드 상에 존재한다.
- 멱등·안전 재실행 가능한 스키마. `schema.sql`이 `if not exists` + additive migration + `updated_at` 트리거 + GIN/복합 인덱스를 갖춰 운영 변경에 견딘다.

**핵심 파악 — 부족한 점 (의도적으로 추가해야 할 운영 요소)**

- 비동기 처리 부재: job queue·worker 프로세스가 없고, 업로드는 저장 후 후처리(썸네일·포맷/크기 메타데이터·해시·중복 탐지)가 없는 동기 흐름이다.
- 상태 모델 부재: 업로드 자산의 처리 상태(`uploaded→processing→ready→failed`)를 추적하는 `proof_assets` 같은 모델이 없다.
- 컨테이너화 부재: Dockerfile / docker-compose 없음(web/worker 분리 불가).
- 배포 자동화 부재: CI/CD(GitHub Actions), IaC(Terraform) 없음.
- 오케스트레이션/GitOps 부재: Kubernetes manifests, ArgoCD 없음.
- 관측성 부재: health 엔드포인트(`/health/live`·`/ready`), 구조화 로그, 메트릭(Prometheus), 트레이싱(OpenTelemetry) 없음.
- 운영 문서 부재: runbook·incident·rollback·비용·백업/복구 문서 없음.
- 환경 분리 부재: dev/staging/prod 구분 없이 env 2개만 존재.

**핵심 파악 — 결론**

- DailyProof는 폐기/재작성 없이 "운영 요소(배포 자동화·관측성·비동기 처리·환경 분리)가 없는 일반 앱"에서 "운영 구조를 갖춘 서비스"로 확장하고자 한다.

### 3. Gap 분석 (현재 vs 목표 DevOps 범위)

**한 일**

- `docs/plan/gap-analysis.md` 작성: 현재 상태와 목표 DevOps 범위(실행계획 18개 항목 + 기반 인프라)를 항목별로 비교.
- 각 항목을 🟢있음 / 🟡부분 / 🔴없음 + Gap + 우선순위(높음/중간/낮음)로 정리.
- 현재 강점(보안·네트워크·시크릿·상태 모델·멱등 스키마)이 Gap을 줄여주는 지점을 별도 정리.

**핵심 파악**

- 애플리케이션 기능·데이터 보안(RLS)은 🟢/🟡이지만, 비동기 처리·컨테이너·배포 자동화·관측성·운영 문서는 거의 전부 🔴.
- 높음 우선순위: worker/queue·자산 상태 모델·컨테이너화·환경 분리·헬스체크·구조화 로그·메트릭·배포 자동화.
- 낮음(주로 문서): 비용·백업/복구·확장성·[추후 AWS] 이전 계획.

### 4. 직접 구현 vs 문서/설계 대체 구분

**한 일**

- `gap-analysis.md`에 6절(직접 구현 vs 문서/설계 대체) 추가: 판정 기준(환경 제약일 때만 문서 대체) + 항목별 분류 표 + 인프라 도구 결정 근거.
- 전 항목을 ✅직접(12) / 🔶혼합(5) / 📝문서(3)로 분류. 문서 대체는 환경 제약이 명확한 3개(비용·확장성·[추후 AWS])로 한정.

**결정**

- **k3s 직접 구축**: "쿠버네티스 vs k3s"가 아니라 k3s는 CNCF 인증 정식 쿠버네티스의 경량 배포판이다. `kubectl`/manifest/Helm/ArgoCD가 동일하게 동작하고 EKS 이전성도 유지된다. **로컬 단일 머신·2주라는 환경 제약**을 고려해, 쿠버네티스 운영 역량은 보여주되 클러스터 구동의 **비용·리소스 부담을 최소화**하기 위해 단일 바이너리·저메모리·ingress/storage 내장인 k3s를 택했다.
- **ArgoCD 직접 구축**: k3s 위에 설치해 sync·revision rollback까지 실제 시연.
- **Terraform 혼합**: AWS 제외로 클라우드 apply 대상이 없어, 로컬·무료 대상(docker provider/k3s)에 한해 실제 apply하고 AWS 인프라는 [추후] 문서 매핑.

### 5. 전체 아키텍처 초안 + 핵심 시나리오 확정

**한 일**

- `docs/architecture/target-architecture.md` 작성: 서비스 구성(web/worker/queue/storage/db/observability/ingress/gitops/ci·cd), 아키텍처 다이어그램, 핵심 시나리오, 자산 상태 전이, 관측성·네트워크 경계, [추후 AWS] 매핑.
- Mermaid 다이어그램 3종 추가: flowchart(전체 구조), sequenceDiagram(업로드→worker→관측), stateDiagram(proof_assets 상태 전이).

**핵심 결정**

- 핵심 시나리오를 "업로드 → asset/job 생성 → worker 후처리(메타데이터·썸네일·해시·중복탐지) → 상태 전이 → admin/관측"으로 고정. 모든 운영 항목을 이 한 흐름에 연결.
- queue는 외부 브로커 없이 **DB job table + worker polling**으로 단순화.
- 상태 모델 `uploaded→processing→ready→failed`(+재처리) 확정

**시나리오**

- 전제: 이 시나리오의 목적은 "이미지 처리 기능"이 아니다. **운영(DevOps)에서 보여줄 문제를 의도적으로 만들어내는 수단**이다. 단순 CRUD 앱은 비동기·적체·실패·스케일이 없어 관측·장애·확장 이야기를 만들 수 없으므로, DailyProof가 이미 가진 업로드 위에 worker 파이프라인을 얹어 운영 소재를 확보한다.
- worker의 처리 로직(썸네일·해시 등)은 가볍게만 구현하고, 노력은 그 주변의 운영(배포·관측·장애·스케일)에 집중한다. 문서·발표의 주인공도 "이미지 앱"이 아니라 "비동기 파이프라인 운영 경험"이다.

| 시나리오 요소 | 목적 | 결과 |
|----------------------|----------------------|-----------------------------|
| web ↔ worker 분리 | 멀티 컴포넌트 운영 | 멀티 컨테이너, K8s 별도 배포, worker만 HPA 스케일 |
| DB job table 큐 | 비동기·백프레셔 | `queue_depth` 메트릭, **큐 적체 장애** 재현 |
| 상태 전이(stuck/failed) | 실패 복구·재처리 | admin에서 stuck/failed 조회·재처리, **stuck job 장애** |
| 수락↔ready 지연 | 지연 관측·SLO | latency 측정, **트레이스로 web→worker→DB 구간 추적** |
| worker 다운/메모리 부족 | 장애 복구 | **pod 재시작 장애**, 복구 runbook |
| staging→smoke→prod | 안전 배포 | 배포 자동화 + 롤백 시연(ArgoCD revision) |

### 6. 환경 분리 전략 초안

**한 일**

- `docs/architecture/environments.md` 작성: dev/staging/prod 정의, 분리 수단(app config·K8s namespace·GitHub Environment·도메인), 환경별 차이 매트릭스, 환경 변수 정리, 시크릿 주입 지점, Supabase 분리 제약, 예상 매니페스트 구조.

**핵심 결정**

- 분리 원칙은 "코드/이미지는 동일, 환경별 주입값만 다름"(stateless·12-factor). K8s는 네임스페이스 + Kustomize overlays(또는 Helm values)로 분리.
- 승격 흐름: dev(로컬) → staging 자동 배포 → smoke 통과 → prod 수동 승인.
- worker 도입으로 **서버 전용 시크릿**(`SUPABASE_SERVICE_ROLE_KEY` 등)이 처음 등장 → 로컬 `.env.local`, staging/prod는 K8s Secret, CI는 GitHub Environment로 분리 주입.
- Supabase는 이상적으로 환경별 별도 프로젝트, 계정 제약 시 단일 프로젝트+키/스키마 분리로 차선. 실제 선택은 컨테이너화·k3s 배포 구축 단계에서 확정해 기록.

### 7. proof_assets / jobs DB 스키마 초안

**한 일**

- `supabase/proof_assets.draft.sql` 작성: 자산 상태 모델 `proof_assets` + 작업 큐 `jobs` 초안. 기존 `schema.sql` 컨벤션(멱등·RLS owner-only·touch_updated_at 트리거·인덱스) 준수.
- `proof_assets`: source_path·kind·status(uploaded/processing/ready/failed)·메타데이터(content_type/size/width/height/checksum/thumb_path)·error_code/message.
- `jobs`: asset_id·status(pending/processing/done/failed)·attempts/max_attempts·run_after(백오프)·locked_at/locked_by(선점).

**핵심 설계**

- 큐는 외부 브로커 없이 **DB job table + polling**. `claim_job(worker)` 함수에서 **FOR UPDATE SKIP LOCKED**로 다중 worker 동시성 안전 확보.
- 폴링 성능: `jobs_pending_idx`(부분 인덱스, status='pending'), 적체 측정용 `jobs_status_idx`(= `queue_depth` 지표 근거).
- worker는 **SERVICE_ROLE 키로 RLS 우회**(environments.md의 서버 전용 시크릿과 연결), 사용자는 RLS owner-only로 자기 자산 상태만 조회.
- 중복 탐지용 `proof_assets_checksum_idx`(user_id, checksum).

**비고**

- 이 파일은 설계 **초안**(`.draft.sql`)이다. 실제 적용은 worker 구현 단계에서 schema.sql 통합/마이그레이션으로 반영.

### 8. Notion sync 구조 설계 + workflow 초안

**한 일**

- `docs/plan/notion-sync.md` 작성: docs→Notion 단방향 동기화 설계(원칙·흐름·페이지 매핑·마크다운 변환·시크릿·미결 사항).
- `.github/workflows/notion-sync.yml` 초안: `push` + `paths: docs/**` 트리거, `NOTION_TOKEN` 미설정 시 조용히 skip(실패 방지), concurrency로 중복 실행 취소.

**핵심 설계**

- 단방향(repo→Notion), source of truth는 repo. Notion은 공유/열람 채널.
- 멱등 갱신을 위해 파일경로↔Notion pageId 매핑 필요 → 1순위는 매니페스트(`docs/.notion-map.json`).
- Mermaid는 Notion 네이티브 렌더링 불가 → 코드 블록 보존 또는 이미지 변환(구현 시 결정).
- sync 실패가 배포를 막지 않도록 배포 파이프라인과 분리.

**비고**

- 여기서 토큰 = `NOTION_TOKEN`(Notion API 인증 키). 아직 발급·등록 전이라, 등록 전까지는 push 시 워크플로가 ❌ 실패하지 않도록 토큰 부재 시 조용히 skip하게 가드를 둠.
- 실제 sync 스크립트(`scripts/notion-sync.mjs`)는 추후 구현. 토큰을 GitHub Secrets에 등록하면 가드가 풀려 실제 sync가 동작.

### 9. Notion sync 파이프라인 구현 (push→Notion 자동 생성)

**한 일**

- `scripts/notion-sync.mjs` 구현: 마크다운→Notion 블록 변환기 + upsert 동기화. 헤딩·문단·굵게/코드/링크·목록·체크박스·인용·표·코드블록(mermaid 보존)·구분선 지원.
- `docs/` 트리를 **폴더 구조로 미러링**(폴더=컨테이너 페이지, 파일=잎 페이지). 상태 파일 없이 부모 페이지의 child_page 제목으로 매칭(stateless).
- `.github/workflows/notion-sync.yml` 완성: 변경된 `docs/**/*.md`만 git diff로 골라 동기화, 토큰 부재 시 skip.
- `@notionhq/client` 의존성 + `npm run notion:sync` 스크립트 추가. 로컬에서 실제 Notion 생성/중첩 구조 검증 완료.

**핵심 결정**

- 외부 변환 라이브러리(martian 등)는 WSL `/mnt/d`의 chmod 제약으로 설치 실패 → 의존성을 `@notionhq/client` 하나로 줄이고 변환기를 직접 구현.
- 매핑은 매니페스트 파일 대신 **stateless child_page 조회**로 결정(CI에서 커밋백 불필요).
- 갱신 시 문서 페이지의 **본문 블록만 교체** → 수동으로 단 이모지/아이콘은 보존(단, 페이지 제목은 매칭 키라 직접 변경 금지).

**비고**

- 다음: GitHub Secrets(`NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`) 등록 시 push 자동 동기화 활성화.

### 10. GitHub Secrets 등록 · 자동 동기화 활성화

**한 일**

- GitHub repo(ompangyji/dailyproof) → Settings → Secrets and variables → Actions에 `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` 등록.
- 이로써 `docs/**` push 시 `notion-sync` 워크플로가 토큰 가드를 통과해 실제 동기화를 수행하도록 활성화.
- `gh` CLI 미설치라 시크릿 등록은 웹 UI로 진행.

**확인 방법**

- push 후 repo의 Actions 탭에서 `notion-sync` 실행 성공(초록) 확인.
- Notion 부모 페이지에서 변경 문서 갱신 확인.

**비고**

- 시크릿 등록 → push 순서를 지켜야 첫 push에서 바로 동기화됨(반대면 첫 실행은 skip).

---

## 2026-06-10

### 1. 브랜치 전략 정의

**한 일**

- `docs/architecture/branching.md` 작성: 코드 작업 본격 시작 전에 브랜치 모델을 먼저 고정. 후보(GitHub Flow+환경 승격 / 트렁크 기반 / Git Flow) 비교 → **GitHub Flow + 환경 승격** 채택. 브랜치 구조·명명 규칙(`feature/*`·`fix/*`·`docs/*`·`chore/*`), 흐름(mermaid), PR·머지 규칙, 환경 분리 매핑, 적용 방침을 한 문서로 정리.
- `docs/README.md` 인덱스에 `branching.md` 추가.

**핵심 결정 — GitHub Flow + 환경 승격 채택**

채택 근거:

- `environments.md`의 dev→staging→prod 승격 단계와 브랜치/배포 이벤트가 1:1로 맞물린다.
- `main = 항상 배포 가능`이 GitOps(ArgoCD)·자동배포의 전제와 일치한다.
- 1인·2주 단기 작업이라 장수 브랜치를 둘 이유가 없다(Git Flow는 관리 비용만 늘어 제외).

고정한 규칙:

- `main`은 보호 브랜치 — 직접 push 금지, PR로만 반영.
- CI 게이트(lint·build·test) 통과해야 merge 가능.
- `main` merge = staging 자동 배포.
- prod 승격은 수동 승인 또는 `vX.Y.Z` 태그.
- 장애 시 ArgoCD 리비전 롤백.
- 커밋은 Conventional Commits.

**첫 작업 브랜치**

- `feature/async-pipeline` — proof_assets/jobs 스키마부터 업로드→job 생성까지의 비동기 파이프라인 작업 단위.

**목적 (왜 1인 프로젝트인데 이 흐름을 따르나)**

- 혼자 하는 프로젝트라 사실 `main`에 바로 커밋해도 동작에는 지장이 없다. 그럼에도 `feature/* → push → PR → (검토/CI) → main merge → 자동 배포`라는 실무 표준 흐름을 그대로 밟는다.
- 이유: 이 포트폴리오의 목표는 "기능을 만든다"가 아니라 **"실무 DevOps 운영 흐름을 이해하고 실제로 수행했다"를 기록하는 것**이다. PR 기록·CI 통과·merge 단위가 그 자체로 산출물이 된다.
- 부수 효과: 변경이 PR 단위로 끊겨 기록되고, CI가 깨진 코드의 main 진입을 막아주며, `main = 항상 배포 가능`이 유지돼 뒤에서 붙일 자동 배포(ArgoCD)의 트리거가 깔끔해진다.
- 즉 지금 단계는 자동화를 만든 게 아니라, **그 자동화가 올라탈 규칙과 흐름(레일)을 먼저 깐 것**이다.

**비고**

- 전략 도입 변경(이 규칙을 정의한 첫 커밋)은 규칙이 적용되기 전이라 어쩔 수 없이 main에 직접 커밋했고, 이후 코드 작업부터 `feature/*` + PR 흐름을 따른다.
- 브랜치 보호·CI 게이트·prod 승인 등 자동화는 GitHub Actions / GitHub Environment / ArgoCD 구축 단계에서 이 규칙에 맞춰 실제 연결.

### 2. proof_assets / jobs 스키마 통합 (schema.sql 반영)

**한 일**

- 06-09에 만든 초안 `supabase/proof_assets.draft.sql`을 정식 `supabase/schema.sql` 끝에 **통합**하고 draft 파일은 제거(단일 소스 유지).
- 통합 시 중복 제거: `create extension pgcrypto`, `touch_updated_at()` 함수는 schema.sql 상단에 이미 있어 재정의하지 않고 재사용.
- 멱등·additive 컨벤션 유지(`create table if not exists`, `create index if not exists`, `drop policy ... + create policy`).

**핵심 설계 (초안에서 그대로 가져온 것)**

- `proof_assets`: 업로드 자산의 처리 상태(`uploaded→processing→ready→failed`) + 후처리 메타데이터(content_type/size/width/height/checksum/thumb_path) + 실패정보.
- `jobs`: 자산당 후처리 작업 큐. `attempts/max_attempts`(재시도), `run_after`(백오프), `locked_at/locked_by`(선점). 외부 브로커 없이 DB 큐 + polling.
- `claim_job(worker)`: `FOR UPDATE SKIP LOCKED`로 다중 worker가 같은 job을 잡지 않게 1건 선점.
- 인덱스: `jobs_pending_idx`(pending 부분 인덱스, 폴링), `jobs_status_idx`(`queue_depth` 지표), `proof_assets_checksum_idx`(중복 탐지).

**통합하며 보강한 점**

- `claim_job`의 실행 권한을 명시적으로 잠금: Postgres는 함수에 기본적으로 PUBLIC EXECUTE를 주므로, `revoke all ... from public` 후 `grant execute ... to service_role`로 **워커(service_role)만 큐를 선점**할 수 있게 했다. authenticated 사용자가 큐를 조작하는 경로를 차단.

**ERD 문서화**

- 통합 전/후 ERD를 **mermaid `erDiagram`로, 각각 별도 md 파일**로 남김. 스크린샷이 아니라 다이어그램 as 코드라 변화가 커밋 diff로 남고 GitHub/Notion에 렌더된다.

**적용 방법 / 비고**

- 로컬에 psql·supabase CLI가 없어 자동 적용은 불가 → **Supabase SQL Editor에서 `schema.sql` 실행**으로 반영(멱등이라 전체 재실행해도 안전, 신규 객체만 추가됨). 적용 완료.
- 적용 후 확인: `proof_assets`/`jobs` 테이블 생성, RLS 활성화, `claim_job` 함수 존재.
- 데이터 흐름(업로드 시 asset+job 생성)은 다음 작업에서 코드로 연결.

**자료**

- `docs/architecture/erd-before.md` — 통합 전 ERD (기존 6테이블)
- `docs/architecture/erd-after.md` — 추가 후 ERD (+proof_assets, jobs)
