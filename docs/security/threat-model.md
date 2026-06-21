# 위협 모델 (threat model, STRIDE)

DailyProof를 위협 관점으로 분해해, 자산·신뢰 경계·진입점을 식별하고 STRIDE 6범주로 위협과 완화책·잔여 위험을 정리한다.

> **프레이밍(솔직히)**: 이 문서는 통제를 먼저 적용한 뒤 그것을 위협 관점으로 *사후 정리*한 것이다. 개별 통제(RLS·CSP·rate limit·sealed-secrets 등)를 "위협을 체계적으로 보고 대응했다"로 묶어, 빠진 곳·잔여 위험을 드러내는 게 목적이다. 위험 등급은 포트폴리오 규모 가정의 정성 평가다.

## 1. 시스템 개요 · 신뢰 경계

```
[사용자 브라우저]                     [Vercel: web (Next.js)]            [Supabase: Auth·DB(RLS)·Storage]
   │  (1) HTTPS                          │                                   ▲
   │ ───────────────────────────────────▶ server action / API ─────────────┤ (2) anon키+RLS / service_role
   │  업로드는 브라우저→Storage 직행 ────────────────────────────────────────▶ │
   │  grass <img> 공개 임베드 ──────────▶ /api/grass (비로그인) ─────────────▶ │
                                         [k3s: worker (폴링)] ───────────────▶ │ (3) service_role
```

**신뢰 경계 (trust boundary)** — 경계를 넘는 입력은 검증 전까지 불신:
- **TB1 인터넷 → web**: 익명/인증 사용자 요청. (가장 노출된 경계)
- **TB2 web/worker → Supabase**: anon키(RLS 적용) vs service_role(RLS 우회). worker가 강한 권한.
- **TB3 브라우저 → Storage 직행**: 업로드는 web을 안 거치고 Storage로. RLS·버킷 정책이 게이트.
- **TB4 클러스터 내부 pod 간**: NetworkPolicy default-deny.

## 2. 자산 (Assets) — 무엇을 지키나

| 자산 | 민감도 | 위협 시 영향 |
|---|---|---|
| 사용자 계정·세션 | 높음 | 계정 탈취 → 데이터 접근 |
| 사용자 데이터(doits·logs·pages) | 높음 | 무단 조회/변조 |
| 업로드 원본 이미지 | 중간 | 교차 사용자 노출 |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **치명적** | 유출 시 RLS 우회·전체 DB 접근 |
| anon 키 | 낮음(공개값) | RLS로 보호됨 |
| grass 공개 토큰 | 낮음 | 집계만 노출 |

## 3. 진입점 / 공격 표면 (Entry points)

| 진입점 | 인증 | 노출 |
|---|---|---|
| `/login`·`/signup` | 공개 | Supabase Auth |
| server actions (doits·logs·…) | 인증 | 상태 변경 |
| `/api/proof-assets` | 인증 | 업로드 등록(DB 쓰기) |
| `/api/media/[...]` | 인증 | 파일 스트리밍 |
| **`/api/grass/[token]`** | **비로그인 공개** | 유일한 공개 엔드포인트 |
| `/admin/ops` + admin RPC | 인증+admin | 운영 기능 |
| Storage(media) 직행 업로드 | 인증(RLS) | 파일 쓰기 |

## 4. 위협 행위자 (Threat actors)

- **익명 인터넷 공격자** — 공개 엔드포인트(grass)·로그인 무차별 대입·스캐닝.
- **인증된 악성 사용자** — 계정은 있고, 권한 경계(타인 데이터·admin)를 넘으려 시도(IDOR·권한상승).
- **탈취된 pod/의존성** — 공급망(악성 패키지)·런타임 침해 후 lateral movement.
- **부주의한 내부자/운영자** — 시크릿 노출, 잘못된 배포.

## 5. STRIDE 분석

각 위협 × 완화책(이미 적용) × 잔여 위험. 위험 등급 = 가능성×영향(정성).

### S — Spoofing (위장: 남인 척)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 세션·자격 위조로 타 사용자 위장 | Supabase Auth, 세션 쿠키 **HttpOnly·SameSite=Lax·Secure** | 낮음 |
| 로그인 무차별 대입 | Supabase Auth 자체 rate limit | 낮음 |
| grass 토큰 추측 | 96비트(24 hex) 토큰 + IP rate limit | 낮음 |

### T — Tampering (변조: 데이터/요청 조작)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 타 사용자 데이터 변조 | DB **RLS owner-only** | 낮음 |
| 악성 입력으로 상태 조작 | **zod 입력 검증**, `source_path` 소유 검증(403) | 낮음 |
| 응답 변조·XSS 스크립트 주입 | **CSP(nonce)**, 출력 이스케이프 | 낮음 |
| 업로드 파일 변조(비이미지·초과) | 버킷 MIME·8MB 강제 + API guard + DB constraint | 낮음 |

### R — Repudiation (부인: 한 일을 부인)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 관리자 작업 부인 | **`admin_audit`**(actor·action·target·시각) | 중간 — 일반 사용자 행위 감사는 제한적 |
| 추적 단절 | 구조화 로그·trace_id·OTel 트레이싱 | 중간 |

### I — Information disclosure (정보 노출)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 교차 사용자 데이터 노출 | RLS, media **세션 인가 프록시**(비소유자 404) | 낮음 |
| **service_role 키 노출** | web 미사용(SECURITY DEFINER RPC), **sealed-secrets**, gitleaks 게이트 | **중간 — 과거 노출분 회전 필요(#55)** |
| 기술스택·내부 정보 노출 | `X-Powered-By` 제거, 에러 메시지 절제 | 낮음 |
| 전송 중 가로채기 | HTTPS, **HSTS** | 낮음 |

### D — Denial of service (서비스 거부)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 공개 엔드포인트 폭주 | **rate limit**(grass IP 60/분, proof-assets uid 30/분) | 중간 — in-memory라 다중 pod per-pod |
| 업로드 스팸 → 큐 적체 | uid rate limit, max_attempts·dead-letter | 중간 |
| 리소스 고갈 | k8s resources requests/limits, HPA | 중간 |

### E — Elevation of privilege (권한 상승)
| 위협 | 완화책 | 잔여/등급 |
|---|---|---|
| 일반 사용자가 admin 기능 | **다층 인가**: 페이지 404 게이트 + admin RPC 내부 `is_admin()` 재검증 | 낮음 |
| 타인 경로 등록 → worker가 RLS 우회 처리(IDOR성) | API guard **source_path 소유 검증(403)** | 낮음 |
| 컨테이너 침해 후 권한 상승·확산 | **securityContext**(non-root·readOnly·drop ALL·seccomp), **NetworkPolicy** default-deny | 중간 |

## 6. 잔여 위험 · 후속

- **service_role 키 회전**(#55) — 과거 노출분. 가장 시급.
- **분산 rate limit** — in-memory → edge(Traefik)/Redis (다중 pod 환경).
- **사용자 행위 감사 확대** — 현재 audit은 admin 작업 중심.
- **FQDN egress 정책** — NetworkPolicy는 도메인 못 좁힘 → Cilium 등.
- **공급망 심화** — 이미지 서명(cosign)은 범위서 제외(욕심).

## 7. 가정 · 범위 밖 (Assumptions & out of scope)

- **신뢰 가정**: Supabase·Vercel 플랫폼 자체의 보안(인프라·하이퍼바이저)은 신뢰한다.
- **범위 밖**: 물리 접근, 운영자 단말 탈취, 소셜 엔지니어링, 서드파티 서비스 내부 취약점, DDoS(L3/4, CDN/클라우드 영역).
- 위험 등급은 트래픽이 거의 없는 포트폴리오 환경 가정의 정성 평가다.

참고: 통제 점검표 [security/checklist.md](checklist.md), 신고 정책 [/SECURITY.md](../../SECURITY.md), 개별 통제는 rate-limit·public-url-exposure·cookie-csrf·security-headers-plan·secret-management.
