# DailyProof

오늘 루틴을 캘린더에 기록하고, 각 일정을 노션 스타일 페이지로 자세히 적을 수 있는 웹앱.

- **스택**: Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **DB / Auth**: Supabase (Postgres + RLS + Email Auth)
- **캘린더**: FullCalendar
- **에디터**: Tiptap (StarterKit, TaskList, Link, Placeholder)

## 기능

- 이메일/비밀번호 회원가입 & 로그인 (Supabase Auth, RLS로 사용자별 데이터 격리)
- "루틴" 마스터 목록 CRUD — 캘린더 아래에 버튼 그리드로 표시
- 버튼 클릭 → 오늘 날짜에 추가/제거 (캘린더에 즉시 반영, 옵티미스틱 업데이트)
- 캘린더 이벤트 클릭 → 그 (루틴, 날짜) 조합의 노션 스타일 페이지 열기 (자동 저장)
- 페이지에서 "이 날 기록 제거" / "페이지 비우기" 분리 제공
- "루틴" 삭제 시 연결된 모든 캘린더 기록 + 페이지 함께 삭제

## 빠른 시작

### 1. Supabase 프로젝트 준비

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성
2. Project Settings → API 에서 `URL`과 `anon` 키 복사
3. SQL Editor → New Query 에 `supabase/schema.sql` 내용을 붙여넣고 실행
4. (선택) Authentication → Providers → Email 에서 "Confirm email"을 끄면 가입 후 바로 로그인 가능

### 2. 로컬 실행

```bash
cp .env.example .env.local
# .env.local 에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 입력

npm install
npm run dev
```

http://localhost:3000

### 3. Vercel 배포

> **Vercel은 web(Next.js)만 호스팅한다.** worker는 상주 폴링 프로세스라 서버리스(Vercel)에서
> 돌 수 없어 별도 환경(로컬/컨테이너/k3s)에서 실행한다. 그래서 Vercel 단독 배포 시 **로그인·기록·
> 업로드는 정상 동작하지만, 업로드 후처리(thumbnail·메타데이터·`ready` 전이)는 worker를 따로 띄워야
> 동작한다**(이미지가 `uploaded` 상태에 머물면 버그가 아니라 worker 미기동). 컴포넌트별 배포 타깃은
> [architecture/environments.md](docs/architecture/environments.md) 참조.

1. GitHub에 푸시
2. [vercel.com](https://vercel.com)에서 Import → 이 레포 선택
3. Environment Variables 에 **이 두 개만** 추가(web이 쓰는 공개값):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - ⚠️ `SUPABASE_SERVICE_ROLE_KEY`·`WORKER_*`는 **넣지 않는다** — web이 참조하지 않는 worker 전용
     값이고, 특히 service_role은 RLS를 우회하는 god-mode 키라 프론트엔드 배포에 두면 노출 위험만 커진다.
4. Deploy
5. 배포 후 Supabase → Authentication → URL Configuration 에서
   `Site URL` 과 `Redirect URLs` 에 Vercel 도메인 등록 (이메일 확인 링크용)

> **`NEXT_PUBLIC_*`는 빌드 시점에 번들로 인라인된다** — 값을 바꾸면 환경변수만 수정해선 반영되지 않고
> **재배포(rebuild)** 해야 한다. (anon 키가 stale하면 Supabase가 `Unregistered API key` 401을 던진다.)
>
> **anon 키 세대 차이(레거시 `eyJ…` vs 새 `sb_publishable_…`)**: 둘 다 같은 프로젝트의 유효한 키지만,
> 환경에 따라 인증되는 쪽이 다를 수 있다(관측: 로컬은 `sb_publishable_`, Vercel은 레거시 `eyJ`가 동작).
> 통일을 강제하지 말고 **각 환경에서 실제로 인증되는 키**를 쓴다. `Unregistered API key` 401이면 그 환경에서
> 무효화된 키 세대를 쓰는 것이니 동작하는 세대로 교체 후 재배포.

## 디렉토리 구조

```
src/
├── app/
│   ├── actions/                     # 서버 액션
│   │   ├── templates.ts             #   루틴 마스터 CRUD
│   │   ├── logs.ts                  #   오늘 토글 / 로그 삭제
│   │   └── pages.ts                 #   페이지 저장/삭제
│   ├── auth/signout/                # 로그아웃 라우트
│   ├── login/, signup/              # 인증 페이지
│   ├── p/[templateId]/[date]/       # 페이지 상세 (Tiptap 에디터)
│   ├── page.tsx                     # 홈 = 캘린더 + 루틴 버튼 목록
│   └── layout.tsx, globals.css
├── components/
│   ├── dashboard.tsx                # 캘린더 + 루틴 버튼 그리드
│   ├── template-dialog.tsx          # 루틴 생성/수정 모달
│   └── page-editor.tsx              # Tiptap 에디터 + 툴바
├── lib/supabase/
│   ├── client.ts, server.ts, middleware.ts, types.ts
└── middleware.ts
supabase/
└── schema.sql                       # 테이블 + RLS + 트리거
```

## 데이터 모델

- `activity_templates` — "루틴" 마스터 (제목, 색상, 정렬 순서). 사용자가 별도로 관리.
- `activity_logs` — (template, 날짜) 조합. 캘린더에 보이는 "이 날 이걸 했음" 기록.
  `(template_id, log_date)` unique.
- `pages` — (template, 날짜) 조합마다 별도 노션 스타일 페이지. `(template_id, log_date)` 복합 기본키. 로그를 껐다 켜도 페이지 내용은 유지.

세 테이블 모두 `user_id` 기준 RLS로 보호.

## 개발 노트

- 페이지 본문 저장은 800ms 디바운스 + 서버 액션 (`savePage`)
- 루틴 버튼 토글은 옵티미스틱 업데이트 + `toggleLogToday` 서버 액션 + `router.refresh()`
- 세션 보호는 `src/middleware.ts` 에서 처리. `/login`, `/signup`, `/auth/*` 만 공개
