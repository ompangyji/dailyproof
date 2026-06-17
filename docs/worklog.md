# 작업 일지 (Worklog)

DailyProof DevOps 포트폴리오 작업의 진행 기록.
구조: **날짜(하루) → task(큰 제목, 순서 번호) → 작업한 일(내용)**.
관련 스크린샷은 `docs/screenshots/`에 전역 순번(`NNN-...`)으로 보관한다(git 미추적).

---

## 2026-06-09

### 1. docs 디렉토리 구조 생성 + source of truth 확정

**이전 상태 / 문제**

- 작업을 막 시작한 시점이라 산출물(코드·문서·증거)을 **어디에 어떤 규칙으로 쌓을지 기준이 없었다.**
- 기준 없이 진행하면 문서·스샷이 흩어지고, 원본이 repo인지 Notion인지 모호해져 나중에 source of truth가 충돌한다.
- → 무엇을 만들기 전에 산출물의 집(디렉토리)·원본 위치·명명 규칙부터 고정한다.

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

**이전 상태 / 문제**

- 목표(DevOps 확장)는 있는데, 정작 **현재 코드베이스가 무엇을 이미 갖췄고 무엇이 없는지** 정리된 게 없었다.
- 현재를 모르면 "무엇을 새로 만들고 무엇을 재사용할지" 판단이 안 돼, 멀쩡한 걸 다시 만들거나 빠뜨릴 위험이 있다.
- → 코드·데이터·경계를 읽어 "이미 있는 강점 vs 없는 운영 요소"를 먼저 정리한다.

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

**이전 상태 / 문제**

- 현재 상태(2번)와 목표 범위가 각각 따로 정리됐을 뿐, **둘을 항목별로 맞대어 본 적이 없었다.**
- 비교가 없으면 무엇이 얼마나 비었는지(우선순위)와 2주 안에 무엇부터 손댈지가 안 보인다.
- → 항목별 현재 vs 목표를 🟢/🟡/🔴 + 우선순위로 한 표에 비교한다.

**한 일**

- `docs/plan/gap-analysis.md` 작성: 현재 상태와 목표 DevOps 범위(실행계획 18개 항목 + 기반 인프라)를 항목별로 비교.
- 각 항목을 🟢있음 / 🟡부분 / 🔴없음 + Gap + 우선순위(높음/중간/낮음)로 정리.
- 현재 강점(보안·네트워크·시크릿·상태 모델·멱등 스키마)이 Gap을 줄여주는 지점을 별도 정리.

**핵심 파악**

- 애플리케이션 기능·데이터 보안(RLS)은 🟢/🟡이지만, 비동기 처리·컨테이너·배포 자동화·관측성·운영 문서는 거의 전부 🔴.
- 높음 우선순위: worker/queue·자산 상태 모델·컨테이너화·환경 분리·헬스체크·구조화 로그·메트릭·배포 자동화.
- 낮음(주로 문서): 비용·백업/복구·확장성·[추후 AWS] 이전 계획.

### 4. 직접 구현 vs 문서/설계 대체 구분

**이전 상태 / 문제**

- gap 목록은 나왔지만 "이걸 **다 직접 구축할 수 있나**"에 대한 기준이 없었다(로컬 단일 머신·2주·무료 계정 제약이 큼).
- 기준 없이 다 직접 하려다 시간 부족으로 어중간해지거나, 반대로 다 문서로 때워 실증이 빈약해질 위험이 있다.
- → "환경 제약일 때만 문서 대체"라는 기준으로 직접/혼합/문서를 분류하고 인프라 도구(k3s 등)를 확정한다.

**한 일**

- `gap-analysis.md`에 6절(직접 구현 vs 문서/설계 대체) 추가: 판정 기준(환경 제약일 때만 문서 대체) + 항목별 분류 표 + 인프라 도구 결정 근거.
- 전 항목을 ✅직접(12) / 🔶혼합(5) / 📝문서(3)로 분류. 문서 대체는 환경 제약이 명확한 3개(비용·확장성·[추후 AWS])로 한정.

**결정**

- **k3s 직접 구축**: "쿠버네티스 vs k3s"가 아니라 k3s는 CNCF 인증 정식 쿠버네티스의 경량 배포판이다. `kubectl`/manifest/Helm/ArgoCD가 동일하게 동작하고 EKS 이전성도 유지된다. **로컬 단일 머신·2주라는 환경 제약**을 고려해, 쿠버네티스 운영 역량은 보여주되 클러스터 구동의 **비용·리소스 부담을 최소화**하기 위해 단일 바이너리·저메모리·ingress/storage 내장인 k3s를 택했다.
- **ArgoCD 직접 구축**: k3s 위에 설치해 sync·revision rollback까지 실제 시연.
- **Terraform 혼합**: AWS 제외로 클라우드 apply 대상이 없어, 로컬·무료 대상(docker provider/k3s)에 한해 실제 apply하고 AWS 인프라는 [추후] 문서 매핑.

### 5. 전체 아키텍처 초안 + 핵심 시나리오 확정

**이전 상태 / 문제**

- 추가할 운영 요소(컨테이너·관측성·배포·비동기)가 목록으로는 있지만, **서로 어떻게 연결되는지·무엇을 만들지 한 흐름이 없었다.**
- 흐름이 없으면 항목들이 따로 놀아 산만해지고, "왜 하필 이미지 후처리인가" 같은 시나리오 정당성도 흐려진다.
- → 업로드→asset/job→worker→상태전이→관측을 하나의 핵심 시나리오로 묶고, 모든 운영 항목을 여기에 건다.

**한 일**

- `docs/architecture/target-architecture.md` 작성: 서비스 구성(web/worker/queue/storage/db/observability/ingress/gitops/ci·cd), 아키텍처 다이어그램, 핵심 시나리오, 자산 상태 전이, 관측성·네트워크 경계, [추후 AWS] 매핑.
- Mermaid 다이어그램 3종 추가: flowchart(전체 구조), sequenceDiagram(업로드→worker→관측), stateDiagram(proof_assets 상태 전이).

**목적**

- 이 문서는 **"무엇을 만들지의 지도"** 다. 따로 노는 운영 요소(컨테이너·관측성·배포·비동기)를 *업로드→처리→관측*이라는 한 흐름에 묶어, 이후 모든 작업이 "이 그림의 어느 부품인가"로 설명되게 한다. 설계도 없이 부품부터 사면 안 맞듯, 전체 그림을 먼저 그려 둔 것.

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

**이전 상태 / 문제**

- 현재는 env가 **2개(공개 키)뿐이고 dev/staging/prod 구분이 없었다.**
- 환경 구분이 없으면 안전한 배포 승격·서버 전용 시크릿 주입·롤백 같은 운영 이야기를 할 수 없다.
- → dev/staging/prod 정의와 분리 수단(네임스페이스·GitHub Environment·환경별 주입값)을 먼저 설계한다.

**한 일**

- `docs/architecture/environments.md` 작성: dev/staging/prod 정의, 분리 수단(app config·K8s namespace·GitHub Environment·도메인), 환경별 차이 매트릭스, 환경 변수 정리, 시크릿 주입 지점, Supabase 분리 제약, 예상 매니페스트 구조.

**목적**

- **"같은 코드, 다른 무대"** 를 만들기 위함. dev에서 막 굴리고 → staging에서 검증 → prod에 안전하게 올리는 *승격 통로*가 있어야 사고 없이 배포하고 문제 시 되돌릴 수 있다. 서버 전용 시크릿을 환경별로 어디서 주입할지의 기준도 여기서 선다.

**핵심 결정**

- 분리 원칙은 "코드/이미지는 동일, 환경별 주입값만 다름"(stateless·12-factor). K8s는 네임스페이스 + Kustomize overlays(또는 Helm values)로 분리.
- 승격 흐름: dev(로컬) → staging 자동 배포 → smoke 통과 → prod 수동 승인.
- worker 도입으로 **서버 전용 시크릿**(`SUPABASE_SERVICE_ROLE_KEY` 등)이 처음 등장 → 로컬 `.env.local`, staging/prod는 K8s Secret, CI는 GitHub Environment로 분리 주입.
- Supabase는 이상적으로 환경별 별도 프로젝트, 계정 제약 시 단일 프로젝트+키/스키마 분리로 차선. 실제 선택은 컨테이너화·k3s 배포 구축 단계에서 확정해 기록.

### 7. proof_assets / jobs DB 스키마 초안

**이전 상태 / 문제**

- 비동기 후처리를 하려면 자산의 **처리 상태와 작업 큐**가 필요한데, 그런 데이터 모델이 전혀 없었다.
- 모델 없이 코드부터 짜면 상태 전이·동시성·재시도 설계가 흔들리고 나중에 갈아엎게 된다.
- → `proof_assets`(상태) + `jobs`(큐) 스키마를 먼저 초안으로 설계한다(이 단계는 적용 전).

**한 일**

- `supabase/proof_assets.draft.sql` 작성: 자산 상태 모델 `proof_assets` + 작업 큐 `jobs` 초안. 기존 `schema.sql` 컨벤션(멱등·RLS owner-only·touch_updated_at 트리거·인덱스) 준수.
- `proof_assets`: source_path·kind·status(uploaded/processing/ready/failed)·메타데이터(content_type/size/width/height/checksum/thumb_path)·error_code/message.
- `jobs`: asset_id·status(pending/processing/done/failed)·attempts/max_attempts·run_after(백오프)·locked_at/locked_by(선점).

**목적**

- 비동기 파이프라인의 **"뼈대(데이터 모델)"** 를 먼저 세우는 일. 자산이 지금 어떤 상태인지(`proof_assets`)와 처리할 일이 줄 서 있는지(`jobs`)를 담을 그릇이 있어야, 그 위에 worker·관측·장애재현 같은 운영 이야기가 얹힌다. 그릇 없이 물을 부을 순 없다.

**핵심 설계**

- 큐는 외부 브로커 없이 **DB job table + polling**. `claim_job(worker)` 함수에서 **FOR UPDATE SKIP LOCKED**로 다중 worker 동시성 안전 확보.
- 폴링 성능: `jobs_pending_idx`(부분 인덱스, status='pending'), 적체 측정용 `jobs_status_idx`(= `queue_depth` 지표 근거).
- worker는 **SERVICE_ROLE 키로 RLS 우회**(environments.md의 서버 전용 시크릿과 연결), 사용자는 RLS owner-only로 자기 자산 상태만 조회.
- 중복 탐지용 `proof_assets_checksum_idx`(user_id, checksum).

**비고**

- 이 파일은 설계 **초안**(`.draft.sql`)이다. 실제 적용은 worker 구현 단계에서 schema.sql 통합/마이그레이션으로 반영.

### 8. Notion sync 구조 설계 + workflow 초안

**이전 상태 / 문제**

- 문서는 repo에 쌓이는데, 공유/열람은 **Notion으로 수동으로 옮겨야** 했다.
- 수동이면 repo와 Notion이 어긋나고, 원본이 둘로 갈려 관리 비용이 든다.
- → repo→Notion 단방향 자동 동기화 구조를 먼저 설계한다(원본은 repo로 고정).

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

**이전 상태 / 문제**

- 설계(8번)는 있지만 실제로 도는 **변환기·동기화 로직이 없어 여전히 수동**이었다.
- → 마크다운→Notion 변환기 + 워크플로를 구현해 push 시 자동 생성/갱신되게 한다.

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

**이전 상태 / 문제**

- 구현(9번)은 됐지만 `NOTION_TOKEN`이 없어 워크플로가 **매번 skip돼, 자동 동기화가 실제로는 안 돌았다.**
- → 시크릿을 등록해 토큰 가드를 풀고 push 자동 동기화를 활성화한다.

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

**이전 상태 / 문제**

- 지금까지는 별 규칙 없이 **main에 직접 커밋**해 왔다. 코드 작업을 본격 시작하려는데 브랜치·리뷰·배포 게이트 규칙이 없었다.
- 규칙 없이 코드 작업을 시작하면 변경이 main에 뒤섞이고, 뒤에 붙일 CI/CD·GitOps가 올라탈 기준점이 없다.
- → 코드 첫 줄을 짜기 전에 브랜치 모델(GitHub Flow + 환경 승격)을 먼저 고정한다.

**한 일**

- `docs/architecture/branching.md` 작성: 코드 작업 본격 시작 전에 브랜치 모델을 먼저 고정. 후보(GitHub Flow+환경 승격 / 트렁크 기반 / Git Flow) 비교 → **GitHub Flow + 환경 승격** 채택. 브랜치 구조·명명 규칙(`feature/*`·`fix/*`·`docs/*`·`chore/*`), 흐름(mermaid), PR·merge 규칙, 환경 분리 매핑, 적용 방침을 한 문서로 정리.
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

**이전 상태 / 문제**

- proof_assets/jobs는 06-09에 만든 `proof_assets.draft.sql` **초안으로만** 있었고, 정식 `schema.sql` 밖에 떨어져 있었으며 Supabase에 **적용도 안 된** 상태였다.
- 초안이 본 스키마와 분리돼 있으면 단일 소스가 깨지고, 실제 DB에 객체가 없으니 코드가 기댈 수 없다.
- → 초안을 `schema.sql`에 통합(단일 소스)하고 Supabase에 실제 적용한다.

**한 일**

- 06-09에 만든 초안 `supabase/proof_assets.draft.sql`을 정식 `supabase/schema.sql` 끝에 **통합**하고 draft 파일은 제거(단일 소스 유지).
- 통합 시 중복 제거: `create extension pgcrypto`, `touch_updated_at()` 함수는 schema.sql 상단에 이미 있어 재정의하지 않고 재사용.
- 멱등·additive 컨벤션 유지(`create table if not exists`, `create index if not exists`, `drop policy ... + create policy`).

**목적**

- 초안을 **"실제로 쓸 수 있는 상태"** 로 만드는 일. 설계도(draft)가 책상 위에만 있으면 코드가 못 기댄다 — 정식 `schema.sql`에 합쳐 Supabase에 올려야 비로소 "있는 것"이 되어, 다음 작업(업로드→asset/job 코드)이 시작될 수 있다.

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

---

## 2026-06-11

### 1. 첫 feature → PR → merge 사이클 수행

**이전 상태 / 문제**

- `branching.md`에 PR 흐름을 규칙으로 적어뒀지만 **실제로 한 번도 돌려본 적이 없었다.** 게다가 커밋 author가 전역 설정값 `Backend API Agent`로 찍히고 있었다.
- 흐름을 안 돌려보면 규칙이 실제로 동작하는지 모르고, author가 본인이 아니면 Vercel 빌드가 거부되고 GitHub 기여에도 안 잡힌다.
- → 첫 PR을 실제로 끝까지 돌려 흐름을 검증하고, author를 본인으로 교정한다.

**한 일**

- `branching.md` 전략대로 **첫 PR 흐름을 실제로 한 바퀴 수행**: `feature/async-pipeline` push → PR 생성(제목·설명 작성) → CI(Vercel) 통과 → **squash merge** → `main` 동기화(`pull --ff-only`) → 작업 브랜치 정리(로컬·원격 삭제).
- 커밋 author를 본인(`ompangyji <ompangyji@gmail.com>`)으로 교정. 전역 git 설정이 `Backend API Agent`라 그대로 커밋돼 있었고, 이 때문에 Vercel이 프리뷰 빌드를 거부했다.
- 이미 push돼 있던 브랜치라 author 교정분을 force-push로 반영.

**왜 / 배운 점**

- **Vercel은 커밋 author 이메일이 GitHub 계정과 매칭돼야** 프리뷰를 빌드한다(매칭 안 되면 "No GitHub account ... matching the commit author" 로 실패). author가 본인이어야 GitHub contribution graph에도 기여로 잡힌다.
- 단, 이 체크 실패가 **merge 자체를 막지는 않는다**(branch protection으로 필수 체크를 걸지 않은 상태).
- `/mnt/d`(WSL drvfs)에서 `git config` 쓰기가 chmod 제약으로 막혀, `.git/config`의 `[user]` 섹션을 직접 편집해 author를 설정.
- 이미 원격에 올라간 커밋의 이력을 고치면 force-push가 필요하다(단독 repo라 안전).

**자료**

- `004~006-git-pr-*` — PR 생성·검토·merge 화면 (GitHub)
- `007-git-local-sync-20260611.png` — merge 후 로컬 `main` 동기화 + feature 브랜치 삭제 (터미널)

### 2. 업로드 → asset/job 생성 흐름 구현

**이전 상태 / 문제**

- 기존 업로드는 storage에 파일을 올리고 그 URL을 `doit.image_urls`(text 배열)에 저장하는 **동기 흐름**이 전부였다. 업로드된 파일의 **처리 상태도, 후처리 작업 큐도 없었다.**
- 그래서 안 좋았던 점:
  - **추적 불가**: 업로드 이후 무엇이 일어났는지(처리 중/완료/실패) 알 수 있는 상태 모델이 없어, 실패·지연·적체를 관측할 지점이 없었다.
  - **확장 불가**: 썸네일·메타데이터·해시·중복탐지 같은 후처리를 끼워 넣을 자리가 없었다.
  - **운영 소재 부재**: 큐·워커·적체·재처리 같은 비동기 운영(DevOps에서 보여줄 핵심)이 성립할 토대 자체가 없었다.
- → 업로드를 "**추적·후처리 가능한 비동기 파이프라인의 진입점**"으로 바꾸기 위해 asset 상태 모델 + job 큐 + 자동 enqueue를 연결한다.

**한 일**

- 업로드 직후 `proof_assets` 레코드가 생기고, 그에 대한 후처리 `jobs`가 자동 enqueue되도록 흐름을 연결. (`feature/upload-asset-job-flow`)
- `src/lib/supabase/upload.ts`: storage 업로드 성공 후 `proof_assets` 1행 insert(`source_path`/`kind`/`status='uploaded'`/`content_type`/`size_bytes`). insert 실패 시 방금 올린 storage 객체를 삭제해 orphan을 막는다.
- `supabase/schema.sql`: 트리거 함수 `enqueue_proof_job` + `proof_assets_enqueue`(after insert) 추가 — 자산이 생기면 `process_image` job 1건을 자동 생성.
- `src/lib/supabase/types.ts`: `ProofAsset`/`Job` 타입 추가.

**목적**

- 파이프라인의 **"입구"** 를 여는 일. 업로드라는 평범한 행동을 *추적·후처리 가능한 작업*으로 바꿔, 이후 worker가 소비할 일감(job)이 실제로 쌓이기 시작한다. 택배 접수창구를 만든 셈 — 접수가 돼야 배송(후처리)이 시작된다.

**핵심 설계**

- **job 생성 책임을 DB로**: 클라이언트는 `proof_assets`만 insert하고, job 생성은 트리거가 한다. asset:job = 1:1을 DB가 원자적으로 보장(클라이언트가 두 번 insert하다 한쪽만 성공하는 경우 없음). 트리거는 SECURITY DEFINER라 jobs RLS와 무관하게 항상 enqueue.
- **업로드 원자성**: storage 객체와 asset 레코드가 항상 함께 존재하거나 함께 없도록(asset insert 실패 시 storage 롤백).
- width/height/checksum/thumb는 클라이언트가 모르므로 비워두고 worker 후처리에서 채운다.

**검증 (실제 동작 확인)**

- `schema.sql` 재실행 후 앱에서 이미지 1장 업로드 → DB 확인 결과 의도대로 동작:
  - `proof_assets` 1행: `kind=doits`, `status=uploaded`, `content_type=image/png`, `size_bytes=286942`.
  - `jobs` 1행: `type=process_image`, `status=pending`, `attempts=0`.
  - **`jobs.asset_id` = `proof_assets.id`** 로 일치 → 트리거가 해당 자산의 job을 정확히 연결함.

**자료**

- `008-1-app-upload-doit.png` / `008-2-app-upload-doit.png` — 업로드(다이얼로그 첨부 / 저장된 doit)
- `009-db-proof-assets-row.png` — proof_assets 새 행(status=uploaded)
- `010-db-jobs-row.png` — jobs 새 행(status=pending, asset_id 일치)
- `011-git-pr2-open` / `012-git-pr2-merged` / `013-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화)

**비고**

- 트리거가 추가됐으므로 적용 시 **Supabase SQL Editor에서 `schema.sql` 재실행** 필요(멱등).
- 아직 worker가 없어 job은 `pending`으로 쌓인다(소비자는 후속 task). 타입체크(`tsc --noEmit`) 통과.

### 3. 서버측 업로드 검증 강화 (MIME·용량·content-type)

**이전 상태 / 문제**

- 업로드 검증이 `upload.ts`(브라우저)에만 있었다 — MIME `image/*` + 8MB 체크가 전부.
- 클라이언트 검증은 **신뢰할 수 없다**: 브라우저 우회/직접 Storage API 호출로 임의 타입·대용량 파일을 그대로 올릴 수 있었고, 막아주는 **서버측 게이트가 없었다.**
- → 우회 불가능한 지점(Storage 버킷·DB)에서 용량·MIME을 강제한다.

**한 일**

- `supabase/schema.sql`:
  - media 버킷에 `file_size_limit=8388608`(8MB) + `allowed_mime_types=['image/*']` 설정 → 클라이언트를 우회해도 **Storage API가 업로드를 거부**한다.
  - `proof_assets`에 CHECK 제약 2개(`content_type like 'image/%'`, `size_bytes <= 8MB`) 추가 — 기록되는 메타데이터 불변식(멱등 재정의).
- `src/lib/supabase/upload.ts`: 클라이언트 검사가 서버 한도를 미러링하는 **빠른 UX용**임을 주석으로 명시(진짜 게이트는 Storage/DB).

**목적**

- **"믿을 수 있는 문지기"** 를 두는 일. 브라우저(클라) 검증은 사용자가 우회할 수 있어 믿을 수 없다 — 진짜 신뢰 경계인 서버(Storage·DB)에서 막아야, 어떤 경로로 들어와도 잘못된 파일이 시스템에 남지 않는다.

**핵심 설계 — 다층 검증(defense in depth)**

- 1차 클라이언트(`upload.ts`): 즉각 피드백. 신뢰하지 않음.
- 2차 Storage 버킷: 용량·선언 MIME을 서버가 강제, 업로드 자체를 거부. ← **핵심 게이트**
- 3차 DB CHECK: 기록되는 asset 메타데이터 불변식.
- 4차 worker(후속): 실제 바이트(매직넘버)로 **선언 content-type 위조**까지 검증 → 불일치면 `status=failed`. (지금은 자리만 명시, 미구현)

**비고 / 검증 방법**

- 적용: Supabase SQL Editor에서 `schema.sql` 재실행(멱등). 버킷 설정은 Storage > 버킷 설정에서도 확인 가능.
- 테스트: **8MB 초과 파일** 또는 **비이미지 파일** 업로드 시도 → Storage가 거부(에러)하는지 확인.
- 타입체크(`tsc --noEmit`) 통과.

**자료** — 검증이 여러 층에서 강제됨을 "설정 + 동작"으로 증명

- `014-sec-bucket-limits-20260611.png` — Supabase Storage `media` 버킷에 `8 MB` / `image/*`가 적용된 화면. **Storage-층 게이트가 설정됨**.
- `015-sec-check-reject-20260611.png` — SQL Editor에서 `content_type='application/pdf'` 행을 직접 insert 시도 → `proof_assets_content_type_chk` 위반으로 거부. **DB-층 게이트가 동작함**.
- UI 다층 방어 — **같은 PDF**가 경로에 따라 다른 층에서 차단되는 것을 보임:
  - `016-sec-bypass-code-20260611.png` — 데모를 위해 `upload.ts`의 클라이언트 검증을 임시 주석 처리한 코드(= 클라 게이트를 일부러 우회한 상태임을 명시. 커밋엔 미포함).
  - `017-sec-ui-server-reject-20260611.png` — 우회 상태에서 PDF 업로드 → UI에 `mime type application/pdf is not supported`. **클라를 뚫어도 Storage(서버)가 막는다**.
  - `018-sec-ui-client-reject-20260611.png` — 원복(정상) 후 같은 PDF → UI에 `Only image files are supported.`. **정상 경로에선 클라이언트가 1차로 막는다**.
- 종합: 014/015는 설정·DB 게이트, 017/018은 같은 입력(PDF)을 **클라+서버 두 겹이 각각 차단**(016이 그 우회 조건을 설명). 다층 방어(defense in depth)가 설정·동작 모두 증명됨.
- `019-git-pr3-open` / `020-git-pr3-merged` / `021-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 4. request_id 주입 + 구조화 로그 유틸 초안

**이전 상태 / 문제**

- 서버 로깅이 사실상 없었다 — 있어도 `console.log("...")` 같은 **평문 문자열**뿐이라, 나중에 로그 수집기(Loki 등)에서 **필드로 검색·집계가 불가**했다.
- 한 요청이 미들웨어→라우트→DB를 거치는데 이를 **묶을 식별자(request_id)가 없어**, 장애 시 "이 요청이 무슨 경로로 흘렀나"를 추적할 수 없었다.
- → 요청마다 ID를 부여하고, 로그를 **구조화(JSON)** 로 남기는 기반 유틸을 먼저 깐다(관측성의 토대).

**한 일**

- `src/lib/log.ts`: 구조화 JSON 로거. 레벨(debug/info/warn/error)·`LOG_LEVEL`/`APP_ENV` 반영, error/warn은 stderr. `log.with({ request_id })`로 컨텍스트를 고정한 하위 로거 생성.
- `src/lib/request-id.ts`: `x-request-id` 상수 + `requestIdFrom(req)`(헤더 읽거나 없으면 생성).
- `src/lib/supabase/middleware.ts`: 모든 요청에 `request_id` 부여(클라/프록시가 보낸 게 있으면 재사용) → 다운스트림엔 요청 헤더, 클라이언트엔 응답 헤더로 전달. 기존 Supabase 쿠키 처리 보존.
- `src/app/api/media/[...path]/route.ts`: 로거+request_id 적용 데모 — 성공/404를 `request_id`·`route`·`object_path`·`status` 필드로 구조화 로그.

**목적**

- **request_id = 요청의 송장번호.** 한 요청은 `미들웨어→라우트→DB→스토리지`를 거치는데, 그 요청이 남기는 모든 로그에 같은 번호가 찍혀 **한 요청의 전 여정을 한 줄로 추적**할 수 있다.
- **구조화 로그(JSON) = 검색 가능한 표.** 평문 로그는 "일기장"이라 못 하는 일 — `status=404`만 필터, `route`별 집계, 특정 `request_id` 추적 — 이 JSON 필드로 **즉시** 가능해진다.
- **역할: 관측성(observability)의 토대.** "안 보이면 운영할 수 없다"가 핵심. 기능이 아니라 *운영할 때 눈이 되어주는 장치*이며, 뒤에 붙일 **Loki(로그 검색)·Grafana(대시보드·알림)·worker 파이프라인 추적**이 전부 이 위에 얹힌다(나중에 OpenTelemetry `trace_id`와도 결합).

**핵심 설계**

- **단일 출처**: request_id는 미들웨어에서 한 번 만들고 헤더로 전파 → 모든 로그가 같은 ID를 공유해 한 요청을 상관(correlate)할 수 있다.
- **미들웨어 미경유 경로 대비**: `/api/grass`처럼 matcher에서 빠진 경로는 `requestIdFrom`이 라우트에서 자체 생성(후속 적용 여지).
- **초안 범위**: 유틸·주입·1개 라우트 데모까지. server actions·grass·worker 로깅 연결과 OpenTelemetry trace_id 연동은 후속.

**검증 (실제 동작 확인)**

- `npm run dev` 후 이미지 있는 화면 로드(Disable cache) → dev 터미널에 구조화 JSON 로그(`msg:"media served"`, `request_id`·`route`·`status` 필드) 확인.
- 홈 페이지 응답 헤더에 `x-request-id` 부여 확인(`31316c91-...`).
- 타입체크(`tsc --noEmit`) 통과.

**자료**

- `022-obs-structured-log-20260611.png` — dev 터미널의 구조화 JSON 로그(`media served` + request_id/route/status).
- `023-obs-request-id-header-20260611.png` — 홈 페이지 응답 헤더 `X-Request-Id` 부여 확인.
- `024-git-pr4-open` / `025-git-pr4-merged` / `026-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

---

## 2026-06-12

### 1. worker 골격 + 폴링 루프

**이전 상태 / 문제**

- 업로드하면 `jobs`에 `pending`이 쌓이지만 **소비자(worker)가 없어** 영원히 처리되지 않았다. `proof_assets`는 `uploaded`에 멈춰 있고 큐만 길어진다.
- → jobs를 집어 처리할 독립 worker 프로세스의 **뼈대**(폴링·선점·로그·종료)를 먼저 만든다.

**목적**

- 비동기 파이프라인의 **"배송 기사"** 를 두는 일. web이 접수(job 생성)만 하던 걸, 이제 별도 프로세스가 큐에서 일감을 꺼내 처리하기 시작한다. 이 골격 위에 실제 후처리와 실패 재시도가 차례로 얹힌다.

**한 일**

- `worker/worker.mjs` 신규: `SUPABASE_SERVICE_ROLE_KEY`로 접속(RLS 우회), `claim_job` 폴링 루프(빈 큐 백오프), 구조화 JSON 로그(앞서 도입한 request_id 기반 로거와 같은 한 줄 포맷에 `worker_id`/`job_id` 컨텍스트), SIGTERM/SIGINT **graceful shutdown**(진행 중 job 마무리 후 종료).
- `claim_job`은 `FOR UPDATE SKIP LOCKED`라 여러 worker를 띄워도 같은 job을 잡지 않는다(동시성 안전).
- 골격 단계라 `processJob`은 실제 후처리 없이 상태만 전이(→`ready`, job `done`)하는 **stub**. 실제 처리(download·checksum·메타데이터)는 다음 단계(성공 경로 처리 구현)에서 채운다.
- `package.json`에 `worker` 스크립트(`node --env-file=.env.local`, 앱과 공용), `.env.example`에 worker env 문서화.

**검증 (실제 동작 확인)**

- Vercel 앱에서 이미지를 업로드해 pending job을 만든 뒤 `npm run worker` 실행 → worker가 그 job을 선점·처리.
- 실제 결과: job `ff16de20…`이 처리되어 **`jobs.status`: pending → `done`** (`attempts=1`), 그 자산 **`proof_assets` `6bb283d1…`.`status`: uploaded → `ready`** (content_type `image/png`, size_bytes `2869424`).
- **상관(correlation) 증거**: jobs 행의 `asset_id`(`6bb283d1…`)와 proof_assets 행의 `id`(`6bb283d1…`)가 **일치** → "그 job이 그 asset을 처리했다"가 로그+DB로 한 번에 증명된다(request_id처럼 식별자로 처리 흐름을 꿰는 관측성 패턴의 연장).
- `width`/`height`는 아직 `NULL` — stub라 메타데이터 미산출. 즉 **선점·상태 전이는 진짜로 동작**하고, 후처리 "내용"만 비어 있는 상태(실제 처리 구현 시 채움).

**자료**

- `027-obs-worker-start-20260612.png` — `npm run worker`(= `node --env-file=.env.local`) 기동 + `worker 시작` 구조화 JSON 로그.
- `028-db-job-done-20260612.png` — jobs 테이블: job `ff16de20…`가 `status=done`, `attempts=1`, `asset_id=6bb283d1…`.
- `029-db-asset-ready-20260612.png` — proof_assets 테이블: asset `6bb283d1…`가 `status=ready`(`image/png`, `2869424` bytes; `width`/`height`는 `NULL`).
- → 028의 `asset_id`와 029의 `id`가 같은 `6bb283d1…` = worker가 그 job으로 그 asset을 ready로 전이시킨 것이 한눈에 증명됨.
- `030-git-pr5-open` / `031-git-pr5-merged` / `032-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

**비고**

- worker는 `.mjs` + node 직접 실행(`notion-sync`와 동일 패턴, TS 툴링·네이티브 의존 회피). 공통 로거 통합은 추후 web/worker 공통 로그 포맷 통일 시 예정.
- 시크릿: 기존 `.env.local`(앱과 공용, git 미추적)에 `SUPABASE_SERVICE_ROLE_KEY` 한 줄만 추가(URL은 `NEXT_PUBLIC_SUPABASE_URL` 재사용). **절대 커밋 금지.**
- 빈 큐 주의: `claim_job(RETURNS public.jobs)`은 빈 큐에서 NULL을 반환하고 PostgREST가 이를 "전 컬럼 null인 한 행"으로 표현 → worker는 `job.id`로 실제 선점 여부를 판별(가드 추가).

### 2. job 처리 + 상태 전이 (성공 경로)

**이전 상태 / 문제**

- worker가 골격이라 `processJob`이 **실제 후처리 없이 상태만 `ready`로 바꾸는 stub**이었다. 자산 메타데이터(checksum/size/차원)는 비어 있고(`width`/`height`=NULL) "처리됨" 표시만 됐다.
- → worker가 원본을 실제로 받아 메타데이터를 산출하고 정식 상태 전이(uploaded→processing→ready)를 하게 만든다.

**목적**

- "배송 기사"가 **실제로 짐을 푸는** 단계. 지금까진 큐에서 job을 꺼내 표시만 했다면, 이제 원본 이미지를 읽어 체크섬·크기·차원을 뽑아 자산에 채운다. 후처리 결과가 DB에 쌓여야 중복 탐지·관측·admin 같은 다음 운영 이야기가 가능해진다.

**한 일**

- `worker/worker.mjs`의 `processJob`을 실제 처리로 교체: 자산을 `processing`으로 표시 → `source_path`로 원본 download → **sha256 checksum·실제 size·차원** 산출 → `proof_assets`(status `ready` + content_type·size_bytes·width·height·checksum) 채우고 job `done`.
- `imageDimensions(buf)`: **의존성 없이** PNG(IHDR)·JPEG(SOF 마커)의 차원만 가볍게 파싱(그 외 포맷은 차원 null). 네이티브 이미지 라이브러리(sharp 등)·WSL chmod 이슈 회피.
- 완료 로그에 size_bytes·width·height·checksum(앞 12자)을 포함해 결과가 로그로도 보이게.

**핵심 설계**

- **가볍게**(시나리오 원칙): 후처리는 checksum·size·차원까지. 썸네일 생성·적극적 중복 차단은 후속.
- 상태 전이를 단계적으로 노출: `uploaded → processing → ready`. (처리 실패 시 throw → 지금은 로그만, `failed` 전이·재시도/백오프는 후속.)

**검증 (실제 동작 확인)**

- 새 이미지를 업로드해 새 pending job을 만든 뒤 `npm run worker` 실행 → worker가 선점·처리.
- 실제 결과: 새 자산 `d9e47f53…`가 처리되어 `proof_assets`에 **`width=1536`, `height=1024`, `checksum=a23b734ba…`, `size_bytes=2869424`, content_type `image/png`** 가 채워지고 status `ready`.
- **stub와 대비**: 같은 표에서 이전 stub로 처리됐던 자산 `6bb283d1…`은 `width`/`height`/`checksum`이 여전히 `NULL`. → 실제 처리가 메타데이터를 진짜로 산출·저장함이 한 화면의 before/after로 증명된다.

**자료**

- `033-obs-worker-process-20260612.png` — worker 터미널: `job 선점` → `job 완료` 로그. 완료 줄에 산출값(width/height/checksum 등)이 포함됨 = worker가 원본을 읽어 실제로 계산했다는 증거.
- `034-db-asset-metadata-20260612.png` — proof_assets 테이블 2행 대비: 신규 `d9e47f53…`는 `width=1536`/`height=1024`/`checksum` 채워짐(real 처리), 이전 `6bb283d1…`는 `NULL`(stub). 같은 표에서 "처리 전(stub) vs 처리 후(real)"가 드러남.
- `035-git-pr6-merged` / `036-git-local-sync` — 이 작업을 PR로 main에 반영(merge→로컬 동기화).

**비고**

- 이전 stub로 ready된 자산은 메타데이터가 빈 채 남는다(소급 재처리는 별도). 검증은 새 업로드로 수행.
- `node --check` 통과.

### 3. 실패 처리: 재시도·백오프·error_code

**이전 상태 / 문제**

- worker 처리가 실패하면 **로그만 찍고 끝**이었다. job은 `processing`인 채 영영 멈추고(stuck), 자산도 `processing`에 갇혀 — 누구도 다시 처리하지 않고 실패 원인도 안 남았다.
- → 실패를 1급으로 다룬다: 일시 오류는 **재시도**, 영구 오류는 **failed로 확정 + 원인 기록**.

**목적**

- 운영에서 **장애를 "복구 가능한 상태"로 만드는** 일. 실패가 그냥 멈춤이 아니라, 재시도로 자동 회복하거나 failed로 분류돼 admin이 골라 재처리·조사할 수 있어야 한다. 시나리오의 "stuck/failed job 장애·재처리" 운영 소재가 여기서 성립한다.

**한 일**

- `handleFailure(job, e)` 추가: `attempts < max_attempts`면 **지수 백오프**(`RETRY_BASE_MS * 2^(attempts-1)`)로 `run_after`를 미뤄 job을 `pending`으로 되돌리고 잠금 해제 → run_after 후 재선점. 도달하면 job·asset 모두 `failed` 확정 + `error_code`/`error_message`/`last_error` 기록.
- 오류 분류(`error_code`): `coded(code, msg)`로 throw에 코드 부착 — `asset_not_found`, `download_failed`, 그 외 `unknown`.
- 루프 catch가 단순 로그 대신 `handleFailure` 호출. `.env.example`에 `WORKER_RETRY_BASE_MS`.

**핵심 설계**

- `attempts`는 `claim_job`이 선점 시 이미 +1 하므로 그 값으로 재시도 횟수를 센다(`max_attempts=3` → 최대 3회 시도 후 failed).
- 재시도는 **job을 pending+run_after로 되돌리는** 방식 → 같은 `claim_job` 폴링이 백오프 시점 이후 자연히 다시 집어간다(별도 스케줄러 불필요).
- 멈춘(stuck: `locked_at`이 오래됨) job 회수는 후속.

**검증 (실제 동작 확인)**

- 존재하지 않는 `source_path`(`nonexistent/x.png`)의 자산을 SQL로 만들어(트리거가 job 생성) `npm run worker` 실행 → download가 매번 실패하므로 재시도 흐름이 실제로 돌았다.
- 실제 결과: job `bdc54633…`이 `attempts=3`까지 시도 후 **status=`failed`**, `last_error="원본 download 실패: Object not found"`. 그 자산 `edea34eb…`는 **status=`failed`, `error_code=download_failed`, `error_message="원본 download 실패: Object not found"`**.
- 상관 일치: jobs의 `asset_id`와 proof_assets의 `id`가 같은 `edea34eb…`.
- → 실패가 그냥 멈춤이 아니라 **3회 재시도 후 failed로 분류되고 원인(error_code)이 남는 것**이 증명됨.

**자료**

- `037-obs-worker-retry-fail-20260612.png` — worker 터미널: 실패 자산 insert 후 `job 실패 — 재시도 예약`(error_code=`download_failed`)이 백오프 간격으로 반복되다 `failed 확정`.
- `038-db-job-failed-20260612.png` — jobs 테이블: 실패 job `bdc54633…`가 `status=failed`, `attempts=3`, `last_error` 기록.
- `039-db-asset-failed-20260612.png` — proof_assets 테이블: 자산 `edea34eb…`가 `status=failed`, `error_code=download_failed`, `error_message` 기록(정상 `ready` 자산들과 한 표에서 대비).

**비고**

- 실패 유도: **존재하지 않는 `source_path`의 자산**을 만들면 된다(예: `insert ... values (..., 'nonexistent/x.png', 'doits', 'image/png')`). 빠르게 보려면 `.env.local`에 `WORKER_RETRY_BASE_MS=1000`. `node --check` 통과.
- 운영 메모(검증 중 발견): `.env.local`의 service_role 키가 **잘려 있으면** `claim_job`이 `Invalid API key`로 계속 실패한다. 이때 worker는 죽지 않고 폴링을 재시도하므로(복원력), 설정 오류가 가려질 수 있다 → 키 형식(JWT: 길이 ~200·점 2개) 점검 필요.

**회고 — "프론트에서 막을 텐데 왜 worker 실패 처리까지?"**

- 흔한 오해: 잘못된 파일은 프론트/서버 검증이 막으니 worker 실패 대비는 과한 것 아닌가?
- 핵심은 **막는 대상이 다르다**는 것. 프론트(+서버 검증) = **입력 정합성**(비이미지·용량). worker 실패 = **운영(런타임) 문제** — 입력은 멀쩡한데 *그 주변 인프라가 삐끗*하는 경우다.
- worker가 실제로 실패하는 경우: Storage 일시 다운·네트워크 끊김·rate limit(일시 장애), 처리 전 파일 삭제, 헤더만 통과한 깨진 파일, worker 크래시/OOM(stuck), 후속 처리(썸네일·외부 API) 실패 — **전부 프론트가 사전 차단 못 한다.**
- 그래서 재시도/백오프/failed 분류는 입력 검증이 아니라 **운영 신뢰성** 장치다. 동기 CRUD엔 없고 비동기 파이프라인엔 본질적인 실패 모드라, 이 포트폴리오의 "장애 복구" 이야기의 핵심.
- 검증에서 `nonexistent/x.png`를 insert한 건 "사용자가 bad row를 넣는다"가 아니라, 재현하기 어려운 일시 장애를 **결정적으로 시연**하기 위한 기법(프론트·업로드 경로를 건너뛰고 worker 실패 처리만 격리 테스트).

**자료**

- `040-git-pr7-merged` / `041-git-local-sync` — 이 작업을 PR로 main에 반영(merge→로컬 동기화).

### 4. 상태 전이·worker 운영 문서

**이전 상태 / 문제**

- worker의 동작(상태 전이·폴링·동시성·재시도/백오프·error_code·graceful shutdown)이 **코드에만** 흩어져 있고, 한눈에 보는 운영 문서가 없었다.
- → worker가 무엇을 어떻게 처리하는지(특히 장애 시 상태 흐름)를 한 문서로 정리해 운영·인수인계의 기준을 만든다.

**목적**

- worker를 **"운영 가능한 컴포넌트"** 로 만드는 일. 코드는 동작을 *실행*하지만, 문서는 "상태가 어떻게 흐르고, 실패하면 어떻게 되며, 어떻게 켜고 끄는가"를 *설명*한다. 장애 대응·재처리·확장(HPA)·인수인계가 이 문서 위에서 이뤄진다.

**한 일**

- `docs/architecture/worker.md` 작성: 자산/작업 **상태 전이(stateDiagram 2종)**, 처리 흐름, 동시성(`SKIP LOCKED`)·폴링, 실패 처리(재시도·지수 백오프·**error_code 표**), graceful shutdown, 실행·환경변수, 로그, 후속/운영 메모(stuck job 회수·컨테이너화·키 잘림 함정).
- `target-architecture.md`의 자산 상태 stateDiagram에서 상세는 `worker.md`로 연결(잔존 일자성 라벨 정리).
- `README.md` 인덱스에 `worker.md` 추가.

**비고**

- 코드(`worker/worker.mjs`)와 1:1로 일치하게 작성. 후속(stuck 회수·썸네일·공통 로거·k3s 배포)은 문서에 "후속"으로 명시.

**자료**

- `042-git-pr8-open` / `043-git-pr8-merged` / `044-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

---

## 2026-06-15

### 1. health check 엔드포인트 (/health/live, /health/ready)

**이전 상태 / 문제**

- 오케스트레이터(k3s)나 로드밸런서가 이 앱이 **살아있는지·트래픽을 받을 준비됐는지** 물어볼 창구가 없었다. 죽었거나 준비 안 된 인스턴스에도 트래픽이 갈 수 있다.
- → liveness/readiness probe 엔드포인트를 두어 "살아있나"와 "준비됐나"를 **분리해** 노출한다.

**목적**

- 오케스트레이터가 **인스턴스 상태를 스스로 판단**하게 만드는 일. liveness 실패=재시작, readiness 실패=트래픽 제외 — 자동 복구·무중단 배포의 전제다(사람이 안 봐도 시스템이 알아서 빼고/되살림).

**한 일**

- `src/app/health/live/route.ts`: liveness. 의존성 없이 200 `{status:"ok"}` — "프로세스가 떠 있나"만 본다.
- `src/app/health/ready/route.ts`: readiness. Supabase 도달을 가벼운 조회로 점검 → 준비됐으면 200, 아니면 503. 본문에 `checks.db {ok, ms, error?}` 노출(다음 단계에서 timeout/retry로 확장).
- `src/middleware.ts`: matcher에서 `health` 제외 → **liveness가 미들웨어의 Supabase 세션 조회에 의존하지 않게** 하고, `/login` 리다이렉트도 막음(공개 경로).

**핵심 설계**

- **live ≠ ready**: liveness는 의존성 0(살아있음만), readiness는 의존성 점검(준비됨). 섞으면 DB가 잠깐 느릴 때 liveness가 실패해 **불필요한 재시작**이 일어난다.
- readiness 503 본문이 **어떤 체크가 왜 실패했는지** 말하게 해 디버깅·관측에 쓰이게 함.

**검증 (실제 동작 확인)**

- 로컬 `npm run dev` → 브라우저로 두 엔드포인트 확인:
  - `/health/live` → **200** `{"status":"ok"}` (의존성 없이 즉시).
  - `/health/ready` → **200** `{"ready":true,"checks":{"db":{"ok":true,"ms":1005}}}` — readiness가 Supabase 도달을 실제로 점검(`ms`=소요시간)하고 통과.
- readiness는 구조화 로그도 남김: `{"msg":"readiness check","request_id":"…","route":"/health/ready","ready":true,"checks":{…}}` (health는 미들웨어 제외라 `request_id`는 라우트에서 자체 생성).
- 타입체크(`tsc`) 통과.

**자료**

- `045-obs-health-live-20260615.png` — 브라우저 `/health/live` 200 `{"status":"ok"}` + 터미널 `GET /health/live 200`.
- `046-obs-health-ready-20260615.png` — 브라우저 `/health/ready` 200 `{"ready":true,"checks":{"db":{"ok":true,"ms":1005}}}` + 터미널 readiness 구조화 로그.
- `047-git-pr9-open` / `048-git-pr9-merged` / `049-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

**비고**

- live ≠ ready 분리 유지. ready의 `checks.db`는 다음 단계에서 timeout/retry 래퍼로 감싸 `attempts`·timeout까지 노출 예정(의존성 끊으면 503).

### 2. graceful shutdown + readiness 연동

**이전 상태 / 문제**

- web은 종료 신호를 받아도 readiness가 그대로 200이라, 오케스트레이터가 **종료 중인 인스턴스에도 새 트래픽을 계속 보낼** 수 있었다(요청이 중간에 끊김). (worker는 이미 graceful shutdown 보유.)
- → 종료 신호 시 readiness를 떨궈 **트래픽을 먼저 끊고** 안전하게 빠지게 한다.

**목적**

- **무중단 배포·종료의 핵심**. 롤링 업데이트로 pod가 교체될 때, 종료되는 인스턴스가 `readiness=503`으로 "나 빼!"라고 알리면 오케스트레이터가 트래픽을 새 pod로 보내고 기존 요청만 마무리한 뒤 종료한다 → 사용자는 끊김을 못 느낀다.

**한 일**

- `src/lib/lifecycle.ts`: 종료 플래그(`isShuttingDown`/`beginShutdown`) 모듈 싱글톤.
- `src/instrumentation.ts`: Next 서버 시작 훅. nodejs 런타임에서 **SIGTERM**을 잡아 `beginShutdown()` + 로그. (SIGINT는 미처리 — 로컬 개발 종료에 영향 없음.)
- `/health/ready`: 종료 중이면 DB 점검과 무관하게 **503**(`checks.shutdown`) 반환.
- worker는 이미 SIGTERM/SIGINT graceful shutdown 보유(진행 중 job 마무리 후 종료) — web과 동일 사상.

**핵심 설계**

- web의 "트래픽 중단·drain"은 앱이 직접 하지 않는다 — **readiness 503을 본 오케스트레이터가 endpoint에서 빼고 grace period 동안 drain**한다. 앱의 책임은 "readiness를 정확히 내리는 것"까지.
- **왜 SIGTERM만 처리하고 SIGINT는 미처리인가**: SIGTERM은 오케스트레이터(k3s)가 pod를 정상 종료할 때 보내는 신호라, 여기에 graceful shutdown(readiness 내림)을 건다. 반면 **SIGINT**는 터미널에서 실행 중인 프로세스를 직접 중단할 때(인터럽트 신호, 예: Ctrl+C) 오는 신호인데, 이걸 우리가 가로채면 **Node의 기본 종료 동작이 막혀 로컬 dev를 멈추기 어려워진다.** 그래서 운영 종료 신호(SIGTERM)에만 로직을 걸고 SIGINT는 **일부러 처리하지 않는다(미처리)** = 로컬 개발 중단은 평소대로 둔다.

**검증 — 이번엔 생략, 추후 k3s에서 검증 예정**

- 이 동작(SIGTERM → readiness 503 → 오케스트레이터가 트래픽 제외 → 무중단 종료)은 **오케스트레이터(k3s)가 있어야 끝까지 검증된다.** `next dev`는 SIGTERM에서 그냥 종료될 수 있어 로컬 단독 검증은 의미가 약해, **이번 단계에선 동작 검증을 생략**했다.
- **➡ 추후 k3s 배포 단계에서 검증**: readiness probe + 롤링 업데이트로 "종료되는 pod가 `/health/ready` 503을 띄우고 트래픽이 새 pod로 빠지는지"를 실제로 확인한다(이 task의 런타임 검증은 그때로 미룸).
- 지금 확정된 것: 코드·타입체크(`tsc`) 통과, readiness 라우트의 `checks.shutdown` 503 분기 구현 완료. 즉 **로직은 들어갔고, 그 효과의 실증만 k3s로 미룬 것.**

**자료**

- `050-git-pr10-open` / `051-git-pr10-merged` / `052-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 3. 외부 호출 timeout/retry 견고화 + 단위 테스트

**이전 상태 / 문제**

- 외부 호출(Supabase rpc·storage download)에 **시간 제한이 없어**, 의존성이 응답을 안 주면 호출이 **무한정 매달릴(행)** 수 있었다. worker가 한 job에 영영 묶이면 큐 전체가 멈춘다.
- 또 검증을 늘 수동(스샷)으로만 했는데, timeout/retry 같은 **순수 로직은 자동 테스트로 결정적으로** 증명하는 게 맞다.
- → 시간 제한·재시도를 공통 유틸로 빼고, **node:test**로 동작을 못박는다.

**목적**

- **"무한정 기다리지 않기"** = 운영 신뢰성의 기본. 한 느린 호출이 워커/요청 전체를 묶지 않게 상한을 둔다. 또 이 로직을 **테스트로 고정**해 회귀를 막고, 나중에 CI 게이트(lint·build·test)의 그 `test`가 된다.

**한 일**

- `lib/resilience.mjs`: `withTimeout(fn, ms)`(제한 초과 시 `TimeoutError(code=timeout)`), `withRetry(fn, {retries, baseMs})`(지수 백오프) — 외부 의존성 없는 순수 함수.
- `lib/resilience.test.mjs` + `package.json`의 `test` 스크립트(`node --test`): timeout 성공/초과, retry N번째 성공/전부 실패+시도횟수 — **4 케이스**.
- `worker/worker.mjs`: `claim_job`·`download` 호출을 `withTimeout(…, WORKER_CALL_TIMEOUT_MS)`으로 감쌈 → 행 방지. download 타임아웃은 `error_code=timeout`으로 분류돼 기존 job 재시도에 연결.
- `.env.example`에 `WORKER_CALL_TIMEOUT_MS`.

**핵심 설계**

- timeout은 **취소가 아니라 "그만 기다림"**(underlying 요청은 계속될 수 있으나 결과를 버리고 진행). 목적은 무한 대기 차단.
- 재시도는 **호출 수준**(withRetry)과 **job 수준**(worker handleFailure)이 층이 다름 — 이번엔 worker엔 timeout만 걸고 재시도는 기존 job 재시도가 받게 해 중복 재시도를 피함.
- web 적용은 모듈 경계(TS↔.mjs)상 web/worker 공통화 단계에서 연결(현재는 worker가 사용).

**검증 (실제 동작 확인)**

- `npm test` → **tests 4 / pass 4 / fail 0** (`withTimeout`·`withRetry` 결정적 검증). worker `node --check`·`tsc` 통과.
- 즉 timeout/retry 동작이 **자동 테스트로 증명**됨(수동 재현 불필요). 이 `test`는 추후 GitHub Actions CI의 lint·build·test 게이트에 연결.

**자료**

- `053-test-resilience-pass-20260615.png` — `npm test`(node:test) 실행 결과. `withTimeout`·`withRetry` **4 케이스 전부 통과**(tests 4 / pass 4 / fail 0). 의미: timeout/retry 같은 순수 로직을 **결정적 자동 테스트로 고정** = 수동 재현·스샷에 의존하지 않고 회귀를 막는다. 이 출력이 곧 추후 CI 게이트(lint·build·test)의 `test` 단계가 통과하는 모습이다.
- `054-git-pr11-open` / `055-git-pr11-merged` / `056-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 4. 운영 runbook 초안

**이전 상태 / 문제**

- 지금까지 운영 지식(상태 전이·재시도·키 잘림 함정·stuck job 등)이 **worklog와 코드에 흩어져** 있어, "이상하면 어디 보고 뭘 하나"를 한곳에서 볼 수 없었다.
- → 장애·복구·재처리 절차를 **한 문서(runbook)** 로 모아 운영·인수인계의 기준을 만든다.

**목적**

- worker.md가 "어떻게 동작하나"라면, runbook은 **"문제 생기면 무엇을 하나"** 다. 새벽에 알림이 와도 이 문서만 보면 조회·재처리·롤백을 할 수 있게 — 운영을 *사람 머릿속*이 아니라 *문서*에 둔다.

**한 일**

- `docs/runbooks/runbook.md` 작성: 구성/신호, **health·probe 의미와 대응**, 서비스 재시작, graceful shutdown, 롤백, **stuck/failed job 조회·재처리·회수 SQL**, 흔한 incident 대응(Storage 다운·큐 적체·service_role 키 잘림·readiness 503), 관측 지점, 참고 문서.
- 그동안 검증하며 만난 **운영 함정**(키 잘림 → `Invalid API key` 폴링 지속, download 행 등)을 incident 항목으로 정식 기록.
- `README.md` 인덱스에 runbook 추가.

**비고**

- 지금 쓸 수 있는 **수동 절차** + k3s/ArgoCD/Grafana 단계에서 **자동화될 지점([추후])** 을 함께 표기. 코드(worker·health)와 1:1로 일치.

### 5. 공통 로거 모듈 통합 (web/worker)

**이전 상태 / 문제**

- 로거가 **두 벌**이었다 — web(`src/lib/log.ts`)과 worker(`worker.mjs` 인라인). 포맷은 비슷했지만 **두 곳을 따로 고쳐야 하고 어긋날 위험**이 있었다(필드·레벨 처리가 갈라질 수 있음).
- → 로그 포맷·로직을 **한 곳에서 정의**해 모든 컴포넌트가 같은 모양으로 찍게 한다.

**목적**

- 관측성의 "**한 입구**". 포맷이 한 곳이면 수집·검색·상관(예: `request_id`/`trace_id`로 추적)이 컴포넌트 무관하게 일관된다. 이후 trace 전파·로그 예시도 이 단일 로거 위에 얹힌다.

**한 일**

- `lib/log.mjs`(순수 JS 공통 구현) + `lib/log.d.mts`(TS 타입) 신규 — JSON 한 줄 포맷, `LOG_LEVEL`/`APP_ENV`, `createLogger`/`with`/`log`.
- `src/lib/log.ts`는 그 공통 모듈을 **재export**만 하도록 축소 → web 코드는 기존처럼 `@/lib/log`에서 import(사용처 무변경).
- `worker/worker.mjs`: 인라인 `emit`/`logger` 제거 → 공통 `createLogger` import, `worker_id`를 기본 컨텍스트로(`log.with(...)`).
- `lib/log.test.mjs`(node:test): JSON 구조·컨텍스트 누적 2케이스.

**핵심 설계**

- web(TS)↔worker(.mjs) **모듈 경계**는 `resilience.mjs`와 같은 패턴으로 넘는다 — **.mjs 단일 구현 + .d.mts 타입**. 그래서 한 구현을 양쪽이 공유한다.
- 공개 API(`createLogger`/`with`/`log`)를 유지해 기존 사용처(미디어 프록시·readiness·instrumentation·worker)를 안 건드림.

**검증 (실제 동작 확인)**

- `npm test` → **tests 6 / pass 6 / fail 0**(로거 2 + resilience 4). `tsc --noEmit`·worker `node --check` 통과.
- 즉 web/worker가 **같은 단일 구현**을 쓰고, 로거 출력 포맷이 테스트로 고정됨.

**자료**

- `057-test-logger-pass-20260615.png` — `npm test` 결과: 로거 2 + resilience 4 = **6 케이스 전부 통과**(tests 6 / pass 6 / fail 0). 의미: 공통 로거의 JSON 포맷·컨텍스트 누적이 자동 테스트로 고정됨 → web/worker가 같은 구현을 쓰는 것 + 출력 형태가 회귀 없이 보장된다.
- `058-git-pr13-open` / `059-git-pr13-merged` / `060-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 6. trace_id 전파 (web→worker)

**이전 상태 / 문제**

- 요청 식별자(request_id)는 web 서버 라우트 안에서만 흐르고, **업로드→worker라는 비동기 경계를 넘지 못했다.** 한 업로드가 worker에서 언제·어떻게 처리/실패했는지를 **하나의 id로 잇는 끈**이 없었다.
- → 업로드 때 부여한 식별자(`trace_id`)를 자산에 실어 worker까지 같은 id로 잇는다.

**목적**

- **비동기 경계를 넘는 추적**. 업로드(web)와 후처리(worker)는 시간·프로세스가 떨어져 있는데, 같은 `trace_id`를 공유하면 "이 업로드가 어떻게 처리됐나"를 id 하나로 따라갈 수 있다. 관측성(요청 상관)의 마지막 조각.

**한 일**

- `supabase/schema.sql`: `proof_assets.trace_id` 컬럼 추가(멱등 `add column if not exists`).
- `src/lib/supabase/upload.ts`: 업로드마다 `trace_id`(uuid) 생성 → asset insert에 저장. `types.ts`에 필드 추가.
- `worker/worker.mjs`: 자산을 먼저 조회(`trace_id` 포함)해 job 로거에 `trace_id`를 바인딩 → 선점·완료 등 모든 job 로그가 그 id를 단다.

**핵심 설계**

- trace_id는 **업로드 시점(web)에 발급**되어 **DB(asset)를 매개로** worker에 전파된다 — 우리 구조엔 web→worker 직접 호출이 없으므로 "비동기 전파"가 핵심.
- worker는 asset에서 읽어 모든 로그에 포함 → **`proof_assets.trace_id` ↔ worker 로그 `trace_id`** 가 일치.

**비고 / 검증 방법**

- 적용: Supabase SQL Editor에서 `schema.sql` 재실행(`trace_id` 컬럼 추가).
- 검증: 새 이미지 업로드 → `proof_assets` 행에 `trace_id` 채워짐 → `npm run worker` → worker 로그(job 선점/완료)에 **같은 trace_id**. DB의 trace_id와 로그의 trace_id가 일치하면 web→worker 추적 성립.
- **설계 메모(eager 처리 + 고아 GC 후속)**: asset/job은 **저장이 아니라 업로드(사진 추가) 즉시** 생성된다(파이프라인을 UI 저장과 무관하게 일찍 돌리는 의도). 그 대가로 사진 추가 후 저장 안 하면 어떤 doit에도 안 묶인 **고아 asset/storage**가 남는데, 참조 안 되는 것들을 주기적으로 정리하는 **GC는 후속**으로 둔다(`worker.md` 후속 참고).

**검증 (실제 동작 확인)**

- 로컬 `npm run dev`(이 브랜치)에서 새 이미지 업로드 → 그 asset `93f2eba6…`에 `trace_id=85690c5a…` 부여 → `npm run worker` → 그 job의 `선점`·`완료` 로그에 **같은 `trace_id=85690c5a…`**. DB ↔ worker 로그 trace_id 일치 = web→worker 추적 성립.
- **before/after 대비**: 같은 worker 실행 로그에서 구코드(Vercel/main)로 올라온 옛 asset은 `trace_id:null`, 새 코드로 올린 asset은 `85690c5a…` → "trace_id를 박는 코드로 올린 것만 추적된다"가 한 화면에 드러남.

**자료**

- `061-db-asset-trace-20260615.png` — proof_assets 테이블: 새 asset에 `trace_id` 채워짐(이전 자산은 null).
- `062-obs-worker-trace-20260615.png` — worker 로그: 새 asset의 `선점`/`완료`에 같은 `trace_id`(옛 asset은 null로 대비).
- `063-git-pr14-open` / `064-git-pr14-merged` / `065-git-local-sync` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).
- `tsc`·worker `node --check`·`npm test`(6/6) 통과.

### 7. 로그 예시 문서 (sample logs)

**이전 상태 / 문제**

- 구조화 로그를 찍긴 하는데, 어떤 이벤트가 어떤 필드로 남고 그걸로 무엇을 질의/상관하는지 **한곳에 정리된 게 없었다.** 로그를 처음 보는 사람은 필드 의미·활용을 알기 어렵다.
- → 이벤트별 샘플 + 필드 사전 + 질의 예시를 문서로 남긴다.

**목적**

- 로그를 **"읽고 활용할 수 있게"** 만드는 일. 관측성은 로그를 찍는 것만이 아니라 그걸로 무엇을 질의·상관하느냐가 핵심(예: `trace_id`로 web→worker 추적). 이 문서가 그 사용법을 고정한다.

**한 일**

- `docs/architecture/logging.md` 작성: 공통/컨텍스트 **필드 사전**, web·worker **이벤트별 JSON 샘플**(media served·readiness·SIGTERM·job 선점/완료/실패-재시도/failed/claim 실패), **질의·상관 예시**(trace_id/request_id/error_code/status), Loki/Grafana·OTel 후속.
- `README.md` 인덱스에 logging.md 추가.

**비고**

- 코드(공통 로거·worker·health)가 실제 찍는 로그와 1:1로 맞춤. 수집·대시보드(Loki/Grafana)·분산 트레이싱(OTel)은 [추후].

**자료**

- `066-git-pr15-open` / `067-git-pr15-merged` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 8. /metrics 엔드포인트 + 큐/상태 게이지

**이전 상태 / 문제**

- 로그로 "무슨 일이 있었나"는 보이지만, **"지금 큐가 얼마나 쌓였나·실패가 몇 건인가" 같은 수치(메트릭)** 가 없었다. 상태를 수치로 못 보면 대시보드·알림·스케일 판단의 입력이 없다.
- → Prometheus가 긁어갈 `/metrics`에 상태별 카운트를 노출한다.

**목적**

- **상태를 수치화**하는 일. `queue_depth`(큐 적체)·실패 건수 같은 게이지가 있어야 대시보드·알림·HPA(큐 적체 기반 스케일)가 그 위에서 동작한다. 로그(개별 사건)에 이어 메트릭(집계 수치)을 더하는 단계.

**한 일**

- `supabase/schema.sql`: `metrics_snapshot()` SECURITY DEFINER 함수 — jobs/proof_assets **상태별 전역 카운트**를 jsonb로 반환(집계만, 원본 행 비노출), anon grant.
- `src/app/metrics/route.ts`: Prometheus 텍스트 포맷으로 `dailyproof_jobs_total{status}`(pending=queue_depth), `dailyproof_assets_total{status}`(failed=실패) 노출. anon으로 함수 호출.
- `src/middleware.ts`: matcher에서 `metrics` 제외(인증 없이 scrape 가능).

**핵심 설계**

- 전역 카운트는 RLS 우회가 필요한데 — **service_role 키를 web에 넣는 대신** 집계만 반환하는 **SECURITY DEFINER 함수**를 anon이 호출(`get_grass`와 동일 패턴). 원본 행은 노출되지 않는다.
- 모든 status를 **0 포함 항상 출력** → Prometheus 시계열이 안정적(없다고 사라지지 않음).

**비고 / 검증 방법**

- 적용: Supabase SQL Editor에서 `schema.sql` 재실행(`metrics_snapshot` 함수).
- 처리 지연(latency)은 다음 단계. 운영에선 `/metrics` 내부망 제한 [추후].

**검증 (실제 동작 확인)**

- `localhost:3000/metrics` → Prometheus 텍스트로 게이지 노출 확인: `dailyproof_jobs_total{status="done"} 4`, `{status="failed"} 1`, `{status="pending"} 0`(=queue_depth), `dailyproof_assets_total{status="ready"} 4`, `{status="failed"} 1`. 모든 status가 0 포함 출력됨.
- 값이 그간 데이터와 일치(처리 완료 4, 실패 1=download_failed 테스트분, 큐 비어 pending 0). `tsc`·`npm test`(6/6) 통과.

**자료**

- `068-obs-metrics-endpoint-20260615.png` — `/metrics` 응답(Prometheus 텍스트). jobs/assets 상태별 게이지가 의도대로 노출되고 값이 실제 데이터와 일치.
- `069-git-pr16-open` / `070-git-pr16-merged` — 이 작업을 PR로 main에 반영(생성→merge→로컬 동기화).

### 9. 처리 지연(latency) 지표

**이전 상태 / 문제**

- `/metrics`에 큐·상태 카운트는 있지만 **"처리에 얼마나 걸리나"(지연)** 는 없었다. 지연이 안 보이면 성능 저하를 **수치로 감지·알림**할 수 없다.
- → worker의 **처리 시간**을 근사 게이지로 노출한다.

**목적**

- **성능을 수치화**. queue_depth가 "얼마나 밀렸나"라면 처리 시간은 "worker가 한 건에 얼마나 걸리나" — SLO·알림·성능 회귀 감지의 입력.

**한 일**

- `supabase/schema.sql`: `metrics_snapshot()`에 `job_processing_seconds_avg` 추가 — 최근 done job 100건의 **`(updated_at - locked_at)`**(claim→done) 평균 초.
- `src/app/metrics/route.ts`: `dailyproof_job_processing_seconds_avg` 게이지 노출.

**핵심 설계**

- 처음엔 `created_at→updated_at`(enqueue→done)으로 쟀더니, dev에서 worker를 띄엄띄엄 돌려 **큐 대기가 수 시간** 섞이며 평균이 ~22997초로 폭발 → "처리 지연"으로 부적절. **`locked_at`(claim)→`updated_at`(done)** 으로 바꿔 **큐 대기를 제외한 순수 처리 시간**(~수 초)을 재게 함.
- 의존성 없이 DB 타임스탬프 기반 근사. 정식 Prometheus **histogram**(분위수, prom-client + worker 계측)은 [추후].

**비고 / 검증 방법**

- 적용: `schema.sql` 재실행(`metrics_snapshot` 갱신).
- 적용 후 검증: `/metrics` → **`dailyproof_job_processing_seconds_avg 1.678`** (claim→done 순수 처리 시간, worker 로그의 ~2초와 일치). enqueue→done이던 초기 버전의 22997초(큐 대기 섞임)와 대비됨. `tsc`·`npm test` 통과.

**자료**

- `071-obs-metrics-latency-20260615.png` — `/metrics`에 `dailyproof_job_processing_seconds_avg 1.678` 노출. claim→done 기준이라 큐 대기를 제외한 실제 처리 시간이 수치로 보임.

### 10. 메트릭 목록 문서 (metrics)

**이전 상태 / 문제**

- 메트릭을 코드(`route.ts`/`schema.sql`)에만 두니, 어떤 지표가 무슨 뜻이고 `pending`이 왜 큐 깊이인지, `*_total`이 counter가 아니라 게이지인지 등이 코드를 읽어야만 드러났다. 수집·알림·대시보드를 붙일 때 매번 코드를 역추적해야 하는 상태.

**목적**

- **메트릭을 "사전"으로 명문화**. 메뉴판처럼 "이름·라벨·의미·출처"를 한 표로 모아, 수집기/대시보드 담당이 코드 없이도 무엇을 어떻게 질의하는지 알게 한다. PromQL 예시·알림 후보·scrape 후속까지 한 곳에 둬 관측 작업의 진입점으로 삼는다.

**한 일**

- `docs/architecture/metrics.md` 신설 — ①메트릭 사전(3종, gauge), ②PromQL 질의 예시(큐 깊이·실패 비중·처리 시간), ③알림 후보 표, ④scrape config 예시·Grafana·로그와의 관계.
- `docs/README.md` 문서 인덱스에 추가.

**핵심 설계**

- 코드 기준으로 정확히 기술: `dailyproof_jobs_total`/`dailyproof_assets_total`은 상태별 스냅샷 게이지(`pending`=큐 깊이), `dailyproof_job_processing_seconds_avg`는 claim→done 평균.
- `*_total`이 관례상 counter지만 여기선 게이지임을 명시하고, 정식 counter·histogram 분리를 [추후]로 표시 — 비율(rate)·증가량(increase) 알림의 선결 과제임을 적음.
- 메트릭(집계, "얼마나/빠른가")과 로그(`trace_id`로 개별 추적, "이 건이 어떻게")의 역할 구분과 연결 동선을 명시.

**비고 / 검증 방법**

- 문서 작업이라 런타임 검증 없음. 검증 = 문서의 메트릭 이름·라벨·집계식이 `src/app/metrics/route.ts`·`supabase/schema.sql` 현재 코드와 일치하는지 대조(일치 확인).
- scrape·Grafana·알림 rule의 실제 동작은 [추후] k3s에서 검증.

## 2026-06-16

### 1. OpenTelemetry SDK 도입 (web)

**이전 상태 / 문제**

- 앞서 업로드에 `trace_id`를 실어 web→worker 로그를 묶을 수 있게 했지만, 이건 우리가 만든 **상관용 문자열 ID**일 뿐이라 "어느 단계가 다른 단계의 하위인지", "각 구간이 몇 ms 걸렸는지" 같은 **호출 관계·구간 시간**은 알 수 없었다. 분산 추적의 표준 모델(span 트리)이 없는 상태.

**목적**

- **표준 OpenTelemetry로 끌어올리기**. 택배 송장번호(=trace_id)로 "같은 주문"임을 알던 단계에서, 물류 추적 화면처럼 **단계별 시작·소요·부모-자식 관계**를 보는 단계로 넘어간다. 이번 작업은 그 첫 단추로 web 쪽에 SDK를 붙여 요청마다 root span을 만들고 trace 백엔드로 내보낸다.

**한 일**

- `@vercel/otel`(Next.js 15 권장)·`@opentelemetry/api` 도입.
- `src/instrumentation.ts`의 `register()`(nodejs 런타임)에서 `registerOTel()` 호출 — `serviceName=dailyproof-web`, `deployment.environment=APP_ENV`, exporter는 **OTLP/HTTP**로 `OTEL_EXPORTER_OTLP_ENDPOINT`(기본 `http://localhost:4318`)의 `/v1/traces`에 전송.
- `.env.example`에 `OTEL_EXPORTER_OTLP_ENDPOINT`·`OTEL_SERVICE_NAME` 추가.

**핵심 설계**

- 증거(span 트리)를 보려면 백엔드가 필요한데, 컨테이너화는 후속이라 이번엔 **로컬 Jaeger all-in-one(단일 컨테이너, OTLP 4318 수신)** 으로 확인한다. exporter가 OTLP 표준이라 운영에선 endpoint만 바꿔 **Grafana 스택과 일관된 Tempo**로 교체 가능(코드 불변) — 그 의도를 주석·env에 명시.
- 기존 SIGTERM graceful shutdown 처리는 그대로 두고 그 위에 OTel 등록만 추가(관심사 분리).

**비고 / 검증 방법**

- `tsc --noEmit` 통과. `next build` — **Compiled successfully + 타입 검증 통과 + static pages 9/9 생성**(끝의 `EPERM copyfile`은 OTel 무관, WSL drvfs의 `.next` 복사 권한 제약).
- span이 실제 백엔드에 뜨는 화면은 worker 전파까지 들어간 뒤 **web→worker→DB 전체 트리로 한 번에** 캡처(후속). 단독 web span만 찍는 것보다 관계가 드러나 증거로 낫기 때문.

### 2. worker 트레이싱 + web→worker→DB span 전파

**이전 상태 / 문제**

- web에만 SDK가 붙어 있어 worker는 trace 밖이었다. 게다가 업로드는 `"use client"` 코드라 **브라우저에서 직접** Storage·DB에 쓰고, 후처리는 큐(DB)를 거쳐 worker가 나중에 집어간다. 즉 ①worker에 span이 없고 ②업로드 시점에 부모로 삼을 **서버 span 자체가 없으며** ③web과 worker는 HTTP로 직접 안 이어져 표준 컨텍스트 전파(헤더)가 불가능했다.

**목적**

- **끊긴 두 프로세스를 한 trace로 잇기**. 택배로 치면 송장번호(=`trace_id`, 로그용)는 있었지만, "접수→상차→배송" 단계가 부모-자식으로 연결된 추적 화면이 없었다. web 요청에서 시작된 trace를 비동기 큐 경계 너머 worker까지 이어, 한 업로드가 어느 단계에서 얼마나 걸렸는지 트리로 보이게 한다.

**한 일**

- **부모 span 만들 지점 확보**: asset 등록을 브라우저 직접 insert → 새 서버 라우트 `POST /api/proof-assets` 경유로 변경. 이 라우트는 `@vercel/otel`이 span으로 감싸므로 여기서 trace가 시작된다. (파일 업로드 자체는 브라우저→Storage 직행 유지 — 8MB를 서버로 우회시키지 않음.)
- **경계 전파**: 서버 라우트가 활성 span에서 **W3C `traceparent`** 를 만들어 `proof_assets.traceparent` 컬럼에 저장. worker가 job을 집을 때 그 값을 `propagation.extract`로 **부모 컨텍스트로 복원** → worker span이 web span의 자식이 됨.
- **worker 계측**: `worker/tracing.mjs`(NodeSDK + OTLP/HTTP exporter, `service.name=dailyproof-worker`) 추가. `processJob`을 `worker process_image`(부모=web) span으로 감싸고, 그 아래 `storage.download`·`db.update proof_assets ready` 자식 span으로 구간을 나눔. 실패 시 span에 예외 기록.
- 스키마에 `traceparent text` 컬럼(멱등 alter), 타입에 반영.

**핵심 설계**

- 브라우저는 OTel 계측 대상이 아니므로(서버만 계측), trace 시작점을 **서버 라우트로 끌어옴** — 이게 "web→worker"를 진짜 부모-자식으로 만들 수 있는 유일하게 깔끔한 지점.
- 큐(DB)는 HTTP 헤더가 없으니, 컨텍스트를 **데이터(traceparent 컬럼)에 실어** 비동기 경계를 넘김 — 메시지큐 트레이싱의 표준 패턴.
- 기존 `trace_id`(로그 상관)는 그대로 두고 `traceparent`(span 부모)를 **나란히** 둠 — 로그(개별 추적)와 trace(span 트리)는 역할이 달라 둘 다 유용.

**비고 / 검증 방법**

- `tsc` 통과. worker 구문(`node --check`) OK. `next build` — Compiled successfully + 타입·lint 검증 + static 9/9(끝 `EPERM`은 무관, drvfs `.next` 복사 제약).
- **전파 스모크 테스트**: 가짜 `traceparent`(`00-0af7…319c-…-01`)를 `propagation.extract`로 복원해 worker span을 시작하니, child span의 trace-id가 **부모와 동일(`0af7…319c`)** 로 확인됨 → 비동기 경계 전파가 실제로 부모-자식을 잇는다.
- 실제 Jaeger UI에서 web→worker→DB 트리가 한 trace로 묶이는 화면은 다음 단계에서 캡처.

### 3. trace 확인 + 트레이싱 문서

**이전 상태 / 문제**

- web SDK·worker 전파를 코드로 붙였지만, ①실제로 한 trace에 묶이는지 **눈으로 확인된 증거가 없었고**, ②트레이싱 구성·전파 방식·기존 `trace_id`와의 차이가 코드에 흩어져 있어 "왜 서버 라우트를 거치나", "traceparent가 뭐고 trace_id와 뭐가 다른가"를 코드를 읽어야만 알 수 있었다.

**목적**

- **증거로 확정하고, 사전으로 남기기**. 로컬 Jaeger로 web→worker→DB가 한 트리로 이어지는 걸 실제로 띄워 캡처하고, 트레이싱의 구성·비동기 경계 전파·trace_id와의 관계를 한 문서로 모아 관측의 진입점으로 둔다.

**한 일**

- 로컬 **Jaeger all-in-one**(docker, 16686/4318)을 띄우고 web(`npm run dev`)·worker(`npm run worker`)를 호스트에서 실행, 이미지 업로드 1건으로 trace 생성·확인.
- `docs/architecture/tracing.md` 신설 — ①구성(web/worker SDK·OTLP·Jaeger), ②비동기 경계 전파(서버 라우트 시작점 + traceparent를 DB에 실어 큐 넘김), ③`trace_id`와 OTel trace의 역할 구분, ④확인 방법·증거, ⑤Tempo·sampling 후속.
- `docs/README.md` 인덱스 추가.

**핵심 설계**

- 증거는 "묶였다"는 목록(Search)보다 **부모-자식이 드러나는 상세 트리(waterfall)** 가 완료기준(span 관계 확인)에 직접 부합 → 트리 화면을 대표 증거로 삼음.
- 문서에서 메트릭·로그·trace의 3축 역할을 구분하고, trace에서 이상 발견 → `trace_id`로 로그 좁히기의 동선을 명시.

**비고 / 검증 방법**

- 실측: trace `0ef2154` — **Services 2 · Depth 4 · Total Spans 7**. `dailyproof-web POST /api/proof-assets/route`(root) → `executing api route` → **`dailyproof-worker worker process_image`(자식)** → `storage.download`·`db.update proof_assets ready`. worker 구간이 뒤로 떨어진 건 큐 대기(비동기)로 정상, 부모-자식은 ID로 유지.
- `proof_assets.traceparent` 컬럼에 W3C 값이 실제로 저장됨(전파 매개체 확인).
- 컨테이너화·Tempo 전환은 [추후].

**자료**

- `080-trace-otel-jaeger-search-20260616.png` — Search 목록에서 `POST /api/proof-assets`가 `dailyproof-web (4)`+`dailyproof-worker (3)` 7 spans로 한 trace에 묶임(두 서비스 동시).
- `082-trace-otel-web-worker-tree-20260616.png` — 그 trace 상세(waterfall) 트리. web root 아래 worker span이 자식으로, 그 아래 download·db 구간까지. **대표 증거.**
- `081-db-proof-assets-traceparent-20260616.png` — `proof_assets.traceparent` 컬럼에 W3C traceparent가 저장된 모습(전파가 DB를 매개로 일어남을 보임).

### 4. web/worker 컨테이너 이미지 (Dockerfile)

**이전 상태 / 문제**

- 실행이 흩어져 있다. web은 `npm run dev`, worker는 `npm run worker`, Jaeger는 수동 `docker run` — 환경마다 손으로 맞춰야 하고, 어디서도 "이 커밋을 이렇게 띄운다"가 **재현 가능한 산출물로 고정**돼 있지 않았다. 배포(다음 단계)도 이미지 없이는 시작할 수 없다.

**목적**

- **실행 환경을 이미지로 굳히기**. 레시피(Dockerfile)만 있으면 누구의 머신에서도 같은 컨테이너가 뜨도록 web·worker를 각각 이미지화한다. 다음 단계의 compose·배포가 얹힐 토대.

**한 일**

- `next.config.mjs`에 `output: "standalone"` 추가 — 서버 실행에 필요한 파일·의존성만 추린 `.next/standalone` 산출물 생성.
- `Dockerfile.web` — 멀티스테이지(deps→builder→runner). runner는 standalone + 정적자산만 담고 비루트(`nextjs`) 유저로 `node server.js` 실행. 공개값(`NEXT_PUBLIC_*`)은 빌드 시 인라인되므로 `--build-arg`로 주입(시크릿은 절대 빌드에 안 넣음).
- `Dockerfile.worker` — 빌드 단계 없이 `npm ci --omit=dev`(런타임 의존성만) + `worker/`·`lib/`만 담아 비루트(`worker`) 유저로 `node worker/worker.mjs`. env는 컨테이너 런타임에서 주입(로컬의 `--env-file` 대신).
- `.dockerignore` — `node_modules`/`.next`/`.env*`/`docs`/`*.png` 등 제외(이미지 슬림화 + 시크릿 유출 방지).

**핵심 설계**

- web은 `standalone`이라 런타임 이미지에 전체 `node_modules`가 아니라 추적된 최소 의존성만 들어간다. OTel은 `@vercel/otel`이 instrumentation 번들에 인라인되고 싱글톤 `@opentelemetry/api`만 external로 추적돼 standalone에 포함 — 별도 처리 불필요.
- worker는 web과 **별도 이미지**(독립 프로세스·다른 의존성 집합).

**비고 / 검증 방법**

- `npm run build`가 drvfs(윈도우 마운트)에서 `EPERM copyfile`(`_not-found.html`→`pages/404.html`)로 중단되는 건 **WSL drvfs 전용 현상** — 리눅스 fs(컨테이너 빌드)에선 안 난다. 이를 확인하려고 **WSL 네이티브 경로로 소스를 옮겨 빌드 → 성공(exit 0)**, `.next/standalone/server.js`·`node_modules`·`.next/static` 생성과 `/api/proof-assets`·`/metrics`·`/health/*` 라우트 포함 확인.
- standalone의 외부 의존성 추적 검증: 컴파일된 `instrumentation.js`는 외부로 Node 내장(module/path/url)만 require하고 `@vercel/otel`은 번들 인라인, `@opentelemetry/api`는 standalone `node_modules`에 존재 → web 컨테이너 부팅에 빠진 모듈 없음.
- 실제 `docker build`·컨테이너 기동은 Docker가 있는 환경에서 수행(다음 단계 compose에서 일괄). 빌드 예: `docker build -f Dockerfile.web --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=… -t dailyproof-web .`

### 5. docker-compose 스택 (web·worker·jaeger)

**이전 상태 / 문제**

- 이미지는 생겼지만 여전히 web·worker·jaeger를 **각각 손으로** 띄워야 했다(`docker run` 3번, env·포트·네트워크를 매번 맞춤). "관측 가능한 스택 통째로 기동"이 한 명령으로 재현되지 않았다.

**목적**

- **스택을 한 명령으로 묶기**. `docker compose up` 하나로 web·worker·jaeger가 같은 네트워크에서 뜨고 서로 이름으로 닿게 한다. 수동 `docker run jaeger`를 흡수.

**한 일**

- `docker-compose.yml` 작성 — jaeger(UI 16686 / OTLP 4318), web(`Dockerfile.web` 빌드, 3000 노출), worker(`Dockerfile.worker` 빌드) 3개 서비스.
- **OTLP 라우팅**: 컨테이너 네트워크에선 localhost가 아니라 서비스명으로 닿으므로, web·worker의 `OTEL_EXPORTER_OTLP_ENDPOINT`를 `http://jaeger:4318`로 덮어씀.
- **env 주입**: `env_file: .env.local`로 런타임 시크릿(서비스롤 등)을 컨테이너에 주입하고, 빌드 시 인라인되는 `NEXT_PUBLIC_*`는 compose 변수 치환(`--env-file .env.local`)으로 build arg에 전달.
- web에 `wget` 기반 `/health/live` healthcheck + `restart: unless-stopped`.
- `.env.example`에 docker 시 endpoint가 `jaeger:4318`로 바뀜을 메모.

**핵심 설계**

- 시크릿은 **이미지가 아니라 런타임(env_file)** 으로만 들어간다(`.dockerignore`가 `.env*` 차단 + 빌드엔 공개값만).
- 실행은 `docker compose --env-file .env.local up --build` 한 줄 — 변수 치환과 컨테이너 주입을 같은 파일로 통일.

**비고 / 검증 방법**

- 구문 검증: 시크릿 노출 없이 더미 env로 치환해 `docker compose config -q` → **exit 0**(구조 유효).
- 실측: `docker compose --env-file .env.local up --build` → **빌드 32/32 성공**, 컨테이너 3개(web `:3000`·worker `env=production`·jaeger) 기동. 업로드 1건 시 web 로그에 `/api/proof-assets "asset 등록"`, Jaeger에 **`POST .../api/proof-assets/route` = `dailyproof-web (6)`+`dailyproof-worker (3)` 9 spans**로 **별개 컨테이너의 web→worker가 `jaeger:4318`로 한 trace에 묶임** 확인.
- 참고: jaeger v1 EOL deprecation 경고(동작 무관). 이미지 태그 고정/v2 전환은 후속.

**자료**

- `088-deploy-compose-build-20260616.png` — `docker compose ... up --build`가 web·worker 이미지를 `Building 184.1s (32/32) FINISHED`로 빌드.
- `089-deploy-compose-up-20260616.png` — web·worker·jaeger 컨테이너 생성 + jaeger OTLP receiver 기동.
- `090-deploy-compose-running-20260616.png` — web `:3000` 기동·worker `worker 시작`(env=production)·업로드 시 `/api/proof-assets "asset 등록"` 로그.
- `087-trace-compose-web-worker-20260616.png` — Jaeger에서 컨테이너 스택의 `POST .../api/proof-assets/route`가 web(6)+worker(3) 9 spans로 한 trace에 묶임(컨테이너 간 전파 동작).

### 6. smoke test + local stack 문서

**이전 상태 / 문제**

- 스택은 뜨지만, "잘 떴는지"를 매번 브라우저로 web·Jaeger를 눌러보고 메트릭을 눈으로 확인했다. 자동 점검이 없어 CI 게이트로 쓸 수 없고, 구동 절차·포트·흔한 걸림돌이 머릿속/대화에만 있어 재현이 사람 의존적이었다.

**목적**

- **"떴는지"를 한 명령으로 판정 + 절차를 문서로 고정**. smoke 스크립트로 헬스·메트릭·관측 백엔드 도달을 pass/fail로 찍고, local-stack 문서로 누구나 같은 절차로 띄우고 막히면 표에서 찾게 한다.

**한 일**

- `scripts/smoke.mjs` + `npm run smoke` — 의존성 없이 `/health/live`·`/health/ready`·`/metrics`(게이지 노출)·Jaeger UI 도달을 점검, 실패 시 비-0 종료(CI 게이트 가능). 대상·타임아웃은 env로 조정.
- `docs/runbooks/local-stack.md` — 구성·포트표, 실행(`docker compose --env-file .env.local up --build`), smoke 사용법, 트러블슈팅 표(포트 충돌·env 누락·trace 지연·drvfs 빌드), 종료, 후속(jaeger 태그 고정/v2·관측 스택 통합).
- `docs/README.md` 인덱스 추가.

**핵심 설계**

- 업로드→worker→trace는 로그인 사용자가 필요해 **자동 smoke에서 제외**하고 그 양 끝(web 헬스/메트릭, jaeger 도달)만 본다 — 자동화 가능한 범위를 정직하게 한정하고, 전체 경로는 수동 절차로 문서화.
- jaeger `:latest`(v1 EOL 경고)는 검증된 구성을 깨지 않으려 그대로 두고, **태그 고정/v2 전환을 문서의 후속으로 명시**.

**비고 / 검증 방법**

- 실측: 떠 있는 컨테이너 스택 대상으로 `npm run smoke` → **4개 체크 전부 PASS, exit 0** (`/metrics`의 `dailyproof_jobs_total`·`dailyproof_job_processing_seconds_avg` 노출 포함 확인).

### 7. k8s 워크로드 + liveness/readiness probe (Helm)

**이전 상태 / 문제**

- 컨테이너는 compose로 한 머신에서만 떴다. compose는 "프로세스가 죽었나"까지만 보고, **죽은 컨테이너를 살리거나 트래픽 받을 준비가 됐을 때만 라우팅하는** 오케스트레이션이 없다. 또 선언적 배포 정의가 없어 "이 워크로드를 이렇게 띄운다"가 k8s 표준으로 고정돼 있지 않았다.

**목적**

- **워크로드를 k8s 선언형으로 정의 + 헬스를 오케스트레이터에 연결**. 앞서 만든 `/health/live`·`/health/ready`를 k8s liveness/readiness probe로 물려, "죽으면 재시작·준비됐을 때만 트래픽"을 플랫폼이 자동 처리하게 한다. 환경별 분리·실제 배포(IaC)가 얹힐 토대.

**한 일**

- Helm 차트 `deploy/helm/dailyproof/` 신설 — web Deployment + Service, worker Deployment, `_helpers.tpl`(이름·라벨), `values.yaml`.
- **probe 연결**: web에 liveness=`/health/live`, readiness=`/health/ready`(httpGet). readiness는 의존성(Supabase 도달) 점검이라 준비 전엔 트래픽 차단.
- resource requests/limits + 비루트 `securityContext`(runAsNonRoot·uid 1001·capabilities drop ALL) 적용. 이미지 pullPolicy=IfNotPresent(로컬 import 이미지 사용).
- 비밀 아닌 설정은 일단 deployment env로 주입(추후 ConfigMap/Secret으로 분리). worker는 HTTP 미개방이라 httpGet probe 대상이 없어 제외(정밀 liveness는 후속).

**핵심 설계**

- 새 헬스 체계를 만들지 않고 **기존 `/health/*` 엔드포인트를 그대로 probe로 재사용** — 앱·k8s가 같은 신호를 공유.
- 차트는 values로 env 차이를 받게 설계해, 다음 단계(staging/prod values)가 자연히 얹히게 함.

**비고 / 검증 방법**

- `helm lint` 통과(icon 권고만). `helm template` → Deployment×2 + Service×1 렌더, probe가 `/health/live`·`/health/ready` 가리킴 확인.
- **실제 k3s API server-side dry-run**: `helm template | kubectl apply --dry-run=server` → service·deployment×2 모두 `created (server dry run)`(API 스키마 검증 통과). 로컬 k3s(v1.35) 사용.
- 파드 실제 기동(이미지 import 필요)·Terraform apply는 다음 단계.

### 8. Secret/ConfigMap 분리

**이전 상태 / 문제**

- 직전 차트는 모든 설정을 deployment의 inline `env`로 박아 넣었다. 비밀(서비스롤)과 비밀-아님(로그 레벨·OTEL endpoint 등)이 한 곳에 섞여, 시크릿 회전·환경별 변경이 워크로드 정의를 건드려야 했고 "비밀을 어디서 주입하나"가 불명확했다.

**목적**

- **비밀/비밀-아님을 k8s 표준으로 분리**. 비밀 아닌 설정은 ConfigMap, 진짜 시크릿은 Secret으로 빼서 `envFrom`으로 주입한다. 설정 변경과 시크릿 주입을 워크로드와 분리하고, 실값은 차트 밖(주입 시점)에만 둔다.

**한 일**

- `templates/configmap.yaml`(비밀 아닌 `config`) + `templates/secret.yaml`(`secrets`, stringData) 추가.
- 워크로드 `envFrom` 전환: **web = ConfigMap만**(service_role 불필요), **worker = ConfigMap + Secret**.
- `values.yaml` 재구성: `config`(NEXT_PUBLIC_* 공개값 placeholder 포함) / `secrets`(빈 placeholder). 실값은 `-f values-secret.yaml`(gitignored)·`--set`·Terraform tfvars로 주입.
- `values-secret.example.yaml`(주입 예시) 추가, `.gitignore`에 `values-secret.yaml` 차단.

**핵심 설계**

- web은 서비스롤을 안 쓰므로 **Secret을 참조조차 안 함**(최소 권한) — 시크릿 노출면을 worker로 한정.
- NEXT_PUBLIC_*(URL·anon 키)는 RLS로 보호되는 공개값이라 ConfigMap에 둠. 진짜 시크릿(service_role)만 Secret.
- 차트에는 시크릿 실값이 없다(빈 placeholder) — 렌더 결과에도 실값 미포함.

**비고 / 검증 방법**

- `helm template` → ConfigMap×1·Secret×1·Deployment×2·Service×1. web `envFrom`=configMapRef만, worker=configMapRef+secretRef 확인. Secret의 `SUPABASE_SERVICE_ROLE_KEY`는 빈 값(유출 없음).
- **실 k3s server-side dry-run**: 5개 리소스 모두 `created (server dry run)` 통과.

### 9. staging/prod values 분리 + k8s 문서

**이전 상태 / 문제**

- 차트가 dev 기준 단일 `values.yaml`뿐이라, 환경별 차이(레플리카·리소스·로그 레벨·이미지 태그)를 표현할 방법이 없었다. staging/prod를 같은 정의로 띄우면 "환경 분리"가 형식상에만 존재한다.

**목적**

- **base + 환경 override로 분리**. 공통은 base에 두고 환경 차이만 `values-staging.yaml`/`values-prod.yaml`로 덮어써, 같은 차트로 환경별로 다르게 띄운다. 그리고 차트 구조·렌더/검증/적용·시크릿 주입을 문서로 고정.

**한 일**

- `values-staging.yaml`(replicas 1·tag staging·APP_ENV staging) / `values-prod.yaml`(web·worker replicas 2·리소스 상향·tag prod·APP_ENV prod·LOG_LEVEL warn) 추가.
- `docs/runbooks/k8s-deploy.md` 작성 — 차트 구조·리소스 표, env별 values 비교표, 시크릿 주입(차트 밖), 렌더/검증/적용 절차(이미지 k3s import 포함), 후속(Terraform apply·레지스트리·Ingress).
- `docs/README.md` 인덱스 추가.

**핵심 설계**

- override는 **차이만** 담는다(공통은 base) — 중복 없이 환경 간 diff가 한눈에.
- 차트는 순수 k8s API라 로컬 k3s↔클라우드(EKS 등) 이식 가능 — 문서에 그 이식성 명시.

**비고 / 검증 방법**

- `helm template -f values-staging` / `-f values-prod` 각각 렌더 → **staging: APP_ENV=staging·replicas 1·tag staging / prod: APP_ENV=prod·replicas 2·tag prod**로 실제 다르게 나옴 확인.
- prod 렌더 **실 k3s server-side dry-run 5개 리소스 통과**.
- 실제 apply는 Terraform(helm provider) + 이미지 import로 다음 단계 실증.

### 10. Terraform으로 Helm 차트 배포 (IaC 실증)

**이전 상태 / 문제**

- 배포가 `helm install`/dry-run 같은 **명령 단위**로만 이뤄졌다. 그래서 ①클러스터에 무엇이 떠 있는지가 명령 실행 이력에만 남아 **형상이 코드로 추적되지 않고**(드리프트·재현 어려움), ②변경·롤백·삭제가 수동 명령이라 **리뷰도 재현도 안 되며**, ③환경별 배포가 사람 손에 의존했다.

**목적**

- **배포 형상을 선언적 코드(IaC)로 관리**. `helm install`을 직접 치는 대신 Terraform이 릴리스를 state로 관리하면, `apply` 한 번으로 같은 상태를 재현하고 변경은 `plan`으로 리뷰되며 `destroy`로 회수된다. 그 효과를 로컬 k3s 실제 배포로 확인한다.

**한 일**

- `deploy/terraform/` 신설 — `main.tf`(helm_release: 로컬 차트 + 환경 values 참조), `variables.tf`, `outputs.tf`, `terraform.tfvars.example`.
- 시크릿/공개키는 **tfvars로 주입**(`set_sensitive`/`set`) — 차트엔 placeholder, 실값은 `terraform.tfvars`(gitignored).
- `.gitignore`에 tfvars·`.terraform/`·tfstate 차단. `runbooks/k8s-deploy.md`에 Terraform 실행 절(이미지 import·apply·drvfs 주의) 추가.

**핵심 설계**

- 릴리스를 명령(`helm install`)이 아니라 **선언(terraform state)** 으로 관리 → 재현·변경·삭제가 코드로 추적됨.
- 차트의 환경 values(`values-${env}.yaml`)를 그대로 재사용 — IaC가 기존 차트를 감싸는 얇은 레이어.

**비고 / 검증 방법**

- `terraform fmt`/`init`/`validate` 통과(helm provider 2.17). drvfs chmod 제약으로 init이 막혀 **WSL 네이티브 경로에서 검증**.
- **실 k3s 대상 `terraform plan` → `Plan: 1 to add`**(helm_release 생성, outputs dp/dailyproof/deployed) — apply-ready 확인.
- **실측(IaC 실증)**: 이미지를 `:staging` 태그로 k3s containerd에 import 후 `terraform apply` → **`Apply complete! Resources: 1 added`**, `release_status = "deployed"`. `kubectl get pods -n dailyproof` → `dp-dailyproof-web`·`dp-dailyproof-worker` 모두 **`1/1 Running`** = Terraform이 로컬 k3s에 차트를 실제 배포하고 파드가 기동됨(helm install 직접이 아니라 IaC로 관리).

**자료**

- `101-deploy-terraform-apply-pods-running-20260617.png` — `terraform output`(release_status=deployed) + `kubectl get pods -n dailyproof`에서 web·worker 모두 1/1 Running. Terraform이 띄운 파드가 실제 가동 중인 화면.

## 2026-06-17

### 1. GitHub Actions CI (build/test/validate)

**이전 상태 / 문제**

- 그동안 검사를 사람이 손으로 돌렸다 — tsc·테스트·helm lint·terraform validate를 기억해서 실행. 자동 게이트가 없어 **깨진 코드/매니페스트가 merge될 수 있고**, 검증이 일관되지 않았다. (Notion sync 워크플로는 있었지만 코드 검증 CI는 없음.)

**목적**

- **PR마다 자동으로 도는 merge gate**. push/PR 시 코드(타입·테스트)·매니페스트(helm·terraform)·이미지(docker build)를 자동 검증해, 통과해야만 merge되도록 한다.

**한 일**

- `.github/workflows/ci.yml` 작성 — 3개 잡: **quality**(tsc 타입체크·`npm test`), **manifests**(helm lint + staging/prod 렌더, terraform fmt/init/validate), **images**(worker·web docker build).
- web 이미지는 빌드 시 인라인되는 `NEXT_PUBLIC_*`에 더미 공개값을 build-arg로 넣어 빌드만 검증(시크릿 불필요).
- 트리거: `pull_request`(merge gate) + main `push`. concurrency로 중복 실행 취소.

**핵심 설계**

- ESLint는 아직 미설정이라 `next lint`가 대화형으로 멈춘다 → CI 정적 검사는 **tsc 타입체크로 대체**(lint 도입은 후속).
- 같은 CI 단계를 이후 **Jenkins 파이프라인에서 미러링** → 관리형/self-hosted 양쪽 실증.

**비고 / 검증 방법**

- 로컬 선검증(docker 제외): YAML 파싱 OK, `tsc` exit 0, `npm test` fail 0, `helm lint`+staging/prod 렌더 OK, `terraform fmt -check` OK.
- web 빌드 안전성 확인: 홈·동적 라우트가 `cookies()`/server client로 **동적 렌더**라 static 생성 시 Supabase 미호출 → 더미 공개값 빌드 가능.
- 실제 CI green은 push 후 GitHub Actions 결과로 확인(증거 캡처).

### 2. ArgoCD GitOps 배포 (staging)

**이전 상태 / 문제**

- 배포가 **push 방식**(내가 `terraform apply`로 클러스터에 밀어넣음)뿐이었다. 누가 클러스터를 직접 바꾸면(드리프트) 자동으로 되돌릴 장치가 없고, "git에 merge하면 곧 배포"라는 GitOps 흐름이 없었다.

**목적**

- **pull 기반 GitOps 도입**. 클러스터 안 ArgoCD가 **git을 source of truth**로 삼아 차트를 끌어와 동기화(auto-sync·selfHeal)하게 한다. Terraform(push)과 다른 메커니즘을 별도 네임스페이스로 공존시켜 둘 다 시연.

**한 일**

- `deploy/argocd/application.yaml` — Application(repo `main`의 `deploy/helm/dailyproof` + `values-staging`)을 `dailyproof-staging`에 배포, `automated`(prune·selfHeal)+`CreateNamespace`.
- `deploy/argocd/repo-secret.example.yaml` — private repo 클론용 git 크리덴셜(PAT) 템플릿, 실값은 `repo-secret.yaml`(gitignored).
- `docs/runbooks/argocd.md` — 설치·크리덴셜·Application·시크릿 주입·UI·Terraform 비교·후속. README 인덱스 추가.

**핵심 설계**

- **시크릿은 git에 두지 않음** — Application엔 placeholder, 실값은 `argocd app set -p`로 **클러스터에만** 주입(GitOps 베스트프랙티스). 정식 sealed/external-secrets는 후속.
- Terraform과 **네임스페이스 분리**(`dailyproof` vs `dailyproof-staging`)로 push/pull 공존.
- 이미지는 k3s에 import된 `:staging` 재사용(레지스트리 미사용, 후속).

**비고 / 검증 방법**

- 매니페스트 YAML 파싱 OK.
- **실측**: k3s에 ArgoCD 설치 → Application 적용 → ArgoCD가 **private repo 클론·동기화**(repo 크리덴셜 PAT) → **Synced**. config/secret 주입·이미지 재빌드 후 web·worker **1/1 Running** → 앱 **Healthy**. UI 리소스 트리(앱→Deployment→ReplicaSet→Pod) 확인.
- **핵심 교훈(빠진 함정)**: web의 `/health/ready`가 쓰는 `NEXT_PUBLIC_SUPABASE_ANON_KEY`는 Next.js가 **빌드 시점에 번들에 인라인**한다 → 런타임 ConfigMap/env로 바꿔도 서버 코드는 **빌드 때 박힌 값**을 쓴다. 키를 rotate하자 박힌 옛 키가 무효화돼 `Unregistered API key`로 readiness 실패했고, **이미지를 새 키로 재빌드**해야 해결됐다. (curl로 새 키는 200 확인 → 키가 아니라 빌드 문제로 판별). worker의 `SUPABASE_SERVICE_ROLE_KEY`는 NEXT_PUBLIC_ 아님 → 런타임 Secret 주입으로 정상.
- 후속: 런타임 교체가 필요하면 server를 비-public env로 읽도록 리팩터(또는 런타임 config 주입). 시크릿 노출 시 대응은 Supabase 새 API key(secret key) 교체·옛 키 삭제.

**자료**

- `104-deploy-argocd-healthy-tree-20260617.png` — ArgoCD UI에서 `dailyproof-staging` 앱이 **Synced·Healthy**, 리소스 트리(Deployment→ReplicaSet→Pod) 펼쳐진 화면(GitOps 시각화).

### 3. Ingress + 네트워크 정책 문서

**이전 상태 / 문제**

- web Service가 **ClusterIP**(내부 전용)라 외부 접속은 매번 `kubectl port-forward`(임시 터널)에 의존했다. 정식 외부 진입로가 없고, 업로드 8MB·timeout 같은 **HTTP 계층 정책**도 어디에도 명시돼 있지 않았다.

**목적**

- **정식 진입로(Ingress) + HTTP 정책 명시 + 네트워크 문서화**. 호스트 기반 라우팅으로 port-forward 없이 접속하게 하고, body size·timeout·keep-alive 정책의 위치/근거를 고정한다.

**한 일**

- 차트에 `templates/ingress.yaml`(조건부) 추가 — `ingress.enabled`/`className`(k3s Traefik)/`host`/`path`로 host 기반 라우팅, web Service(:3000)로 연결. `values.yaml`에 `ingress` 블록·정책 annotation 자리.
- `docs/architecture/network.md` — 트래픽 흐름(클라이언트→Ingress(Traefik)→Service→Pod), HTTP/HTTPS·TLS 위치, body size(8MB)·timeout·keep-alive 정책의 컨트롤러별 적용법(NGINX annotation vs Traefik Middleware 예시), 로컬 접속(/etc/hosts), 후속(cert-manager·정책 강제). README 인덱스 추가.

**핵심 설계**

- 정책은 컨트롤러마다 거는 위치가 달라(차트는 `annotations` 패스스루) **문서에 NGINX·Traefik 두 방식**을 명시. body size는 업로드 한도(버킷 `file_size_limit` 8MB)와 짝맞춤.
- worker는 HTTP 미개방이라 Ingress 대상 아님. 업로드 파일 자체는 브라우저→Storage 직행이라 이 경로 밖.

**비고 / 검증 방법**

- `helm lint` 통과. `helm template` → 리소스에 **Ingress 포함**(host `dailyproof.local`→web:3000). **실 k3s server-side dry-run**: `ingress.networking.k8s.io/dp-dailyproof-web created (server dry run)` 포함 6개 리소스 통과.
- 실제 호스트 접속(http://dailyproof.local)·TLS는 로컬 /etc/hosts 매핑·[추후].

### 4. Jenkins 파이프라인 실증 (self-hosted CI)

**이전 상태 / 문제**

- CI가 GitHub Actions(관리형) 하나뿐이었다. 채용 시장엔 **Jenkins(self-hosted)**를 쓰는 곳이 많은데, "GitHub Actions로 만든 파이프라인이 Jenkins로도 된다"를 실물로 보여줄 게 없었다. (둘은 개념이 같지만 Jenkins는 CI 인프라 운영까지 포함)

**목적**

- **같은 CI를 Jenkins로 미러링**. GitHub Actions의 검사(typecheck·test·helm·terraform·docker build)를 그대로 Jenkins 선언형 파이프라인으로 구현해, 관리형/self-hosted **양쪽으로 같은 파이프라인을 설계**했음을 보인다.

**한 일**

- repo 루트에 **`Jenkinsfile`**(declarative) 작성 — `ci.yml`과 동일 4스테이지. 각 스테이지를 도구 이미지(node:22 / alpine/helm / hashicorp/terraform / docker:cli) 컨테이너 에이전트로 실행(컨트롤러에 도구 설치 불필요). `agent none`이라 스테이지마다 `checkout scm`으로 소스 확보, docker build는 호스트 소켓 공유.
- `docs/runbooks/jenkins.md` — 로컬 Jenkins 실행(Docker+소켓+Docker Pipeline 플러그인), private repo 자격증명, Pipeline(from SCM) 잡 생성·실행, GitHub Actions와의 비교, 후속(웹훅·권한 최소화). README 인덱스 추가.

**핵심 설계**

- **같은 검사를 두 도구로** → 파이프라인 설계가 특정 CI 도구에 종속되지 않음을 입증. GitHub Actions=관리형, Jenkins=self-hosted(인프라 운영 포함).
- 스테이지별 컨테이너 에이전트로 "도구는 컨테이너가 들고 옴" 패턴 — Jenkins 컨트롤러는 Docker 접근만 필요.

**비고 / 검증 방법**

- 동일 검사 항목은 GitHub Actions CI에서 이미 green 확인됨(typecheck·test·helm·terraform·docker build). Jenkinsfile은 그 단계를 그대로 미러링.
- **실측**: 로컬 Jenkins(Docker, 소켓 공유) 기동 → Pipeline(from SCM) 빌드 → **4스테이지 전부 green(빌드 #3, SUCCESS)**. 도중 `alpine/helm`·`hashicorp/terraform`이 ENTRYPOINT가 도구라 Jenkins의 `cat`이 안 돌아 실패 → docker 에이전트에 **`--entrypoint=`** 로 해결(수정 후 통과). 소켓 직마운트·`-u root`는 로컬 데모 단순화 — 권한 최소화는 후속.
- 트리거: 로컬 Jenkins는 localhost라 GitHub webhook이 닿지 않음(즉시 자동 불가) → 자동은 Poll SCM, 또는 Build Now 수동. (관리형 GitHub Actions는 push/PR 즉시 자동 — self-hosted와의 차이)

**자료**

- `105-deploy-jenkins-pipeline-pass-20260617.png` — Jenkins Stages에서 빌드 #3가 4스테이지(typecheck+tests·helm lint·terraform validate·docker build) 전부 초록(SUCCESS). self-hosted Jenkins가 GitHub Actions와 동일 CI를 통과한 화면.

### 5. Jenkins Multibranch Pipeline 전환

**이전 상태 / 문제**

- 처음 만든 Jenkins 잡은 **브랜치 하나에 고정**된 단일 Pipeline이었다. 그래서 그 브랜치를 merge 후 삭제하면 잡이 깨지고, `*/main`으로 두면 merge된 뒤에만 빌드돼 **merge 전 검사(CI 게이트) 역할을 못 했다.** 일회용 데모에 가까웠음.

**목적**

- **실무형 CI로 격상**. Jenkinsfile 있는 모든 브랜치를 자동 발견·빌드하는 **Multibranch Pipeline**으로 바꿔, 브랜치 삭제에 안 깨지고 merge 전 브랜치도 검사하게 한다(GitHub Actions가 브랜치/PR마다 도는 것과 동일).

**한 일**

- `docs/runbooks/jenkins.md`를 Multibranch 기준으로 개정 — 잡 생성을 단일 Pipeline(from SCM) → **Multibranch Pipeline**(Git 브랜치소스 + 주기 스캔)으로, 비교표·트리거 항목 갱신.
- Jenkinsfile 자체는 변경 불필요(declarative라 Multibranch 호환). Jenkinsfile은 main에 있어 새 브랜치가 자동 상속.

**핵심 설계**

- 발견 기준 = **"Jenkinsfile 존재"** — 잡에 브랜치를 박지 않음. 브랜치 생성/삭제에 잡이 자동 따라옴.
- 로컬 Jenkins는 localhost라 webhook이 안 닿아 **주기 스캔(polling)** 으로 자동화. 즉시 트리거는 외부 노출(webhook) 후속.

**비고 / 검증 방법**

- 문서 개정 완료.
- **실측**: Jenkins UI에서 Multibranch Pipeline 잡(`devops DailyProof`) 생성 → 자동 스캔으로 **`main` 브랜치 발견**(Jenkinsfile 존재) → 빌드 #1 **SUCCESS(초록)**. 단일 잡(브랜치 고정) → 브랜치 자동 발견형으로 전환 확인.

**자료**

- `106-deploy-jenkins-multibranch-branches-20260617.png` — Multibranch 잡이 `main` 브랜치를 자동 발견(Branches 1) + 빌드 성공(초록).
- `107-deploy-jenkins-multibranch-main-build-20260617.png` — `devops DailyProof/main` 하위 잡 #1 SUCCESS(독립 빌드).

### 6. 롤백 가이드 + 배포 후 smoke 검증

**이전 상태 / 문제**

- 배포(Terraform·ArgoCD)는 붙였지만 **잘못 배포됐을 때 되돌리는 절차가 없었고**, 배포 직후 정상 여부를 **자동으로 게이트하는 단계**도 없었다. 배포 메커니즘이 둘(push/pull)이라 롤백 방법이 갈리는데 그게 어디에도 정리돼 있지 않았다.

**목적**

- **되돌리기 + 배포 후 검증을 절차로 고정**. 메커니즘별 롤백(ArgoCD/helm/이미지 태그)을 문서화하고, 배포 후 `smoke`로 통과해야 넘어가는 게이트를 둔다.

**한 일**

- `docs/runbooks/rollback.md` 신설 — ①배포 후 smoke(`SMOKE_BASE_URL=… npm run smoke`)·확인 체크리스트, ②메커니즘별 롤백: ArgoCD History and Rollback/`git revert`, Terraform·helm(이미지 태그 되돌리기·`helm rollback`), 공통 원칙(이전 태그 보존), ③후속(자동 롤백·레지스트리 버전 태그).
- `argocd.md`·`k8s-deploy.md`의 "확인" 단계에 **배포 후 smoke + 실패 시 rollback** 한 줄씩 연결. README 인덱스 추가.

**핵심 설계**

- post-deploy smoke는 **기존 `scripts/smoke.mjs` 재사용**(비-0 종료라 게이트로 적합) — 새 도구 안 만들고 배포 대상 URL만 가리켜 실행.
- 롤백의 최저 보장선 = **"직전 정상 이미지 태그로 되돌리기"**. Terraform 관리 릴리스는 helm 직접 rollback 대신 git revert→apply 우선(tfstate 정합).

**비고 / 검증 방법**

- smoke 스크립트는 이미 실측 통과(health/ready/metrics/jaeger 4체크). 본 작업은 그걸 **배포 후 게이트로 절차화 + 롤백 문서화**.
- **실제 롤백 시연 완료**: auto-sync를 잠시 끄고 web replicas 1→2로 변경 배포 → `argocd app rollback dailyproof-staging 6` **성공(Phase Succeeded, Synced to d28d25a)**. 단, replicas를 `app set -p`(파라미터)로 바꿔 rollback(=git revision 재적용)으로는 안 되돌려져, `app unset -p web.replicas`로 마무리 — "git revision 롤백 vs out-of-band 파라미터"의 차이를 학습(회고 `retrospective/cicd-gitops.md` §6).
- **정상/비정상/복구 대비 시연**: 깨진 이미지 태그(`image.web.tag=broken`)로 배포 → **새 web 파드 ImagePullBackOff(비정상)**, **옛 파드는 1/1로 계속 서비스**(롤링업데이트 + readiness 게이트로 서비스 무중단) → `app unset`으로 **복구(1/1)**. "잘못된 배포는 k8s가 막고 서비스는 안 죽는다"를 증거로 확보.

**자료**

- `108-deploy-argocd-rollback-history-20260617.png` — ArgoCD History and Rollback 패널(여러 revision + ROLLBACK). 롤백 기능 동작 화면.
- `109-deploy-staging-healthy-20260618.png` — (정상) web·worker 1/1 Running.
- `110-deploy-bad-image-imagepullbackoff-20260618.png` — (비정상) 깨진 태그 새 파드 ImagePullBackOff + 옛 파드 1/1 유지(서비스 무중단).
- `111-deploy-bad-image-events-20260618.png` — (원인) describe Events: `dailyproof-web:broken` 이미지 pull 실패(ErrImagePull).
- `112-deploy-recovered-healthy-20260618.png` — (복구) 깨진 파드 사라지고 web 1/1 정상 복귀.

## 2026-06-18

### 1. 배포 후 자동 smoke (ArgoCD PostSync hook)

**이전 상태 / 문제**

- 배포 후 smoke를 **손으로**(`npm run smoke`) 돌려야 했다. 작업명은 "자동화"였지만 실제 트리거가 없어 사람이 안 누르면 검증이 안 됐다. 배포는 ArgoCD(pull)가 하므로 자동화는 CI가 아니라 **ArgoCD에 훅**을 걸어야 한다.

**목적**

- **배포 후 검증을 진짜 자동으로**. ArgoCD가 sync할 때마다 smoke가 자동 실행되고, 실패하면 sync가 Degraded로 표시되는 게이트를 만든다.

**한 일**

- 차트에 `templates/postsync-smoke-job.yaml` 추가 — **ArgoCD PostSync hook** Job(`argocd.argoproj.io/hook: PostSync`). web Service의 `/health/ready`(재시도)·`/health/live`·`/metrics`를 클러스터 내부에서 `curl`로 점검, 실패 시 Job 실패 → sync Degraded. `hook-delete-policy: BeforeHookCreation`(다음 sync 전까지 결과 보존).
- `values.yaml`에 `postSyncSmoke`(enabled·curl 이미지 고정) 추가.

**핵심 설계**

- 수동 `smoke.mjs`(외부에서 URL 점검)와 달리, hook은 **클러스터 내부에서 Service명으로** 점검(curl 경량 이미지) — 외부 노출 불필요.
- readiness는 막 뜬 직후 잠깐 503일 수 있어 **재시도 루프**로 안정화.

**비고 / 검증 방법**

- `helm lint`·`template`(Job+hook annotation) + 실 k3s server-side dry-run(7개 리소스, postsync-smoke Job 포함) 통과.
- 실제 hook 실행(ArgoCD sync 시 Job 자동 생성·smoke 통과/실패)은 ArgoCD에서 sync 후 확인(증거 캡처). 진행 중 이슈는 회고에 정리.