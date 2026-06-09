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
