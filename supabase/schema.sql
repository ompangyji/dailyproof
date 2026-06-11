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
-- 루틴과 달리 재사용되지 않고, 제목 + 이모지 + 메모 + 이미지 갤러리 + 태그.
create table if not exists public.doits (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  emoji       text,
  memo        text,
  image_urls  text[] not null default '{}',
  tags        text[] not null default '{}',         -- # 없이 저장
  doit_date   date not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 기존 v3 → v4 / v5 마이그레이션
alter table public.doits
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists tags       text[] not null default '{}';

create index if not exists doits_user_date_idx
  on public.doits (user_id, doit_date desc);

-- 태그 배열 검색용 GIN 인덱스 (트래커 태그 필터에서 사용)
create index if not exists doits_tags_idx
  on public.doits using gin (tags);

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

-- =========================================================================
-- Trackers: 외부 임베드용 "잔디" 정의. 유형마다 태그 필터 + doit 포함 여부 +
-- 추측 불가능한 공개 토큰. 토큰으로만 외부에서 집계를 조회할 수 있다.
-- =========================================================================
create table if not exists public.trackers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 100),
  tags          text[] not null default '{}',
  include_doits boolean not null default false,
  token         text not null unique default encode(gen_random_bytes(12), 'hex'),
  enabled       boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists trackers_user_idx
  on public.trackers (user_id, sort_order, created_at);

drop trigger if exists trackers_touch on public.trackers;
create trigger trackers_touch
  before update on public.trackers
  for each row execute function public.touch_updated_at();

alter table public.trackers enable row level security;
-- Owner-only for management. Public read happens ONLY through get_grass() below,
-- so anon can never list trackers or read tokens.
drop policy if exists "trackers owner-only" on public.trackers;
create policy "trackers owner-only" on public.trackers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Public aggregate for the embed endpoint. SECURITY DEFINER so it can read the
-- owner's logs/doits past RLS, but it ONLY ever returns per-day counts for the
-- matching token — no raw rows leak. Last 12 months.
create or replace function public.get_grass(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.trackers;
  v_start date := (current_date - interval '364 days')::date;
  v_result jsonb;
begin
  select * into v from public.trackers where token = p_token and enabled = true;
  if not found then
    return null;
  end if;

  with days as (
    select gs::date as d
    from generate_series(v_start, current_date, interval '1 day') gs
  ),
  routine_counts as (
    select l.log_date as d, count(*)::int as c
    from public.activity_logs l
    where l.user_id = v.user_id
      and l.log_date >= v_start
      and (
        cardinality(v.tags) = 0
        or exists (
          select 1 from public.activity_templates t
          where t.id = l.template_id and t.tags && v.tags
        )
      )
    group by l.log_date
  ),
  doit_counts as (
    select dt.doit_date as d, count(*)::int as c
    from public.doits dt
    where v.include_doits
      and dt.user_id = v.user_id
      and dt.doit_date >= v_start
      and (
        cardinality(v.tags) = 0
        or dt.tags && v.tags
      )
    group by dt.doit_date
  ),
  merged as (
    select days.d,
      coalesce((select c from routine_counts r where r.d = days.d), 0)
      + coalesce((select c from doit_counts dc where dc.d = days.d), 0) as c
    from days
  )
  select jsonb_build_object(
    'name', v.name,
    'days', coalesce(
      jsonb_agg(
        jsonb_build_object('d', to_char(merged.d, 'YYYY-MM-DD'), 'c', merged.c)
        order by merged.d
      ),
      '[]'::jsonb
    )
  ) into v_result
  from merged;

  return v_result;
end;
$$;

grant execute on function public.get_grass(text) to anon, authenticated;

-- =========================================================================
-- 비동기 후처리 파이프라인: proof_assets(자산 상태) + jobs(작업 큐)
--
-- 업로드된 이미지를 worker가 비동기로 후처리(메타데이터·썸네일·해시·중복탐지).
-- 상태 전이: uploaded -> processing -> ready | failed   (failed -> processing 재처리)
-- 큐는 외부 브로커 없이 DB job table + polling.
--   claim_job(worker)이 FOR UPDATE SKIP LOCKED 로 동시성 안전하게 1건 선점.
-- worker는 SERVICE_ROLE 키로 접속해 RLS를 우회하고 모든 작업을 처리한다.
-- =========================================================================

-- 업로드 자산 + 후처리 결과/상태.
create table if not exists public.proof_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  source_path   text not null,                       -- media 버킷 기준 원본 경로 (<uid>/<kind>/<uuid>.<ext>)
  kind          text check (kind in ('doits', 'pages')),   -- 업로드 맥락 (기존 업로드 kind와 정합)
  status        text not null default 'uploaded'
                  check (status in ('uploaded', 'processing', 'ready', 'failed')),
  -- 후처리로 채워지는 메타데이터
  content_type  text,
  size_bytes    bigint,
  width         int,
  height        int,
  checksum      text,                                -- sha256 등. 중복 탐지에 사용
  thumb_path    text,                                -- 생성된 썸네일 경로 (파생물)
  -- 실패 정보
  error_code    text,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 사용자별 상태 조회 (admin/대시보드, 예: 내 failed 자산)
create index if not exists proof_assets_user_status_idx
  on public.proof_assets (user_id, status, created_at desc);

-- 중복 탐지용 체크섬 조회 (사용자 범위 내 동일 파일 찾기)
create index if not exists proof_assets_checksum_idx
  on public.proof_assets (user_id, checksum);

-- 비동기 작업 큐 (asset 1건당 후처리 작업).
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references public.proof_assets(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,  -- RLS·필터용 비정규화
  type          text not null default 'process_image',
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  attempts      int  not null default 0,
  max_attempts  int  not null default 3,
  run_after     timestamptz not null default now(),  -- 재시도 백오프 시점
  locked_at     timestamptz,                          -- 워커가 집어간 시각
  locked_by     text,                                 -- 워커 식별자
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 폴링 핵심 인덱스: 실행 대기(pending) 중 run_after 도달분만 빠르게 조회
create index if not exists jobs_pending_idx
  on public.jobs (run_after)
  where status = 'pending';

-- 적체/지표 측정용 (queue_depth = pending 개수)
create index if not exists jobs_status_idx
  on public.jobs (status, created_at);

-- updated_at 트리거 (위에서 정의한 touch_updated_at 재사용)
drop trigger if exists proof_assets_touch on public.proof_assets;
create trigger proof_assets_touch
  before update on public.proof_assets
  for each row execute function public.touch_updated_at();

drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- RLS: 소유자만 자기 행 조회/관리. worker는 service_role로 우회.
alter table public.proof_assets enable row level security;
drop policy if exists "proof_assets owner-only" on public.proof_assets;
create policy "proof_assets owner-only" on public.proof_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.jobs enable row level security;
drop policy if exists "jobs owner-only" on public.jobs;
create policy "jobs owner-only" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- claim_job : 워커가 안전하게 다음 작업 1건을 선점 (동시성 안전).
--   FOR UPDATE SKIP LOCKED 로 여러 worker가 같은 job을 잡지 않게 한다.
--   SECURITY DEFINER 이지만 아래 grant로 service_role(워커)만 호출 가능.
create or replace function public.claim_job(p_worker text)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
begin
  select * into v_job
  from public.jobs
  where status = 'pending' and run_after <= now()
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.jobs
  set status     = 'processing',
      attempts   = attempts + 1,
      locked_at  = now(),
      locked_by  = p_worker
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

-- 함수는 기본적으로 PUBLIC에 EXECUTE가 부여되므로 회수하고, 워커(service_role)에만 허용.
-- anon/authenticated 사용자가 큐를 선점/조작하지 못하게 한다.
revoke all on function public.claim_job(text) from public;
grant execute on function public.claim_job(text) to service_role;

-- 자산이 생성되면 후처리 job 1건을 자동 enqueue (asset:job = 1:1 보장, 원자적).
--   클라이언트는 proof_assets만 insert하고, job 생성은 DB가 책임진다.
--   SECURITY DEFINER로 jobs RLS를 우회해 항상 enqueue된다.
create or replace function public.enqueue_proof_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.jobs (asset_id, user_id, type)
  values (new.id, new.user_id, 'process_image');
  return new;
end;
$$;

drop trigger if exists proof_assets_enqueue on public.proof_assets;
create trigger proof_assets_enqueue
  after insert on public.proof_assets
  for each row execute function public.enqueue_proof_job();
