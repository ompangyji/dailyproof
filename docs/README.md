# DailyProof 운영 확장 문서

이 디렉토리는 DailyProof를 운영형 서비스로 확장하는 과정의 **모든 산출물의 source of truth**다.

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
| `backup-` | 백업·recovery drill(pg_dump·복원·행수 검증) |

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
- [x] `runbooks/backup-recovery.md` — 백업·복구(상태 구분·DB/스토리지 전략·RPO/RTO·복구 시나리오 + pg_dump→복원→행수 일치 drill 실측)
- [x] `runbooks/secret-management.md` — 시크릿 관리(sealed-secrets로 암호화해 git 커밋·컨트롤러만 복호화, 봉인·적용·복구·회전 절차, sealed vs external 비교, 봉인키 백업 주의)
- [x] `retrospective/cicd-gitops.md` — CI/CD·GitOps 트러블슈팅 회고(증상·원인·해결·교훈)
- [x] `retrospective/wsl-drvfs.md` — WSL/drvfs 환경 제약 회고(chmod·CRLF·EPERM 빌드·pathspec)
- [x] `retrospective/async-pipeline.md` — 비동기 파이프라인 회고(유령 job·잘린 키·지연 폭발·trace_id null)
- [x] `retrospective/notion-sync.md` — Notion sync 회고(거대 문서 타임아웃·병렬 삭제·재시도)
- [x] `retrospective/test-layers.md` — 테스트 계층 회고(유닛·health·smoke·E2E가 각각 보는 것, E2E를 왜·어디에)
- [x] `retrospective/metrics-load.md` — /metrics 부하 ~10초 행 회고(3-way 진단: 쿼리·REST·pod 경로 격리, 캐시·fail-fast·stale, 환경성 결론)
- [x] `retrospective/security-scanning.md` — 보안 스캐닝 도입 전 이해 회고(도구가 규칙을 아는 출처: CVE DB / 정책 코드룰 / SAST 패턴)
- [x] `retrospective/backup-drill.md` — 첫 recovery drill 회고(IPv6 연결 막힘→pooler, 에러 화면≠실패: >/dev/null·ON_ERROR_STOP 이해, 복원=SQL replay, 관리형 객체와 데이터 분리)
- [x] `retrospective/input-validation.md` — API 입력 검증·신뢰 경계 회고(클라 검증은 UX·서버가 게이트, 타입≠검증, source_path 무검증→worker service_role 우회 IDOR, manual vs zod, 403/400 분리)
- [x] `retrospective/hsts-preload.md` — HSTS와 preload 회고(일반 HSTS는 헤더로 끄지만 preload는 브라우저 내장 목록이라 되돌리기 수주~수개월, 통제권이 내 손/벤더 목록인지 구분)
- [x] `retrospective/csp-not-secret.md` — CSP는 숨김이 아니라 강제(케르크호프스: nonce는 난수라 알아도 못 뚫음). 단 기술스택 헤더(X-Powered-By)는 정보 위생으로 별도 제거
- [x] `retrospective/dev-vs-k8s-environments.md` — docker-compose(개발) vs k8s/helm(운영) 차이, jaeger가 helm엔 자리표시자였던 이유, 한 서버에서 둘 다 돌려도 jaeger는 네트워크 격리로 안 섞임(서비스 이름은 경계 안에서만 유효)
- [x] `retrospective/kubectl-helm-commands.md` — 자주 쓰는 kubectl·helm 명령 치트시트(조회·배포·디버깅·port-forward + 보안 주의)
- [x] `retrospective/k8s-service-access.md` — k8s 접근 개념(ClusterIP는 내부 전용→port-forward 터널, LoadBalancer는 외부, worker는 Service 없어 접속 대상 아님·로그로 관찰)
- [x] `retrospective/wsl-node-exporter-mount.md` — WSL2에서 node-exporter CreateContainerError(루트가 private mount) → `mount --make-rshared /`로 해결, 영속성 주의·비활성화 대안
- [x] `retrospective/stale-image-metrics.md` — Prometheus Target은 UP인데 보안 메트릭이 없던 건(배포 이미지가 계측 코드 이전). "git 머지≠클러스터 실행", 내부 curl로 /metrics 직접 확인·이미지 재빌드·k3s import 절차
- [x] `retrospective/imperative-vs-helm-image.md` — helm upgrade가 kubectl set image로 바꾼 이미지를 되돌린 건(명령형 vs 선언형 충돌). API 직접 질의로 진단, 영속은 차트 값/git에 반영해야
- [x] `retrospective/observability-stack-roles.md` — Prometheus(수집·룰)/Alertmanager(알림 배달)/Grafana(시각화) 역할 구분, "같은 데이터 다른 화면", pending→firing→Alertmanager 흐름
- [x] `retrospective/gitops-drift-reconcile.md` — kubectl set image 드리프트 해소(git 아는 태그에 실제 코드 담기), pod 죽음→k8s/클러스터 재구성→helm·git, "태그는 포인터"
- [x] `retrospective/policy-as-code-methodology.md` — 보안 정책 정립 방법론(위협모델·컴플라이언스·업계표준 3근거 → Audit→Enforce 점진 적용), 예방(trivy)·강제(Kyverno)·탐지(Prometheus) 계층
- [x] `security/findings-triage.md` — 스캐너 findings 28건 triage(real/FP·fix/suppress 판정·근거·사유 기록)
- [x] `security/rate-limit.md` — rate limit 대상 선정 분석(노출도·악용·비용·기존방어 기준 → 엔드포인트 평가 → grass IP·proof-assets uid 결정, in-memory 한계·edge/Redis 후속)
- [x] `security/public-url-exposure.md` — 공개 URL 오남용 점검(접근게이트·추측·노출범위·검증일치·소비통제 기준 → media/grass 평가·판정 → grass 토큰 검증 24 hex 하드닝)
- [x] `security/checklist.md` — 보안 기본기(4.10) 체크리스트(MIME·크기·경로·권한경계·입력검증·rate limit·공개URL·스캐닝·런타임하드닝을 어느 층에서 막나 + 잔여 위험)
- [x] `security/threat-model.md` — 위협 모델(STRIDE): 신뢰 경계·자산·진입점·행위자 + S/T/R/I/D/E별 위협×완화책×잔여위험·위험등급, 가정·범위밖
- [x] `security/admission-control.md` — Kyverno 정책 강제(non-root·ro-rootfs·drop ALL·latest 금지), 예방(trivy)·강제(admission)·탐지 계층, Audit→Enforce·scope 예외, 위반 거부 실측
- [x] `security/security-headers-plan.md` — Security headers 도입 계획(6헤더 값·CSP 디렉티브 충돌원 설계·nonce 방식·report-only→enforce 단계·롤백·검증)
- [x] `security/cookie-csrf.md` — 쿠키·CSRF 점검(탈취/CSRF/인가/Origin/메서드 기준 → Supabase 쿠키·server action·signout 평가·판정 → serverActions.allowedOrigins 하드닝)
- [x] `../SECURITY.md` (repo 루트) — 취약점 신고 정책(지원 범위·신고 채널·공개 절차)
- [x] `incidents/incident-log.md` — 장애 등록부(실제 겪은 장애 5건 통일 포맷 요약·색인: 빈 build-arg readiness 503·ImagePullBackOff·/metrics 부하 행·CI 플레이크·PostSync hook 막힘. 상세는 회고·runbook으로 링크아웃)
- [x] `performance/performance.md` — 성능 베이스라인(k6, 조회+DB vs 순수앱 대비·threshold·병목 가설)
