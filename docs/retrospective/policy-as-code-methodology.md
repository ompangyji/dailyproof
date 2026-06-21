# 회고: 보안 정책은 어떻게 정립하는가 (Policy as Code 방법론)

Kyverno로 admission 정책을 만들며 "정책을 어떻게 기획·정립하나?"가 궁금했다. 즉흥이 아니라 **확립된 절차**가 있다는 걸 정리한다.

## 정책의 세 가지 근거 — 어디서 "무엇을 막을지"가 나오나

정책은 허공에서 나오지 않는다. 셋 중 하나(또는 여럿)에서 도출된다.

| 근거 | 묻는 것 | 성격 | 예 |
|---|---|---|---|
| **위협 모델(threat model)** | "어떻게 공격당하나?" | 우리 시스템 고유 분석 | EoP(권한 상승) → root 컨테이너 금지 |
| **컴플라이언스(compliance)** | "규정·인증이 뭘 요구하나?" | 외부 강제(법·인증·계약) | ISO 27001·SOC 2·PCI-DSS → 최소 권한 |
| **업계 표준(best practice)** | "남들은 어떻게 하나?" | 모범사례 | Pod Security Standards "restricted" |

- **위협 모델** = 내부 분석. 우리 [threat-model.md](../security/threat-model.md)의 STRIDE에서 "컨테이너 침해 후 권한 상승" 위협 → non-root·drop caps 정책.
- **컴플라이언스** = 외부 규정. ISO 27001/ISMS-P·SOC 2·PCI-DSS·GDPR 같은 인증·법이 "컨테이너는 최소 권한", "root 금지" 같은 *기술 통제*를 요구한다. 감사 때 "admission으로 강제한다"로 증명한다. (이 프로젝트는 실제 인증은 안 받지만, 통제를 표준 항목에 *매핑*해 둔다 — 예: 보안 스캐닝 워크플로 주석의 `ISO A.8.24 / ISMS-P`.)
- **업계 표준** = 모범사례. CIS Benchmark·Pod Security Standards가 구체 항목의 출처.

→ 셋은 종종 **같은 정책으로 수렴**한다. "non-root 강제"는 위협 분석으로도, 컴플라이언스 요구로도, 업계 표준으로도 나온다. 그래서 정책마다 "어느 근거에서 왔나"를 적어두면 체계가 드러난다.

## 정립 절차 (업계 표준 흐름)

```
위협 모델 ─┐
컴플라이언스 ┼─→ 정책 초안 ─→ 기존 상태 확인 ─→ Audit(관찰) ─→ 예외(scope) 조정 ─→ Enforce(강제)
업계 표준  ─┘                     (워크로드 PASS?)
```

1. **도출**: 위 세 근거에서 "무엇을 막을지" 정한다.
2. **기존 상태 확인**: 현 워크로드가 이미 지키는지 점검(안 그러면 정책이 우리 앱을 막는다). → policyreport로 web·worker PASS 확인 후 진행.
3. **Audit(관찰)**: 거부 없이 위반만 기록(`validationFailureAction: Audit`). 무엇이 걸리는지 본다.
4. **예외(scope) 설계**: 시스템 네임스페이스(kube-system·monitoring 등)는 제외 — 거긴 root 워크로드가 많아 막으면 클러스터가 깨진다.
5. **Enforce(강제)**: 안전 확인 후 admission에서 차단으로 승격.

이 "Audit → Enforce 점진 적용"은 CSP의 report-only → enforce, NetworkPolicy 도입과 **같은 패턴**이다 — *관찰 후 강제*가 정책 롤아웃의 정석이다.

## 이건 확립된 분야다 (즉흥 아님)

이 흐름은 다음 프레임워크에 기반한다:
- **Policy as Code**: 정책을 문서가 아니라 *코드*로 작성·버전관리(git)·자동 평가. Kyverno/OPA Gatekeeper가 그 도구.
- **NIST SP 800-190**(컨테이너 보안)·**800-53**(통제 카탈로그): 통제 도출·적용 가이드.
- **CIS Kubernetes Benchmark / Pod Security Standards**: 구체 통제 항목.
- **Threat modeling → controls → enforcement**: 위협에서 통제를 끌어내는 표준 보안 엔지니어링 흐름.

실무에선 보통 **표준 정책 라이브러리**(Kyverno/Gatekeeper가 PSS·CIS 기반으로 제공)에서 골라 **scope·예외만 우리 환경에 맞게 커스터마이징**한다. 직접 다 짜기보다 "표준을 우리 상황에 맞게 정립"이 일반적이다. (이 프로젝트는 학습 목적이라 `require-non-root`를 직접 작성했다.)

## 예방·탐지·강제 — 통제는 한 겹이 아니다

같은 "non-root" 요구도 **여러 시점에서** 통제한다. 이게 defense in depth다.

| 시점 | 도구 | 막는 것 |
|---|---|---|
| **예방(배포 전)** | trivy (CI) | PR/머지 전 매니페스트 검사 — CI를 거치면 잡힘 |
| **강제(배포 순간)** | **Kyverno (admission)** | CI를 우회한 `kubectl apply`도 클러스터 입구에서 거부 |
| **탐지(런타임)** | Prometheus 알림 | 이상 징후를 사후 관측 |

Kyverno가 메우는 갭: trivy는 CI에서만 본다 → CI를 안 거친 직접 apply는 통과한다. admission은 *어떤 경로로 들어와도* 막는다.

## 교훈

- **정책은 근거에서 도출한다** — 위협 모델·컴플라이언스·업계 표준. "왜 이 정책인가"를 적으면 임의가 아니라 체계가 된다.
- **관찰 후 강제(Audit→Enforce)** — 켜기 전에 우리 워크로드가 통과하는지 확인하고, 단계적으로 올린다. (CSP·NetworkPolicy와 같은 패턴)
- **예방·강제·탐지를 겹친다** — CI 검사(예방)만으로는 우회 가능. admission(강제) + 런타임 관측(탐지)으로 시점을 겹쳐야 한다.
