# 보안 findings triage — 무엇을, 어떻게 판단했나

CI 보안 스캐닝(trivy + CodeQL)이 Security 탭에 **28건**을 올렸다. 이걸 **그대로 다 고치는 게 아니라**, 사람이 "진짜인가 / 우리 환경에서 통하는가 / 고칠까 억제할까"를 판단하는 게 **triage**다. 도구는 *찾고(find)*, 사람은 *결정한다(decide)*. 이 문서는 그 판단의 근거를 남긴다(나중에 "왜 이 alert는 무시했나"에 답하기 위해서도 필요).

## triage 기준 — 각 finding에 던지는 질문

1. **real인가?** 플래그된 패턴이 우리 코드/환경에서 실제로 exploitable한가, 아니면 도구의 과탐(false positive)인가.
2. **fix 가능한가?** 우리가 바꿀 수 있는가(우리 매니페스트/코드/의존성) vs 환경·플랫폼이 강제하는가.
3. **안 고치면?** 의도적으로 두는 거라면 **사유를 기록**하고 억제(suppress/dismiss)한다 — "방치"가 아니라 "수용된 위험(accepted risk)".

도구가 **심각도(CVSS)·CWE/CVE·파일·라인·remediation 링크**를 함께 주므로, 백지 조사가 아니라 그 맥락을 읽고 **판단**하는 일이다.

---

## 🔴 FIX — 진짜 문제, 우리 통제 가능 (hardening)

### 1. readOnlyRootFilesystem 미설정 (KSV-0014, HIGH ×3 — web·worker·smoke)
- **무엇**: 컨테이너 루트 파일시스템이 쓰기 가능. 침입자가 디스크에 악성 실행파일을 쓰거나 변조할 수 있다.
- **판단 근거 — real**: 세 워크로드 모두 `readOnlyRootFilesystem`가 없음(확인: 매니페스트 securityContext에 미존재). 우리가 바꿀 수 있는 매니페스트 설정이고, HIGH라 우선순위 높음.
- **조치**: 컨테이너 securityContext에 `readOnlyRootFilesystem: true` + 앱이 써야 하는 경로(`/tmp`, Next 캐시 등)는 `emptyDir` 볼륨으로 마운트. (루트는 잠그되 필요한 쓰기 경로만 연다.)

### 2. seccompProfile 미설정 (Seccomp disabled / RuntimeDefault not set, MED ×3)
- **무엇**: seccomp(허용 syscall 제한)이 안 걸려 컨테이너가 모든 시스템콜을 쓸 수 있다.
- **판단 근거 — real**: 세 워크로드 pod securityContext에 `seccompProfile` 없음. 추가 비용 거의 없이 공격 표면을 줄임.
- **조치**: pod securityContext에 `seccompProfile: { type: RuntimeDefault }`.

### 3. smoke 컨테이너 권한 미강화 (privilege escalation / capabilities, MED)
- **무엇**: smoke Job 컨테이너에 `allowPrivilegeEscalation: false`·`capabilities.drop: [ALL]`가 없음.
- **판단 근거 — real이지만 부분적**: web·worker에는 이미 둘 다 있음(확인). **smoke Job만 빠져** 일관성이 깨짐. smoke는 curl 한 번 도는 짧은 Job이라 위험은 낮지만, "일관된 최소권한"을 위해 맞춤.
- **조치**: smoke 컨테이너에도 `allowPrivilegeEscalation: false` + `capabilities.drop: [ALL]`.

---

## 🟡 CodeQL (코드 / 의존성)

### 4. Reflected XSS — grass SVG 라우트 → **false positive로 판단(단, 코드 정리)**
- **무엇**: CodeQL이 "사용자 입력(query param)이 SVG 응답으로 흘러 reflected XSS 가능"이라고 플래그.
- **판단 근거 — 거의 FP**:
  - SVG에 들어가는 모든 데이터/입력이 **`esc()`로 이스케이프**(`& < > "`) 되거나 **검증**된다: 색상은 `parseHex`(정규식 `^[0-9a-f]{6}$`)로만 통과, `radius`는 `parseInt` 후 0~6 clamp, `theme`는 `dark|light` whitelist. → 공격 문자(`<`, `>`)가 애초에 못 들어감.
  - 즉 우리 환경에서 실제 주입은 막혀 있어 **exploitable하지 않다**.
- **그래도 손보는 이유**: `bg`를 검증한 뒤 템플릿에서 **다시 `searchParams.get("bg")`로 재조회**(re-read)해서, CodeQL의 taint 분석이 "sanitize됐다"를 증명하지 못해 alert가 뜬다. → **검증된 값을 그대로 사용**하게 정리하면 alert가 사라지고 코드도 깔끔해진다. (FP 억제 + 클린업)

### 5. PostCSS XSS → **이미 패치됨으로 판단(재확인 후 dismiss)**
- **무엇**: postcss 관련 XSS/파싱 취약점(CVE-2023-44270 류).
- **판단 근거**: 해당 CVE는 **postcss < 8.4.31**에서 수정. 우리는 `postcss ^8.4.49`(확인: package.json) 로 **이미 고친 버전 이상**. → 직접 의존성은 안전. 전이 의존성이 옛 버전을 끌면 Dependabot이 PR을 연다.
- **조치**: 재스캔/Dependabot으로 확인 후 dismiss(또는 transitive면 bump).

---

## 🟢 SUPPRESS — 우리 환경에선 의도적, 사유 기록 후 억제

이건 "못 고치는 게 아니라 **이 단계·환경에선 안 고치는 게 맞다**"고 판단한 것. 각각 사유를 남긴다.

| Finding | 억제 사유 |
|---|---|
| **Image tag `latest`** | default values만 `latest`고, staging/prod는 실제 태그로 override. 로컬 k3s는 `imagePullPolicy: IfNotPresent`(레지스트리 pull 안 함) 전제라 재현성 문제 없음. |
| **Workloads in default namespace** | 차트 템플릿엔 namespace를 박지 않음 → 배포 시 **Helm release namespace**(`dailyproof-staging`)로 들어감. 스캐너는 "정적 템플릿"만 봐서 default로 오인. 실제 배포는 default가 아님. |
| **Trusted registry 제한** | 로컬 import 이미지(레지스트리 자체가 없음). registry 정책은 레지스트리 도입 시 의미. |
| **ConfigMap sensitive content** | ConfigMap의 `NEXT_PUBLIC_*`(anon 키)는 **설계상 공개값**(클라이언트 번들에 인라인되며 RLS로 보호). 진짜 시크릿(service_role)은 Secret으로 분리돼 있음. → 민감정보 아님. |
| **Runs with GID <= 10000** | `1001`은 이미지의 표준 non-root 유저와 일치. "root로 안 돈다"는 목적은 충족. 굳이 >10000으로 바꿀 실익 적음. |

---

## 추가 round — repo 전체 스캔(CI)이 잡은 차트 밖 findings 4건

위 triage는 로컬에서 `deploy/helm`(차트)만 스캔해서 판단했는데, **CI는 repo 전체**(Dockerfile·의존성·스크립트)를 스캔한다. merge 후 Security 탭에 차트 밖 findings 4건이 남아 있었다(= 로컬 helm-only 스캔이 놓친 것). 전부 Medium 이하라 HIGH/CRITICAL gate는 안 막지만 정리.

| Finding | 심각도 | 출처 | 판정 / 조치 |
|---|---|---|---|
| postcss: XSS via style closing tags | Medium | Trivy · package-lock(전이 의존성 postcss 8.4.31) | **FIX** — `package.json` `overrides`로 `postcss ^8.4.49` 강제 → 8.5.15로 통합. (직접 의존성은 8.4.49였지만 next가 끌어온 전이가 옛 버전) |
| No HEALTHCHECK defined (web) | Low | Trivy · Dockerfile.web | **FIX** — `/health/live` wget HEALTHCHECK 추가(docker/compose용; k8s는 probe). |
| No HEALTHCHECK defined (worker) | Low | Trivy · Dockerfile.worker | **FIX** — HTTP 없어 `pgrep -f worker.mjs` 프로세스 생존 체크. |
| Superfluous trailing arguments | Warning | CodeQL · scripts/notion-sync.mjs:220 | **FIX** — `mapPool`이 `fn(item, i)`로 호출하나 유일 호출부가 index 미사용 → 인자 제거. |

**교훈(스캔 범위)**: **로컬 스캔과 CI 스캔의 범위가 다르면 findings를 놓친다.** 로컬은 차트만(`deploy/helm`), CI는 repo 전체를 봤다 → Dockerfile·의존성·스크립트 findings가 CI에서만 떴다. 다음부턴 **로컬 검증도 CI와 같은 범위**(repo 루트 `trivy fs .`)로 돌려 사각지대를 없앤다.

---

## 교훈

- **triage는 도구가 아니라 사람의 판단**이다. 도구가 주는 맥락(심각도·CWE·라인·설명)을 읽고 "우리 환경에서 진짜 통하나"를 따진다.
- **real을 가르는 핵심 질문**: "공격 문자/경로가 우리 검증을 뚫고 실제로 도달하나?" (grass XSS는 검증 때문에 못 뚫어 FP, KSV-0014는 실제 미설정이라 real.)
- **안 고칠 거면 반드시 사유를 남긴다.** 그래야 나중에 "왜 이 HIGH를 무시했냐"에 "이런 근거로 수용했다"고 답할 수 있다(= accepted risk). 침묵의 방치와 다르다.
- **고친 뒤엔 재스캔으로 28→줄어듦을 확인**해 "발견→수정"을 닫는다.
