# Security headers 도입 계획 (#56)

브라우저가 강제하는 보안 헤더를 추가한다. 6개 헤더 중 5개는 무위험·즉효, **CSP만 앱이 깨질 수 있어** 단계적(report-only → enforce)으로 간다. 무작정 적용하지 않고 *충돌원·적용 지점·검증·롤백*을 먼저 정한다.

> **전제(환경)**: 프론트는 **Vercel 배포 + 연결 도메인** 있음 → 적용 후 **securityheaders.com 실스캔으로 등급(F→A) 증거**를 남길 수 있다. 로컬은 `curl -I`로 헤더 확인.

## 적용할 헤더와 값

| 헤더 | 값(안) | 막는 것 | 리스크 |
|---|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (preload 제외) | HTTPS 다운그레이드·MITM | 낮음(Vercel은 HTTPS 강제라 안전) |
| `X-Content-Type-Options` | `nosniff` | MIME 스니핑 | 없음 |
| `X-Frame-Options` | `DENY` | 클릭재킹(iframe 삽입) | 낮음 |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | referrer 경로 유출 | 없음 |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | 안 쓰는 브라우저 기능 차단 | 없음 |
| `Content-Security-Policy` | 아래 디렉티브 | XSS·리소스 출처 제한 | **높음 — 단계 적용** |

## CSP 디렉티브 설계 (충돌원 반영)

코드 조사로 확인한 충돌원과 그에 맞춘 디렉티브:

| 디렉티브 | 값(안) | 근거(충돌원) |
|---|---|---|
| `default-src` | `'self'` | 기본은 same-origin |
| `script-src` | `'self'` + **nonce**(또는 폴백 `'unsafe-inline'`) | Next.js 하이드레이션 인라인 스크립트 |
| `style-src` | `'self' 'unsafe-inline'` | React `style={{}}` 인라인 스타일 다수 + Tailwind |
| `img-src` | `'self' data: blob: <SUPABASE_URL>` | media 프록시(same-origin)·placeholder·blob 미리보기 |
| `connect-src` | `'self' <SUPABASE_URL>` | Supabase REST/Realtime. (OTLP는 서버 export라 무관) |
| `font-src` | `'self'` | **next/font가 빌드 시 self-host** → 외부 불필요 |
| `frame-ancestors` | `'none'` | 이 앱을 iframe에 못 넣게(클릭재킹). **grass는 `<img>` 임베드라 영향 없음** |
| `base-uri` | `'self'` | base 태그 주입 차단 |
| `form-action` | `'self'` | 폼 전송 대상 제한 |
| `object-src` | `'none'` | 플러그인 차단 |

**핵심 결정 — script-src(미정, 같이 정할 것)**
- **A) `'unsafe-inline'`**: 간단·안 깨짐. 단 인라인 스크립트 허용이라 XSS 방어가 약함("약한 CSP").
- **B) nonce(요청별 난수)**: 강함(인라인 차단). 단 미들웨어에서 nonce 생성 → **정적 페이지가 동적 렌더로 전환**되는 비용 + 설정 까다로움.
- → 권장: **B 시도 → 막히면 A 폴백**(report-only 단계라 안전하게 판단 가능).

## 적용 지점

- **정적 5개 헤더**: `next.config.ts`의 `headers()` — 전역, 무위험, 가장 단순.
- **CSP**: nonce를 쓰면 **미들웨어**(`src/middleware.ts`)에서 요청별 생성·주입. 단 현재 matcher가 `api/grass`·`_next/static`·이미지·`health`·`metrics`를 **제외** → CSP 적용 범위를 그에 맞게 재설계해야 한다(정적 자산·grass엔 별도 처리/불필요).
- CSP를 nonce 없이 정적으로 둘 거면(A안) `next.config` headers로 같이 둘 수 있다.

## 단계 전략 (복구 가능성 보장)

1. **1단계 — 정적 5개 헤더만** 적용. `curl -I`로 확인. (무위험, 여기서 등급 이미 크게 오름)
2. **2단계 — CSP를 `Content-Security-Policy-Report-Only`로** 추가. **차단 안 하고 위반만 보고** → dev에서 앱 전 기능(로그인·업로드·대시보드·grass·lightbox) 돌려보며 콘솔 위반 수집 → 디렉티브 보정.
3. **3단계 — enforce 전환**: report-only가 깨끗하면 `Content-Security-Policy`로 승격.
4. **롤백**: 모두 응답 헤더라 문제 시 **해당 헤더/커밋 revert 한 번**으로 즉시 원복(데이터·DB 무관). CSP만 끄고 나머지 5개는 유지하는 부분 롤백도 가능.

## 검증·증거

- `curl -I https://<도메인>` → 헤더 6종 존재 확인.
- **securityheaders.com에 배포 도메인 스캔** → 등급 스샷(적용 전/후 비교 가능하면 before/after).
- dev에서 report-only 위반 콘솔이 **0건**임을 확인하고 enforce 전환(스샷).
- 기능 회귀: 로그인·이미지 업로드·대시보드 렌더·grass 임베드·lightbox 정상 동작 확인.

## 확정한 결정

1. **script-src → B(nonce)**. 미들웨어에서 요청별 nonce 생성·주입. report-only로 먼저 관찰하고, 막히면 `'unsafe-inline'`(A)로 폴백.
2. **CSP 적용 지점 → 미들웨어**(`src/middleware.ts`, nonce 때문). 정적 5개 헤더는 `next.config`.
3. **HSTS → `preload` 제외**(`max-age=63072000; includeSubDomains`). 이유는 [retrospective/hsts-preload.md](../retrospective/hsts-preload.md) — preload는 브라우저에 하드코딩돼 되돌리기가 수주~수개월이라, 영구 HTTPS 확신 후 후속으로 둔다.

## 잔여/후속

- CSP 위반 리포트 수집 엔드포인트(`report-uri`/`report-to`)는 후속(지금은 콘솔 관찰로 충분).
- 적용 후 securityheaders 등급·관측을 보안 체크리스트(checklist.md)에 반영.
