# 쿠키·CSRF 점검 — 기준·평가·판정

세션 쿠키와 상태 변경 요청(server action·POST 라우트)이 탈취·위조(CSRF)에 견디는지 점검한 기록. 인상이 아니라 기준을 세워 평가하고, 이미 안전한 곳은 근거와 함께 닫고 갭만 하드닝한다.

> **요지**: 대부분 이미 안전하다 — Supabase SSR 쿠키 기본값(HttpOnly·SameSite=Lax·Secure)과 Next.js 15 server action의 내장 CSRF(Origin↔Host 검증)가 1차 방어를 한다. 보강은 `serverActions.allowedOrigins` 명시 하나.

## 평가 기준

| 기준 | 묻는 것 |
|---|---|
| **쿠키 탈취 내성** | 세션 쿠키가 JS로 읽히나(HttpOnly), 평문 전송되나(Secure) |
| **CSRF 내성(쿠키)** | 크로스사이트 요청에 쿠키가 자동 전송되나(SameSite) |
| **상태 변경 인가** | 변경 요청이 인증·소유 검증을 거치나 |
| **CSRF 내성(요청)** | 변경 요청이 신뢰 Origin에서 온 건지 검증하나 |
| **메서드 안전성** | 상태 변경이 GET 같은 안전 메서드로 되진 않나 |

## 평가

### 세션 쿠키 (Supabase SSR)

쿠키 속성을 앱에서 직접 지정하지 않고 `@supabase/ssr`이 넘기는 옵션을 그대로 적용한다(`server.ts`·`middleware.ts`의 `setAll`이 options를 통과시킴). 라이브러리 기본값:

| 속성 | 값 | 효과 |
|---|---|---|
| `HttpOnly` | true | JS(`document.cookie`)로 못 읽음 → XSS로 토큰 탈취 차단 |
| `SameSite` | `Lax` | 크로스사이트 **POST 폼엔 쿠키 미전송**(top-level GET 이동에만) → CSRF 1차 방어 |
| `Secure` | true(https) | HTTPS에서만 전송 → 평문 가로채기 차단 |
| `Path` | `/` | 앱 전체 |

**판정: 안전 — 조치 불요.** 기본값이 올바르다. (직접 지정해 덮어쓰면 오히려 실수 여지가 커지므로 라이브러리 기본을 신뢰.)

### Server Action (상태 변경의 주 경로)

- **인가**: actions 7개 파일(doits·logs·pages·preferences·templates·trackers·admin) **전부** `requireUser`/`getUser`로 로그인 검증. admin은 추가로 DB에서 `is_admin()` 재검증.
- **CSRF**: Next.js 15 App Router의 server action은 **POST-only + Origin↔Host 검증**을 프레임워크가 강제한다. 폼이 아닌 임의 fetch로 호출해도 Origin이 안 맞으면 거부.
- **판정: 안전, 단 프록시 환경 하드닝.** 아래 조치 참조.

### signout (POST 라우트)

- `/auth/signout`은 **GET이 아니라 POST**. GET이면 `<img src>`로도 강제 로그아웃(CSRF)이 가능하지만 POST라 그게 안 된다.
- 게다가 세션 쿠키가 `SameSite=Lax`라 **크로스사이트 POST엔 쿠키가 안 실려** signOut이 빈 세션에 동작 → 무해.
- **판정: 안전 — 조치 불요.**

## 적용한 조치

- **`serverActions.allowedOrigins` 명시**(`next.config.mjs`): `dailyproof.obong2.net`, `*.vercel.app`. Next는 기본적으로 Origin을 내부 Host와 비교하는데, **프록시/커스텀 도메인 뒤에선 내부 Host가 외부 도메인과 달라 보일 수 있다** — 신뢰 Origin을 명시해 ① 정상 도메인의 server action이 막히지 않게 하고 ② 신뢰 목록 밖 Origin은 거부되게 한다(defense in depth).
- 쿠키·signout·인가는 이미 안전 → 변경 없음.

## 잔여 위험 / 후속

- **SameSite=Lax vs Strict**: Lax는 top-level GET 이동엔 쿠키를 보낸다(로그인 유지 UX). 더 엄격히 하려면 Strict지만, 외부 링크로 진입 시 로그인이 풀려 UX가 나빠진다 → Lax 유지가 합리적.
- **XSS가 뚫리면** HttpOnly도 토큰 탈취는 막지만 세션 라이딩은 가능 → CSP(이미 적용)·입력 검증이 그 위층 방어.
- allowedOrigins는 도메인 변경 시 갱신 필요(운영 메모).
