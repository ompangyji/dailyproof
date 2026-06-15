# 현재 상태 분석 (Current State)

DailyProof의 **현재 구현**을 DevOps 관점에서 사실 기반으로 정리한 문서다.
목표 아키텍처/gap은 별도 문서(`plan/gap-analysis.md`, `architecture/target-architecture.md`)에서 다룬다.

분석 기준일: 2026-06-09 (Day1)

---

## 1. 한 줄 요약

DailyProof는 **Next.js 15 App Router 단일 앱**으로, 인증·데이터·파일 저장을 모두 **Supabase**(Postgres + Auth + Storage)에 위임한 개인 기록/습관 트래킹 서비스다.
이미지 업로드, 사용자별 데이터 격리(RLS), 비공개 미디어 프록시, 외부 임베드용 공개 토큰 엔드포인트까지 이미 갖추고 있다.
반면 **운영(배포 자동화·컨테이너·관측성·비동기 처리)** 요소는 아직 없다.

---

## 2. 기술 스택

| 영역 | 사용 기술 | 비고 |
|------|-----------|------|
| 프레임워크 | Next.js `^15.1.3` (App Router), React `^19` | server actions + route handlers |
| 언어 | TypeScript `^5` | |
| 스타일 | Tailwind CSS `^3.4` | |
| 인증/DB/스토리지 | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) | Postgres + Auth + Storage |
| 에디터 | Tiptap `^2` (image/link/task-list 등) | 페이지 본문 작성 |
| 캘린더 UI | FullCalendar `^6` | 기록 시각화 |
| 빌드/배포 | (추정) Vercel | `.gitignore`에 `.vercel` 존재 |

환경 변수(현재):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> 둘 다 `NEXT_PUBLIC_*` (클라이언트 노출). 서버 전용 시크릿(service role 등)은 현재 사용하지 않음.

---

## 3. 코드 구조

```
src/
├── middleware.ts                  # Supabase 세션 갱신, api/grass·정적자원 제외
├── lib/
│   ├── supabase/
│   │   ├── client.ts              # 브라우저 클라이언트
│   │   ├── server.ts              # 쿠키 기반 SSR 서버 클라이언트
│   │   ├── middleware.ts          # updateSession
│   │   ├── types.ts
│   │   └── upload.ts              # 이미지 업로드/삭제 유틸 (client)
│   └── tiptap.ts
├── app/
│   ├── actions/                   # server actions
│   │   ├── doits.ts  logs.ts  pages.ts
│   │   ├── preferences.ts  templates.ts  trackers.ts
│   ├── api/
│   │   ├── media/[...path]/route.ts   # 인증 미디어 프록시
│   │   └── grass/[token]/route.ts     # 공개 임베드(SVG/JSON)
│   ├── auth/signout/route.ts
│   ├── login/  signup/               # 인증 화면
│   ├── p/[templateId]/[date]/        # 날짜별 페이지
│   └── page.tsx (dashboard)
└── components/                    # dashboard, image-uploader, media-image, page-editor 등
```

---

## 4. 데이터 모델 (`supabase/schema.sql`)

| 테이블 | 역할 | 핵심 컬럼 |
|--------|------|-----------|
| `activity_templates` | 사용자 활동/습관 마스터 | `user_id`, `title`, `tags[]`, `emoji`, `sort_order` |
| `activity_logs` | (활동, 날짜) 수행 기록 | `template_id`, `log_date`, unique(template_id, log_date) |
| `doits` | 그날만의 일회성 기록 | `image_urls[]`, `tags[]`, `memo`, `doit_date` |
| `pages` | (활동, 날짜)별 본문 페이지 | `content` jsonb, `content_text`, PK(template_id, log_date) |
| `user_preferences` | 사용자별 커스텀 색상/태그 | 사용자당 1행 |
| `trackers` | 외부 임베드용 "잔디" 정의 | `token` (추측 불가), `tags[]`, `include_doits`, `enabled` |

특징:

- **모든 테이블 RLS `owner-only`** (`auth.uid() = user_id`). logs/pages는 추가로 "참조하는 template도 본인 소유"까지 검증.
- `updated_at` 자동 갱신 트리거(`touch_updated_at`).
- 태그 배열 검색용 **GIN 인덱스**, 사용자+날짜 복합 인덱스 존재.
- `get_grass(token)` = **SECURITY DEFINER** 함수. RLS를 우회해 소유자 데이터를 읽지만 **일자별 카운트만** 반환(원본 행 비노출). 최근 12개월. `anon`에게 execute 권한 부여.

---

## 5. 파일 업로드 / 미디어 흐름 (DevOps 핵심 포인트)

업로드 (`lib/supabase/upload.ts`, 클라이언트):

- `image/*` MIME 검사, **8MB 크기 제한**, 확장자 sanitize(`[a-z0-9]`).
- 저장 경로: `media/<userId>/<kind>/<uuid>.<ext>` (`kind` = `doits` | `pages`).
- `upsert: false`, `cacheControl: 3600`.
- 업로드 후 **공개 URL이 아닌 프록시 경로**(`/api/media/<path>`) 반환.

읽기 (`api/media/[...path]/route.ts`):

- 비공개 `media` 버킷을 **사용자 세션으로 download** → Storage RLS(`media: read own`)가 접근 게이트.
- 비소유자/익명은 download 실패 → **404**.
- `Cache-Control: private, max-age=3600` (소유자 브라우저만 캐시, 공유/CDN 캐시 금지).
- 서명 URL 만료가 없어 Tiptap 본문 내에서도 안정적으로 동작.

> 현재 업로드는 **동기·후처리 없음**: 파일 저장 후 메타데이터(크기/포맷/해시/썸네일) 생성 단계가 없다.

---

## 6. 인증 / 네트워크 경계

- Supabase Auth(쿠키 기반 SSR). `middleware.ts`가 매 요청 세션 갱신.
- 미들웨어 matcher가 **`api/grass`와 정적 자원을 제외** → 공개 임베드는 세션 처리 밖.
- 공개 표면(public surface):
  - `GET /api/grass/[token]` — SVG/JSON 잔디, `Access-Control-Allow-Origin: *`, 캐시(`max-age=600, s-maxage=600, swr=86400`), 토큰 정규식 검증(`[a-f0-9]{8,64}`).
- 비공개 표면:
  - `GET /api/media/[...path]` — 세션 필요, RLS 게이트.
  - server actions(doits/logs/pages/preferences/templates/trackers) — 인증 사용자 컨텍스트.

---

## 7. DevOps 관점에서 "이미 있는 것" vs "아직 없는 것"

이미 있는 것 (강점):

- 사용자별 데이터 격리(RLS) + 비공개 스토리지 + 인증 프록시
- 업로드 입력 검증(MIME/크기/확장자)
- 공개/비공개 표면 분리, 토큰 기반 외부 임베드(최소 권한 노출)
- 캐시 정책이 표면별로 구분되어 있음(private vs public+CDN)
- 멱등/안전 재실행 가능한 스키마(`if not exists`, additive migration)

아직 없는 것 (다음 단계 후보 — 상세는 gap-analysis):

- 비동기 작업: job queue / worker / 상태 모델(`proof_assets` 등) 없음
- 컨테이너화: Dockerfile / docker-compose 없음
- 배포 자동화: CI/CD(GitHub Actions) 없음, IaC 없음
- 오케스트레이션/GitOps: K8s manifests / ArgoCD 없음
- 관측성: health 엔드포인트, 구조화 로그, 메트릭, 트레이싱 없음
- 운영 문서: runbook / incident / rollback / 비용 / 백업 없음
- 환경 분리: dev/staging/prod 구분 없음 (env 2개만 존재)

---

## 8. 다음 작업 연결

- `plan/gap-analysis.md` — 위 "아직 없는 것"을 목표 DevOps 범위와 정식 비교
- `architecture/target-architecture.md` — web/worker/queue/storage 목표 구조
- DB 스키마 초안 — 업로드 후처리를 위한 `proof_assets`/job 모델 설계
