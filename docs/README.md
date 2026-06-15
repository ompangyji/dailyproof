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
- [x] `architecture/target-architecture.md` — 목표 아키텍처 + 핵심 시나리오
- [x] `architecture/environments.md` — dev/staging/prod 환경 분리 전략
- [x] `architecture/branching.md` — 브랜치 전략(GitHub Flow + 환경 승격)
- [x] `plan/notion-sync.md` — docs→Notion 동기화 설계 (구현: `scripts/notion-sync.mjs` + `.github/workflows/notion-sync.yml`)
- [x] `runbooks/runbook.md` — 운영 절차(health/probe·재시작·롤백·stuck/failed job·흔한 incident)
- [ ] `incidents/incident-log.md` — 장애 재현 기록
- [ ] `performance/performance.md` — 성능 테스트 결과
