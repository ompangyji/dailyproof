# Gap 분석 (현재 vs 목표 DevOps 범위)

DailyProof의 **현재 상태**(`architecture/current-state.md`)와 포트폴리오가 요구하는 **목표 DevOps 범위**(`CoverLetter/devops/Portfolio` 실행계획의 18개 항목 + 기반 인프라 요소)를 항목별로 비교한다.

이 문서의 목적은 "무엇이, 얼마나 비어 있는가"를 드러내는 것이다.
"무엇을 직접 구현하고 무엇을 문서/설계로 대체할지"의 결정은 `gap-analysis.md`의 구현/대체 구분 절에서 이어서 다룬다.

분석 기준일: 2026-06-09

---

## 1. 요약 (한눈에)

| 상태 | 의미 | 개수 |
|------|------|------|
| 🟢 있음 | 현재 코드/스키마에 이미 존재 | 일부(업로드 검증, RLS, 미디어 프록시 등) |
| 🟡 부분 | 기초는 있으나 운영 수준 미달 | 보안, 네트워크, 캐시 |
| 🔴 없음 | 처음부터 추가해야 함 | 대부분의 운영/배포/관측 항목 |

현재 DailyProof는 **애플리케이션 기능과 데이터 보안(RLS)** 측면은 🟢/🟡지만,
**비동기 처리·컨테이너·배포 자동화·관측성·운영 문서**는 거의 전부 🔴다.

---

## 2. 기반 인프라 (포트폴리오 토대)

| 영역 | 현재 상태 | 목표 | Gap | 우선순위 |
|------|-----------|------|-----|----------|
| 비동기 처리 (queue/worker) | 🔴 없음. 업로드는 동기 저장만 | DB job table + worker polling, 상태 전이 | worker 프로세스, job 모델 신설 | **높음** |
| 자산 상태 모델 | 🔴 없음 | `proof_assets`(uploaded→processing→ready→failed) | 테이블·상태머신 설계 | **높음** |
| 컨테이너화 | 🔴 없음 | Dockerfile(web/worker), docker-compose | 이미지화, 멀티 서비스 구성 | **높음** |
| 오케스트레이션 | 🔴 없음 | k3s/Kubernetes manifests 또는 Helm | Deployment/Service/Ingress/HPA | 중간 |
| GitOps | 🔴 없음 | ArgoCD app, revision rollback | manifest repo, sync 설정 | 중간 |
| IaC | 🔴 없음 | Terraform (로컬은 경계만, AWS는 [추후]) | 인프라 경계 정의 | 중간 |

---

## 3. 실행계획 18개 항목별 Gap

| # | 항목 | 현재 상태 | Gap (해야 할 일) | 우선순위 |
|---|------|-----------|------------------|----------|
| 1 | 운영 환경 분리 | 🔴 env 2개(`NEXT_PUBLIC_*`)만, dev/staging/prod 구분 없음 | 환경별 config/namespace/GitHub Environment 분리 | **높음** |
| 2 | 시크릿 관리 | 🟡 `.env.local`만. 서버 전용 시크릿·회전 절차 없음 | K8s Secret/SSM 주입, 회전 절차 문서화 | 중간 |
| 3 | 헬스체크/장애 복구 | 🔴 health 엔드포인트 없음 | `/health/live`·`/ready`, graceful shutdown, probe | **높음** |
| 4 | 로그 구조화 | 🔴 구조화 로그 없음 | JSON 로그 + request_id/trace_id/user_id/asset_id/job_id | **높음** |
| 5 | 메트릭 | 🔴 없음 | `/metrics`(Prometheus), upload/job/queue/latency 지표 | **높음** |
| 6 | 트레이싱 | 🔴 없음 | OpenTelemetry, web→worker→DB span 전파 | 중간 |
| 7 | 배포 전략 | 🔴 (추정 Vercel 수동) | GitHub Actions build/test/deploy, staging→smoke→prod, rollback | **높음** |
| 8 | 테스트 자동화 | 🔴 테스트 코드 없음(lint만) | smoke/health/E2E, 배포 후 검증 | 중간 |
| 9 | 인프라 문서화 | 🟡 current-state.md만 시작 | architecture/deployment/runbook + Mermaid | 중간 |
| 10 | 보안 기본기 | 🟡 업로드 MIME/크기/확장자·RLS 있음. rate limiting·콘텐츠 타입 재검증 없음 | rate limit, content-type 재검증, 권한 경계 점검 | 중간 |
| 11 | 비용 관점 | 🔴 없음 | 스토리지/로그/트래픽/메트릭 절감 전략 문서 | 낮음 |
| 12 | 백업/복구 | 🔴 없음 | DB 백업, 스토리지 유실 대응, RPO/RTO, 복구 절차 | 낮음 |
| 13 | 확장성 포인트 | 🔴 문서화 안 됨 | 병목 식별, web/worker/storage/queue 확장 순서 | 낮음 |
| 14 | 운영 관리자 기능 | 🔴 없음 | 실패/stuck job 조회·재처리, orphan 파일 점검 | 중간 |
| 15 | 성능 테스트/병목 | 🔴 없음 | k6/autocannon, p50/p95·RPS·error rate, 개선 전후 비교 | 중간 |
| 16 | 네트워크/HTTP·HTTPS | 🟡 미들웨어·캐시·CORS 일부 존재, TLS/timeout/body size 미명시 | 요청 경로·TLS 종료·timeout·keep-alive·rate limit 문서 + ingress 설정 | 중간 |
| 17 | 장애 재현/트러블슈팅 | 🔴 없음 | 3건+ 장애 의도 재현, 로그/메트릭/trace로 추적, runbook 연결 | 중간 |
| 18 | [추후 AWS] 이전 계획 | 🔴 없음 | EKS+ArgoCD 기준 서비스 매핑·이전 순서 문서 | 낮음(문서) |

---

## 4. 현재 강점이 Gap을 줄여주는 지점

전부 0에서 시작하는 것은 아니다. 아래는 이미 있어서 **다음 작업의 토대가 되는** 부분이다.

- **보안(10) / 네트워크(16)**: 업로드 입력 검증, RLS owner-only, 비공개 미디어 프록시, 토큰 임베드(SECURITY DEFINER) → rate limit·문서화만 보강하면 됨.
- **시크릿(2)**: 이미 env 분리·`.gitignore` 처리가 되어 있어 주입 방식만 확장.
- **상태 모델(자산)**: 기존 `image_urls[]` 구조에서 `proof_assets`로 확장하는 형태라 데이터 모델 연속성이 있음.
- **멱등 스키마**: additive migration 패턴이라 마이그레이션 자동화에 유리.

---

## 5. 우선순위 종합

**높음 (핵심 시나리오 — 업로드→worker→관측 흐름을 살리는 데 필수)**

- 비동기 처리(worker/queue), 자산 상태 모델, 컨테이너화
- 환경 분리, 헬스체크, 구조화 로그, 메트릭, 배포 자동화

**중간 (운영 완성도)**

- 트레이싱, 테스트 자동화, 시크릿 주입, 보안 보강, 관리자 기능
- 성능 테스트, 네트워크 문서, 장애 재현, K8s/ArgoCD/IaC

**낮음 (주로 문서/설계로 마무리)**

- 비용, 백업/복구, 확장성, [추후 AWS] 이전 계획

---

## 6. 직접 구현 vs 문서/설계 대체

### 6.1 판정 기준

"문서/설계로 대체"는 **시간 부족이 아니라 환경 제약**일 때만 인정한다(실행계획 2.5). 즉 아래에 해당할 때만 구현을 생략하고 문서로 남긴다.

- 외부 계정·권한·조직 정책이 없어 실제 구축이 불가능
- 로컬 장비 성능·네트워크 제약으로 시연이 불가능
- 유료 인프라 비용 문제로 현재 환경에서 배포가 어려움
- 보안상 실제 자격증명·외부 인프라 연결을 노출할 수 없음

분류 표기:

- ✅ **직접 구현** — 2주 내 실제로 동작하게 만들고 증거(코드/스샷/로그)를 남김
- 🔶 **혼합** — 핵심은 실제 구현, 환경 제약 부분만 문서/설계로 보완
- 📝 **문서/설계 대체** — 환경 제약으로 구현 생략, 설계·근거 문서로 남김

### 6.2 분류 표

| 항목 | 분류 | 근거 |
|------|------|------|
| 비동기 처리(worker/queue) | ✅ 직접 | DB job table + worker polling으로 외부 브로커 없이 로컬 구현 가능 |
| 자산 상태 모델(`proof_assets`) | ✅ 직접 | 기존 스키마 확장. 제약 없음 |
| 컨테이너화(Docker/compose) | ✅ 직접 | web/worker 분리, 로컬에서 완전 구현 |
| 오케스트레이션(**k3s**) | ✅ 직접 | 아래 6.3 결정 근거 참고 |
| GitOps(**ArgoCD**) | ✅ 직접 | k3s 위에 설치, sync·revision rollback까지 실제 시연 |
| IaC(**Terraform**) | 🔶 혼합 | 로컬 대상(docker provider/k3s 리소스)은 실제 apply, AWS 인프라는 [추후] 문서 매핑 |
| 1. 운영 환경 분리 | ✅ 직접 | config/namespace/GitHub Environment로 dev/staging/prod 분리 |
| 2. 시크릿 관리 | 🔶 혼합 | K8s Secret/주입은 실제 구현, 회전 자동화는 절차 문서로 대체 |
| 3. 헬스체크/장애 복구 | ✅ 직접 | `/health/live`·`/ready`, graceful shutdown, probe 구현 |
| 4. 로그 구조화 | ✅ 직접 | JSON logger + correlation id 구현 |
| 5. 메트릭 | ✅ 직접 | `/metrics` + Prometheus + Grafana 로컬 구동 |
| 6. 트레이싱 | ✅ 직접 | OpenTelemetry web→worker→DB span 전파 |
| 7. 배포 전략 | 🔶 혼합 | staging→smoke→prod·rollback은 실제 구현, canary/blue-green은 문서 |
| 8. 테스트 자동화 | ✅ 직접 | smoke/health/E2E + 배포 후 검증 |
| 9. 인프라 문서화 | ✅ 직접 | 문서 자체가 산출물(architecture/deployment/runbook + Mermaid) |
| 10. 보안 기본기 | ✅ 직접 | rate limit·content-type 재검증·권한 경계 점검 추가 |
| 11. 비용 관점 | 📝 문서 | 실제 청구서 없음 → 예상 비용 구조·절감 전략 문서 |
| 12. 백업/복구 | 🔶 혼합 | export/restore 1회 실제 수행 + RPO/RTO·DR은 문서 |
| 13. 확장성 포인트 | 📝 문서 | 대규모 부하 환경 부재 → 병목 식별·확장 순서 문서 |
| 14. 운영 관리자 기능 | ✅ 직접 | 실패/stuck job 조회·재처리, orphan 점검 페이지 |
| 15. 성능 테스트/병목 | ✅ 직접 | k6/autocannon으로 로컬 측정, 개선 전후 비교 |
| 16. 네트워크/HTTP·HTTPS | 🔶 혼합 | ingress·TLS 설정은 실제 구현, 정책(timeout/keep-alive/body size)은 문서 명시 |
| 17. 장애 재현/트러블슈팅 | ✅ 직접 | 3건+ 의도 재현, 로그/메트릭/trace로 추적 |
| 18. [추후 AWS] 이전 계획 | 📝 문서 | 비용·계정 제약으로 AWS 직접 배포 제외 → EKS+ArgoCD 이전 설계 문서 |

종합: **✅ 직접 12, 🔶 혼합 5, 📝 문서 3** — 대부분 실제 구현하고, 문서 대체는 환경 제약(비용/계정/대규모 부하)이 명확한 3개로 한정한다.

### 6.3 인프라 도구 결정 근거

- **k3s (오케스트레이션)**: "쿠버네티스 vs k3s"가 아니라 k3s는 **CNCF 인증 정식 쿠버네티스의 경량 배포판**이다. `kubectl`/manifest/Helm/ArgoCD가 동일하게 동작하고 EKS로의 이전성도 유지된다. 이번은 **로컬 단일 머신·2주**라는 환경 제약이 있어, 쿠버네티스 운영 역량을 보여주되 클러스터를 띄우는 **비용·리소스 부담을 최소화**하기 위해 단일 바이너리·저메모리·ingress/storage 내장인 k3s를 택했다. (대안: kind/k3d/minikube/풀 kubeadm)
- **ArgoCD (GitOps)**: k3s를 직접 구축하므로 그 위에 얹어 manifest sync와 revision rollback까지 실제 시연한다. 배포 이력·롤백을 증거로 남길 수 있다.
- **Terraform (IaC)**: AWS는 [추후]로 제외되어 클라우드 apply 대상이 없으므로, **로컬·무료 대상(docker provider, k3s 리소스)에 한해 실제 apply**해 IaC 동작을 증명하고, AWS 인프라는 목표 매핑을 문서로 남기는 혼합 방식으로 간다.

---

## 7. 다음 작업

- `architecture/target-architecture.md` — 높음 우선순위(✅ 직접 항목)를 묶는 목표 구조와 핵심 시나리오
- `proof_assets`/job 모델 DB 스키마 초안
