# DailyProof DevOps 포트폴리오 문서

이 디렉토리는 DailyProof를 운영형 서비스 / DevOps 포트폴리오로 확장하는 과정의 **모든 산출물의 source of truth**다.

- 운영 문서, 아키텍처 다이어그램, 스크린샷, 테스트 결과, 배포 설정의 원본은 이 repo 안 `docs/`에 둔다.
- Notion은 문서 작성 원본이 아니라 공유/정리 채널로만 사용한다.
- `git push`를 기준으로 GitHub Actions가 `docs/**` 변경분을 Notion에 동기화하는 구조를 목표로 한다.
- 실행 계획 원본: `D:\dev\CoverLetter\devops\Portfolio` (기획서 + 2주 전범위 실행계획)

## 디렉토리 구조

| 경로 | 용도 |
|------|------|
| `docs/worklog.md` | 날짜별 작업 진행 기록 (전 영역 가로지름) |
| `docs/plan/` | gap 분석, 로드맵 등 계획 문서 |
| `docs/architecture/` | 현재/목표 아키텍처, 데이터 흐름, 환경 분리 전략 |
| `docs/runbooks/` | 운영 절차, 헬스체크/복구, 롤백 가이드 |
| `docs/incidents/` | 장애 재현 기록, incident report |
| `docs/retrospective/` | 트러블슈팅 회고 (막힌 지점·원인·해결·교훈) |
| `docs/performance/` | 부하 테스트 결과, 병목 분석 |
| `docs/screenshots/` | 대시보드/trace 캡처 등 증거 자료 (로컬 보관용, **git 미추적** — `.gitignore` 처리) |

## 스크린샷 명명 규칙

스크린샷은 `docs/screenshots/`에 두며 git에는 올리지 않는다(로컬 보관). 단, 운영 문서에서 상대경로로 참조하므로 파일명만으로 무슨 증거인지 알 수 있어야 한다.

형식:

```
<NNN>-<영역>-<대상>-<YYYYMMDD>.png
```

규칙:

- 맨 앞 `NNN` = **작업 전체 진행 순서**(전역 일련번호) `001`, `002`, `003`…. 유형과 무관하게 찍은 순서대로 1씩 증가. 파일명 정렬 = 작업한 순서.
- 3자리 고정(정렬 안정성, 999장까지). 부족하면 4자리로 확장.
- `<영역>`은 순서가 아니라 **분류 태그**로만 둔다(아래 prefix 표).
- 소문자 + 하이픈(kebab-case). 공백·한글 파일명 금지.
- 날짜는 끝에 `YYYYMMDD` (참고·재현 시점용).
- 비교용은 상태 자리에 `-before` / `-after` 사용.

이렇게 하면 디렉토리를 이름순 정렬했을 때 내가 실제로 작업한 순서대로 스샷이 나열된다.

영역(prefix):

| prefix | 용도 |
|--------|------|
| `app-` | DailyProof 앱 화면(업로드/기록 등) |
| `docs-` | docs 디렉토리/문서 구조 등 산출물 화면 |
| `obs-` | Grafana/Prometheus/Loki 대시보드 |
| `trace-` | OpenTelemetry trace 화면 |
| `deploy-` | ArgoCD sync / GitHub Actions / 롤백 |
| `git-` | git/PR/merge 워크플로 (브랜치·PR 화면, 로컬 동기화) |
| `sec-` | 보안/검증 (검증 제약·버킷 정책·거부 동작 등) |
| `test-` | 자동 테스트 결과 (node:test 등) |
| `incident-` | 장애 재현·탐지 화면 |
| `perf-` | k6/autocannon 성능 결과 |
| `admin-` | admin ops 페이지 |
| `backup-` | 백업·복구 드릴(pg_dump·복원·행수 검증) |

예시 (정렬 = 작업한 순서):

```
001-docs-directory-structure-20260609.png
002-app-upload-form-20260609.png
003-app-upload-success-20260609.png
004-obs-grafana-upload-dashboard-20260610.png
005-incident-readiness-detect-20260612.png
006-perf-upload-k6-p95-before-20260611.png
007-perf-upload-k6-p95-after-20260613.png
```

문서에서 참조:

```markdown
![업로드 폼](../screenshots/002-app-upload-form-20260609.png)
```

## 주요 문서 인덱스 (작성 예정)

- [x] `worklog.md` — 날짜별 작업 진행 기록
- [x] `plan/gap-analysis.md` — 현재 구현 vs 목표 DevOps 범위 gap + 직접 구현/문서 대체 구분
- [x] `architecture/current-state.md` — 현재 프로젝트 구조 분석
- [x] `architecture/erd-before.md` — DB ERD (proof_assets/jobs 통합 전)
- [x] `architecture/erd-after.md` — DB ERD (proof_assets/jobs 추가 후)
- [x] `architecture/worker.md` — 후처리 worker 상태 전이·운영(폴링·재시도·error_code)
- [x] `architecture/logging.md` — 로그 포맷·이벤트별 예시·필드 사전·질의/상관
- [x] `architecture/metrics.md` — 메트릭 사전·PromQL 질의·알림 후보·scrape/Grafana 후속
- [x] `architecture/tracing.md` — 분산 트레이싱(OTel)·비동기 경계 전파·trace_id와의 관계
- [x] `architecture/network.md` — 트래픽 흐름(Ingress)·HTTP/HTTPS·body size·timeout 정책
- [x] `architecture/target-architecture.md` — 목표 아키텍처 + 핵심 시나리오
- [x] `architecture/scaling.md` — 확장성(병목 컴포넌트 식별·확장 순서: web HPA→worker 큐깊이 HPA→DB 완화→큐 분리, 실측 근거)
- [x] `architecture/cost.md` — 비용 관점(스토리지·로그·egress·메트릭 4드라이버 절감 전략 + 보존주기·샘플링·thumbnail 정책. 기존 레버 재정리 + 정책 선언)
- [x] `architecture/environments.md` — dev/staging/prod 환경 분리 전략
- [x] `architecture/branching.md` — 브랜치 전략(GitHub Flow + 환경 승격)
- [x] `plan/notion-sync.md` — docs→Notion 동기화 설계 (구현: `scripts/notion-sync.mjs` + `.github/workflows/notion-sync.yml`)
- [x] `runbooks/runbook.md` — 운영 절차(health/probe·재시작·롤백·stuck/failed job·흔한 incident)
- [x] `runbooks/local-stack.md` — docker-compose 로컬 스택 구동·smoke test·트러블슈팅
- [x] `runbooks/k8s-deploy.md` — Helm 차트 구조·env별 values·시크릿 주입·렌더/검증/적용
- [x] `runbooks/argocd.md` — ArgoCD GitOps(pull) 설치·repo 크리덴셜·Application 동기화·UI
- [x] `runbooks/jenkins.md` — self-hosted Jenkins 파이프라인(Jenkinsfile, GitHub Actions와 동일 검사)
- [x] `runbooks/rollback.md` — 롤백(ArgoCD/helm/이미지태그) + 배포 후 smoke 검증·체크리스트
- [x] `runbooks/backup-recovery.md` — 백업·복구(상태 구분·DB/스토리지 전략·RPO/RTO·복구 시나리오 + pg_dump→복원→행수 일치 드릴 실측)
- [x] `retrospective/cicd-gitops.md` — CI/CD·GitOps 트러블슈팅 회고(증상·원인·해결·교훈)
- [x] `retrospective/wsl-drvfs.md` — WSL/drvfs 환경 제약 회고(chmod·CRLF·EPERM 빌드·pathspec)
- [x] `retrospective/async-pipeline.md` — 비동기 파이프라인 회고(유령 job·잘린 키·지연 폭발·trace_id null)
- [x] `retrospective/notion-sync.md` — Notion sync 회고(거대 문서 타임아웃·병렬 삭제·재시도)
- [x] `retrospective/test-layers.md` — 테스트 계층 회고(유닛·health·smoke·E2E가 각각 보는 것, E2E를 왜·어디에)
- [x] `retrospective/metrics-load.md` — /metrics 부하 ~10초 행 회고(3-way 진단: 쿼리·REST·pod 경로 격리, 캐시·fail-fast·stale, 환경성 결론)
- [x] `retrospective/security-scanning.md` — 보안 스캐닝 도입 전 이해 회고(도구가 규칙을 아는 출처: CVE DB / 정책 코드룰 / SAST 패턴)
- [x] `security/findings-triage.md` — 스캐너 findings 28건 triage(real/FP·fix/suppress 판정·근거·사유 기록)
- [x] `incidents/incident-log.md` — 장애 등록부(실제 겪은 장애 5건 통일 포맷 요약·색인: 빈 build-arg readiness 503·ImagePullBackOff·/metrics 부하 행·CI 플레이크·PostSync hook 막힘. 상세는 회고·runbook으로 링크아웃)
- [x] `performance/performance.md` — 성능 베이스라인(k6, 조회+DB vs 순수앱 대비·threshold·병목 가설)
