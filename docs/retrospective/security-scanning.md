# 회고 — 보안 스캐닝을 CI에 도입하기 전에: "도구는 규칙을 어떻게 아는가"

채용공고의 "ISMS-P/ISO 27001/SOC 2/PCI 기술 통제 구현 경험"은 인증 취득이 아니라 **그 인증이 요구하는 기술 통제를 인프라/파이프라인으로 구현·자동화·검증해봤냐**를 묻는다. 이를 CI 보안 스캐닝으로 채우기로 했는데, 그 전에 "스캐너가 대체 어떤 규칙으로, 그 규칙은 어디서 와서 검사하는가"를 이해하고 넘어갔다.

## 자료를 보는 목적 vs 실제 수행은 분리된다

- **표준 자료(CIS Controls/Benchmark, NIST, OWASP, ISMS-P 안내서) = "무엇을·왜"**: 어떤 통제가 중요한지 이해하고, 우리 구현을 그 통제번호에 **매핑(증거화)** 하는 데 쓴다.
- **실제 수행(enforcement) = 도구가 자동으로**: 규칙은 이미 스캐너 쪽에 마련돼 있어, 사람이 일일이 점검하지 않는다.
- 주의: 벤더 요약 페이지(예: 특정 벤더가 자사 제품을 CIS에 매핑한 글)는 개요용일 뿐, **인용·매핑 근거는 1차 출처**(CIS는 cisecurity.org, 무료 다운로드)로 한다.

## 그런데 "도구는 그 규칙을 어떻게 아는가" — 출처가 셋으로 갈린다

### (A) 취약점(CVE) 스캐너 — 규칙을 박는 게 아니라 공개 DB를 조회
`trivy image/fs`, `npm audit`, Dependabot, Grype 등. "룰"의 정체 = **"패키지 X가 Y 버전 미만이면 CVE-Z에 취약"**. 데이터 흐름:

1. 취약점 발견 → **MITRE**가 **CVE 번호** 발급.
2. **NVD(NIST)** 가 **CVSS 점수·영향 패키지(CPE)** 를 붙여 정규화.
3. 생태계별 피드가 정밀화: **GHSA(GitHub Advisory DB, npm/pip 등 — Dependabot·npm audit이 사용)**, **OSV(Google)**, 배포판 트래커(**Alpine secdb, Debian, Red Hat OVAL**).
4. 도구 메인테이너가 이 피드들을 **vuln DB로 컴파일·배포**(trivy는 OCI 이미지 `trivy-db`), 스캔 시 **최신 DB를 내려받아 대조**.

→ 어제 없던 CVE가 오늘 잡히는 건 룰 수정이 아니라 **DB 갱신** 때문.

### (B) 설정/정책 스캐너 — 사람이 표준을 읽고 룰을 코드로 작성
`trivy config`, **Checkov**, **tfsec**, **kube-bench**, OPA/Conftest 등. 여기선 **메인테이너+커뮤니티가 CIS/NIST 문서를 읽고 체크를 코드로 직접 작성**하고 통제ID를 태깅한다.

- **kube-bench** = **CIS Kubernetes Benchmark를 그대로 코드로 전사**("이 명령 실행 → 이 값이면 통과", 항목마다 `CIS 5.2.6` 식 태그).
- 표현 수단: trivy/Conftest는 **Rego(OPA)**, Checkov는 Python/YAML.
- **오픈소스라 PR로 최신화** — CIS가 새 벤치마크 내면 커뮤니티가 반영.

→ "도구가 어떻게 아냐"의 답이 여기선 **"사람이 표준 문서를 읽고 룰로 인코딩해 넣었다"**. 단, 메인테이너가 한 번 해두면 모두가 재사용한다.

### (C) SAST(소스 코드) — 취약 "패턴"을 쿼리로 인코딩
**CodeQL**(GitHub), **Semgrep**. 보안 연구자가 알려진 취약 패턴(예: 사용자 입력이 검증 없이 SQL로 흘러감 = SQL injection)을 쿼리/패턴으로 작성. 분류 체계는 **CWE**·OWASP. CodeQL은 `QL`, Semgrep은 YAML 패턴.

## 한 줄 정리

| 부류 | "지식"의 출처 | 갱신 방식 |
|---|---|---|
| CVE 스캐너 | 공개 취약점 DB(MITRE→NVD→GHSA/OSV/distro) | DB 자동 갱신 |
| 설정/정책 | 사람이 CIS/NIST 읽고 룰 코드 작성(통제ID 태깅) | 오픈소스 PR |
| SAST | 연구자가 취약 패턴(CWE)을 쿼리로 | 룰팩 업데이트 |

## 그래서 우리 도입 방향

- CI에 **gitleaks(시크릿)·trivy(CVE+IaC 오설정+이미지)·CodeQL(SAST)·Dependabot(의존성)** 을 붙이면, (A) 전 세계 취약점 DB, (B) CIS 벤치마크를 코드화한 룰, (C) OWASP/CWE 패턴을 **매 PR마다 자동 적용**받는다. 표준을 다 읽어 룰을 짤 필요 없이 **정제된 집단지성을 끌어다 쓰는** 셈.
- 결과는 **SARIF로 GitHub Security 탭**에 모으고, 게이트는 **soft(경보)로 베이스라인 → hard(fail) 전환**(처음부터 hard면 기존 취약점에 막힘).
- 도구 출력에 통제ID가 붙으니, 그게 `docs/security/controls-mapping.md`(통제↔구현↔검증)의 근거가 된다.

## 도구 범위는 어떻게 정했나 — 계층과 우리 선택

도구는 카테고리별로 많다. "다 하기"가 아니라 환경·목적에 맞는 지점을 골랐다.

| 단계 | 도구 | 커버 |
|---|---|---|
| **진짜 최소** | trivy 하나 | CVE + IaC 오설정 + 시크릿 (한 도구로 3영역) |
| **권장 베이스라인(우리 선택)** | + gitleaks + Dependabot + CodeQL | 시크릿 히스토리 + 의존성 자동 업데이트 + 소스 SAST |
| **표준+** | + syft/SBOM · cosign(이미지 서명) · kube-bench(런타임 CIS) | 공급망 |
| **포괄(엔터프라이즈)** | + OWASP ZAP(DAST) · OPA/Kyverno(정책 강제) · Falco(런타임 위협탐지) | 실행 중 보안 |

→ trivy 단독이 진짜 최소, 우리는 거기에 시크릿 히스토리·의존성·SAST를 더한 **흔한 CI 보안 기본 세트 + SBOM**. (실측 근거: 첫 trivy 스캔에서 CVE 0, IaC 오설정 KSV-0014 ×3, 로컬 시크릿 1건 — `docs/security/scans/`.)

## 나머지 카테고리를 지금 안 하는 이유

필요 없어서가 아니라, **이 환경에서 지금 하면 ROI가 낮은 구체적 이유**가 있다.

| 카테고리(도구) | 왜 지금 보류 | 판정 |
|---|---|---|
| DAST (OWASP ZAP) | 떠 있는 앱을 HTTP로 공격 테스트 → 우리 앱은 로그인 벽 + 시드 데이터 없음, 로컬 k3s/WSL 네트워크 불안정 | 안정적 호스팅 생기면 |
| 이미지 서명 (cosign) | 서명은 **검증하는 쪽**(레지스트리+admission controller)이 있어야 의미. k3s는 로컬 import라 검증 루프 없음 | 레지스트리 도입 시 |
| 런타임 CIS (kube-bench) | 클러스터(control plane·kubelet)를 감사 → k3s 번들 구조라 대부분 우리가 못 바꾸는 내부. 매니페스트 CIS는 trivy config가 이미 봄 | trivy로 충분 |
| 정책 강제 (OPA/Kyverno) | 같은 체크를 trivy config가 CI에서 미리 함(shift-left). 런타임 강제는 클러스터 컴포넌트 추가가 필요한 다음 레벨 | 스트레치 |
| 런타임 위협탐지 (Falco) | 실행 중 컨테이너 악성행위 탐지(syscall) = 운영/SOC 도구. 실트래픽 없는 포트폴리오엔 과함 | 이름만 |

**원리 둘:**
1. **shift-left 먼저** — "배포 전(CI)에 잡는" 계층(SCA·SAST·시크릿·IaC)을 먼저 완성. DAST·kube-bench·Falco·OPA는 "실행 중/런타임" 계층이라 **안정적 클러스터·트래픽·레지스트리가 전제** — 로컬 k3s/WSL에선 그 전제가 약하다.
2. **반쪽 여러 개보다, 몇 개를 제대로 + 나머지는 "왜 안 하는지 설명할 줄 아는 것"** 이 더 강하다. "Falco 돌렸다(껍데기)"보다 "런타임 탐지는 SOC 영역이라 이 단계엔 shift-left에 집중했다"가 신뢰감을 준다.

## 참고 — 영역·검색 키워드

각 카테고리에 도구가 매핑된다. 카테고리 키워드로 검색하면 "어떤 영역이 있고 도구가 뭔지"가 한눈에 잡힌다.

- **SCA**(software composition analysis) — 의존성 CVE: trivy, grype, dependabot
- **SAST**(static application security testing) — 소스 코드: CodeQL, semgrep
- **DAST**(dynamic ...) — 실행 중 앱: OWASP ZAP
- **secret scanning** — gitleaks, trufflehog
- **IaC security scanning** — trivy config, checkov, tfsec, kics
- **container image scanning** — trivy, grype
- **SBOM**(software bill of materials) · **SLSA**(supply chain) — syft, trivy
- **Kubernetes CIS benchmark** — kube-bench · **policy as code** — OPA, Kyverno
- 큰 그림/성숙도: `DevSecOps pipeline`, `shift-left security`, `OWASP DSOMM`, `NIST SSDF`

## 교훈

- **"표준 자료를 읽는 일"과 "규칙을 수행하는 일"은 다른 층이다.** 자료는 이해·매핑용, 수행은 도구가. 사람이 표준을 손으로 옮기는 건 (B) 정책룰을 만드는 *메인테이너*의 몫이고, 사용자는 그 결과를 끌어다 쓴다.
- **"도구가 잡았다"의 신뢰도는 그 지식의 출처를 알 때 생긴다.** CVE는 DB(누가·언제 갱신), 정책은 코드룰(어느 벤치마크 몇 항목), SAST는 패턴(어느 CWE) — 출처를 알면 오탐/미탐도 해석된다.
- 인증 통제는 **"코드로 강제하고 도구로 증명"** 할 때 "구현 경험"이 된다(문서로만 적은 정책이 아니라).
