# 보안 정책 (Security Policy)

DailyProof의 취약점 신고 절차와 범위. 이 저장소는 DevOps 학습/포트폴리오 프로젝트지만,
실제 서비스처럼 **취약점을 비공개로 신고받고 처리하는 절차**를 갖춘다.

## 지원 버전 (Supported versions)

| 버전 | 보안 업데이트 |
|---|---|
| `main` (최신) | ✅ |
| 그 외 브랜치/태그 | ❌ |

배포는 `main`을 source of truth로 GitOps(ArgoCD)·Vercel로 진행한다. 보안 수정은 `main`에만 반영한다.

## 취약점 신고 (Reporting a vulnerability)

**공개 이슈(Issues)로 올리지 마세요.** 공개되면 수정 전에 악용될 수 있습니다.

- **GitHub Security Advisory(비공개 보고)** 를 사용해 주세요:
  저장소 → **Security** 탭 → **Report a vulnerability**
  (직접 링크: https://github.com/ompangyji/dailyproof/security/advisories/new)
- 비공개 채널로 접수되어, 보고자와 비공개로 소통하며 수정합니다.

### 신고에 포함하면 좋은 정보

- 취약점 유형(예: 인증 우회, 권한 상승, 데이터 노출, 시크릿 노출, XSS/CSRF/SSRF 등)
- 영향 범위(무엇이 노출/변조 가능한가)
- **재현 절차**(단계, 요청 예시, PoC) — 재현 가능해야 빠르게 검증됩니다
- 영향받는 경로/파일/엔드포인트

## 범위 (Scope)

**대상**: 이 저장소의 애플리케이션·인프라 코드에서 비롯되는 취약점.
- 인증/인가 경계(RLS, server action, admin 권한), 입력 검증, 시크릿 취급, 업로드 처리,
  공개 엔드포인트(grass 토큰·미디어 프록시), 배포·k8s 매니페스트(NetworkPolicy·securityContext 등).

**범위 밖 (Out of scope)**:
- 서드파티 서비스 자체의 취약점(Supabase·Vercel 등) — 해당 벤더에 신고.
- 자동 스캐너의 컨텍스트 없는 결과(실제 영향 입증 없는 노이즈).
- 소셜 엔지니어링, 물리 접근, 사용자 계정 탈취가 전제인 시나리오.
- 모범사례 권고(예: 헤더 미세 조정)로 실제 악용 경로가 없는 것.

## 응답·공개 정책 (Response & disclosure)

- 포트폴리오 규모라 24/7 대응은 아니지만, **접수 확인은 합리적 시일 내**에 드립니다.
- **coordinated disclosure**: 수정이 배포되기 전까지 비공개를 유지해 주세요. 수정 후 공개 범위·시점은 함께 조율합니다.
- 유효한 신고는 (원하시면) advisory에 기여자로 표기합니다.

## Safe harbor (선의의 연구)

선의로, 이 정책 범위 안에서 수행한 연구(서비스 중단·데이터 파괴·타 사용자 데이터 접근 없이)에 대해서는
**법적 조치를 취하지 않습니다.** 단 발견한 타인 데이터는 즉시 접근을 멈추고 신고에만 사용해 주세요.

## 이미 적용한 보안 통제

이 프로젝트가 갖춘 통제 요약은 [docs/security/checklist.md](docs/security/checklist.md) 참조 —
스캐닝(trivy·gitleaks·CodeQL)·CSP·rate limit·입력 검증(zod)·sealed-secrets·NetworkPolicy·런타임 하드닝 등.
