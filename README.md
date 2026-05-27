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

1. GitHub에 푸시
2. [vercel.com](https://vercel.com)에서 Import → 이 레포 선택
3. Environment Variables 에 다음 두 개 추가:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy
5. 배포 후 Supabase → Authentication → URL Configuration 에서
   `Site URL` 과 `Redirect URLs` 에 Vercel 도메인 등록 (이메일 확인 링크용)

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
