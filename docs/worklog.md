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

- *파일 업로드 기반이 이미 있다.* 업로드(`lib/supabase/upload.ts`)에 MIME 검사(`image/*`), 8MB 크기 제한, 확장자 sanitize가 들어가 있고, 저장 경로가 `media/<userId>/<kind>/<uuid>.<ext>`로 사용자별 격리된다. → 파일 저장소 정책·인증 접근 제어·업로드 실패 처리·크기 제한·캐시 정책·후처리 같은 운영 실습으로 자연스럽게 확장 가능.
- *인증된 접근 제어가 구현돼 있다.* 비공개 `media` 버킷을 `/api/media` 프록시가 사용자 세션으로 download → Storage RLS(`media: read own`)가 게이트. 비소유자/익명은 404. 서명 URL 만료가 없어 Tiptap 본문에서도 안정적.
- *공개/비공개 표면이 분리돼 있다.* 외부 임베드(`/api/grass/[token]`)는 추측 불가능한 토큰 + `get_grass` SECURITY DEFINER 함수로 **일자별 카운트만** 노출(원본 행 비노출), CORS·캐시(`s-maxage`, `swr`) 정책까지 표면별로 구분돼 있다.
- *운영 포인트가 명확하다.* 업로드 성공률, 업로드 후 처리 지연, DB 응답 시간, 사용자별 권한 문제, 미디어 프록시 응답 성능, 재배포 시 세션/환경변수/스토리지 연동 문제 등 실제 운영에서 측정·관측할 지점이 이미 코드 상에 존재한다.
- *멱등·안전 재실행 가능한 스키마.* `schema.sql`이 `if not exists` + additive migration + `updated_at` 트리거 + GIN/복합 인덱스를 갖춰 운영 변경에 견딘다.

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
