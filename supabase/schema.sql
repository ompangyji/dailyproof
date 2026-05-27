-- DailyProof schema (v3: 한 일 마스터 + 로그 + 페이지 + emoji/tags)
-- Run in Supabase SQL Editor. Safe to re-run (additive).
-- If you previously ran v1 (tables `activities` / `pages`), drop them first:
--   drop table if exists public.pages, public.activities cascade;

create extension if not exists "pgcrypto";

-- 한 일의 마스터 정의. 사용자가 관리하는 활동/습관 라이브러리.
create table if not exists public.activity_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  color       text,
  emoji       text,                                 -- 단일 이모지 (선택)
  tags        text[] not null default '{}',         -- # 없이 저장
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 기존 v2 → v3 마이그레이션 (이미 만들어진 테이블에 컬럼 추가)
alter table public.activity_templates
  add column if not exists emoji text,
  add column if not exists tags  text[] not null default '{}';

create index if not exists activity_templates_user_idx
  on public.activity_templates (user_id, sort_order, created_at);

-- 태그 배열 검색용 GIN 인덱스 (향후 #태그로 필터링 시 사용)
create index if not exists activity_templates_tags_idx
  on public.activity_templates using gin (tags);

-- (한 일, 날짜) 조합. 캘린더에 보이는 "이 날 이걸 했음" 기록.
create table if not exists public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  template_id  uuid not null references public.activity_templates(id) on delete cascade,
  log_date     date not null,
  created_at   timestamptz not null default now(),
  unique (template_id, log_date)
);

create index if not exists activity_logs_user_date_idx
  on public.activity_logs (user_id, log_date desc);

-- 그 날만 한 일을 가볍게 기록하는 일회성 항목 (doit).
-- 루틴과 달리 재사용되지 않고, 제목 + 이모지 + 메모 + 이미지 갤러리.
create table if not exists public.doits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  emoji       text,
  memo        text,
  image_urls  text[] not null default '{}',
  doit_date   date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 기존 v3 → v4 마이그레이션
alter table public.doits
  add column if not exists image_urls text[] not null default '{}';

create index if not exists doits_user_date_idx
  on public.doits (user_id, doit_date desc);

drop trigger if exists doits_touch on public.doits;
create trigger doits_touch
  before update on public.doits
  for each row execute function public.touch_updated_at();

alter table public.doits enable row level security;
drop policy if exists "doits owner-only" on public.doits;
create policy "doits owner-only" on public.doits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- (한 일, 날짜) 조합마다 별도 페이지.
create table if not exists public.pages (
  template_id  uuid not null references public.activity_templates(id) on delete cascade,
  log_date     date not null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  content      jsonb,
  content_text text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (template_id, log_date)
);

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activity_templates_touch on public.activity_templates;
create trigger activity_templates_touch
  before update on public.activity_templates
  for each row execute function public.touch_updated_at();

drop trigger if exists pages_touch on public.pages;
create trigger pages_touch
  before update on public.pages
  for each row execute function public.touch_updated_at();

-- RLS
alter table public.activity_templates enable row level security;
alter table public.activity_logs      enable row level security;
alter table public.pages              enable row level security;

drop policy if exists "templates owner-only" on public.activity_templates;
create policy "templates owner-only" on public.activity_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Logs/pages must belong to the user AND reference a template the user owns,
-- so nobody can attach rows to someone else's template_id.
drop policy if exists "logs owner-only" on public.activity_logs;
create policy "logs owner-only" on public.activity_logs
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.activity_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "pages owner-only" on public.pages;
create policy "pages owner-only" on public.pages
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.activity_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  );

-- =========================================================================
-- Storage: 사용자 업로드 이미지를 담을 "비공개" 버킷 + 자기 폴더만 읽기/쓰기 RLS.
-- 경로 규칙: <auth.uid()>/<kind>/<filename>
-- 읽기는 /api/media 프록시 라우트가 사용자 세션으로 download 하므로 RLS가 게이트.
-- =========================================================================
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do update set public = false;

drop policy if exists "media: insert own" on storage.objects;
create policy "media: insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 자기 폴더의 파일만 읽기 (이전의 전체 공개 read 정책 대체)
drop policy if exists "media: read public" on storage.objects;
drop policy if exists "media: read own" on storage.objects;
create policy "media: read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media: update own" on storage.objects;
create policy "media: update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media: delete own" on storage.objects;
create policy "media: delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- =========================================================================
-- 사용자별 라이브러리(커스텀 색상/태그). 계정 단위로 어디서나 동기화되도록
-- localStorage 대신 DB에 보관. 사용자당 1행.
-- =========================================================================
create table if not exists public.user_preferences (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  custom_colors text[] not null default '{}',
  custom_tags   text[] not null default '{}',
  updated_at    timestamptz not null default now()
);

drop trigger if exists user_preferences_touch on public.user_preferences;
create trigger user_preferences_touch
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

alter table public.user_preferences enable row level security;
drop policy if exists "preferences owner-only" on public.user_preferences;
create policy "preferences owner-only" on public.user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
