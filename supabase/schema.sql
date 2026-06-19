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
-- 서버측 강제: 비공개 + 8MB 상한 + image/* 만 허용.
-- 클라이언트 JS 검증(upload.ts)을 우회해 직접 업로드해도 Storage API가 거부한다
-- (용량·MIME의 신뢰 가능한 게이트).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 8388608, array['image/*'])
on conflict (id) do update set
  public             = false,
  file_size_limit    = 8388608,            -- 8 * 1024 * 1024
  allowed_mime_types = array['image/*'];

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
  trace_id      text,                                -- 업로드 시 web이 부여하는 추적 id (web→worker 로그 상관)
  traceparent   text,                                -- W3C traceparent (OpenTelemetry span 부모 컨텍스트, web→worker)
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

-- 기존 테이블에도 trace_id 추가(멱등). web→worker 로그 상관용.
alter table public.proof_assets add column if not exists trace_id text;
-- W3C traceparent(OpenTelemetry span 부모 컨텍스트) 추가(멱등). web→worker span 전파용.
alter table public.proof_assets add column if not exists traceparent text;

-- 사용자별 상태 조회 (admin/대시보드, 예: 내 failed 자산)
create index if not exists proof_assets_user_status_idx
  on public.proof_assets (user_id, status, created_at desc);

-- 중복 탐지용 체크섬 조회 (사용자 범위 내 동일 파일 찾기)
create index if not exists proof_assets_checksum_idx
  on public.proof_assets (user_id, checksum);

-- 기록된 자산 메타데이터 불변식(DB 강제): content_type은 image 계열, size는 8MB 이하.
-- storage 버킷 제한과 짝이 되는 record-level 검증(멱등하게 재정의).
alter table public.proof_assets drop constraint if exists proof_assets_content_type_chk;
alter table public.proof_assets add constraint proof_assets_content_type_chk
  check (content_type is null or content_type like 'image/%');
alter table public.proof_assets drop constraint if exists proof_assets_size_chk;
alter table public.proof_assets add constraint proof_assets_size_chk
  check (size_bytes is null or size_bytes <= 8388608);

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

-- 메트릭 스냅샷: jobs/proof_assets의 상태별 전역 카운트(집계만 반환, 원본 행 비노출).
-- /metrics 가 anon으로 호출하므로 SECURITY DEFINER로 RLS를 우회한다(get_grass와 동일 패턴).
create or replace function public.metrics_snapshot()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'jobs', (
      select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
      from (select status, count(*)::int c from public.jobs group by status) j
    ),
    'assets', (
      select coalesce(jsonb_object_agg(status, c), '{}'::jsonb)
      from (select status, count(*)::int c from public.proof_assets group by status) a
    ),
    -- 최근 done job 100건의 처리 시간(claim locked_at → done updated_at) 평균 초.
    -- locked_at 기준이라 큐 대기 시간은 제외한 '순수 처리 시간' 근사. 정식 histogram은 [추후].
    'job_processing_seconds_avg', (
      select coalesce(round(avg(extract(epoch from (updated_at - locked_at)))::numeric, 3), 0)
      from (
        select locked_at, updated_at from public.jobs
        where status = 'done' and locked_at is not null order by updated_at desc limit 100
      ) d
    )
  );
$$;

-- /metrics(anon)에서 호출. 집계만 노출하므로 anon 허용.
grant execute on function public.metrics_snapshot() to anon, authenticated;

-- ============================================================================
-- admin ops : 운영용 권한 모델 + 관리 함수 (실패/stuck job 조회·재처리·orphan 파일)
--   원칙(최소권한): web에 service_role(god-mode 키)을 두지 않는다. 대신
--     ① user_roles 로 관리자를 식별하고
--     ② 권한이 필요한 작업은 SECURITY DEFINER 함수로 묶되 함수 내부에서 is_admin()을
--        재검증한다(앱 레이어만 믿지 않음 = defense in depth). 일반 테이블 RLS는 owner-only 유지.
--     ③ 변경(재처리 등)은 admin_audit 에 누가·언제·무엇을 기록한다.
-- ============================================================================

-- 1) 역할 테이블 + 관리자 판별 -------------------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.user_roles enable row level security;
-- 사용자는 자기 역할만 조회 가능. 부여/회수는 SQL(service_role)로만 — insert/update 정책 없음 → 차단.
drop policy if exists "user_roles self-read" on public.user_roles;
create policy "user_roles self-read" on public.user_roles
  for select using (auth.uid() = user_id);

-- 현재 호출자가 admin인지. SECURITY DEFINER 로 user_roles RLS를 우회해 직접 조회한다
-- (RLS 재귀 회피). auth.uid()는 definer여도 '호출자' 기준으로 유지된다.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

-- 2) 감사 로그 (권한 작업 추적) ------------------------------------------------
create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  actor      uuid not null,            -- 수행한 관리자 (auth.uid())
  action     text not null,            -- 예: 'requeue_job'
  target     text,                     -- 대상 식별자 (job_id 등)
  detail     jsonb,                    -- 부가 정보
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
-- admin만 열람. 쓰기는 SECURITY DEFINER 함수로만 — insert 정책 없음 → 직접 기록 차단.
drop policy if exists "admin_audit admin-read" on public.admin_audit;
create policy "admin_audit admin-read" on public.admin_audit
  for select using (public.is_admin());

-- 3) 관리 함수 (전부 SECURITY DEFINER + 진입 시 is_admin() 재검증) ---------------

-- 실패 job 목록(asset 조인). RLS 우회 → 전체 사용자 범위로 조회한다.
create or replace function public.admin_failed_jobs(p_limit int default 100)
returns table (
  job_id       uuid,
  asset_id     uuid,
  user_id      uuid,
  type         text,
  attempts     int,
  max_attempts int,
  last_error   text,
  asset_status text,
  error_code   text,
  source_path  text,
  updated_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return query
    select j.id, j.asset_id, j.user_id, j.type, j.attempts, j.max_attempts,
           j.last_error, a.status, a.error_code, a.source_path, j.updated_at
    from public.jobs j
    join public.proof_assets a on a.id = j.asset_id
    where j.status = 'failed'
    order by j.updated_at desc
    limit p_limit;
end;
$$;

-- stuck job: processing 인데 locked_at이 p_minutes 이상 지난 것(워커가 죽어 멈춘 것으로 추정).
create or replace function public.admin_stuck_jobs(p_minutes int default 5)
returns table (
  job_id        uuid,
  asset_id      uuid,
  user_id       uuid,
  attempts      int,
  locked_by     text,
  locked_at     timestamptz,
  minutes_stuck numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return query
    select j.id, j.asset_id, j.user_id, j.attempts, j.locked_by, j.locked_at,
           round((extract(epoch from (now() - j.locked_at)) / 60)::numeric, 1)
    from public.jobs j
    where j.status = 'processing'
      and j.locked_at is not null
      and j.locked_at < now() - make_interval(mins => p_minutes)
    order by j.locked_at asc;
end;
$$;

-- 재처리: 실패/stuck job을 다시 pending으로(attempts 리셋·run_after=now·잠금 해제).
-- asset도 재처리 대기('uploaded')로 되돌린다(enqueue 트리거는 insert만 반응하므로 중복 job 안 생김).
-- 누가 무엇을 재처리했는지 admin_audit에 기록한다.
create or replace function public.admin_requeue_job(p_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;

  update public.jobs
  set status = 'pending', attempts = 0, run_after = now(),
      locked_at = null, locked_by = null, last_error = null
  where id = p_job_id
  returning * into v_job;

  if not found then
    raise exception 'job not found: %', p_job_id using errcode = 'no_data_found';
  end if;

  update public.proof_assets
  set status = 'uploaded', error_code = null, error_message = null
  where id = v_job.asset_id;

  insert into public.admin_audit (actor, action, target, detail)
  values (auth.uid(), 'requeue_job', p_job_id::text,
          jsonb_build_object('asset_id', v_job.asset_id));

  return v_job;
end;
$$;

-- orphan: media 버킷에 있으나 어떤 proof_assets(source_path/thumb_path)도 참조하지 않는 파일.
-- (asset insert 실패로 파일만 남았거나, asset 삭제 후 파일이 잔존한 경우 등)
create or replace function public.admin_orphans(p_limit int default 100)
returns table (
  object_name text,
  size_bytes  bigint,
  created_at  timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return query
    select o.name,
           (o.metadata->>'size')::bigint,
           o.created_at
    from storage.objects o
    where o.bucket_id = 'media'
      and not exists (
        select 1 from public.proof_assets a
        where a.source_path = o.name or a.thumb_path = o.name
      )
    order by o.created_at desc
    limit p_limit;
end;
$$;

-- 4) dead-letter : 영구 실패(poison) job 종결 -------------------------------
-- transient 실패는 admin_requeue_job(재처리)로 풀리지만, 원본 파일 없음·손상 같은
-- permanent 실패는 재처리해도 같은 실패가 무한 반복된다. 그런 job을 'dead'로 빼서
-- 재처리 루프(claim_job은 pending만 집음)와 failed 목록에서 제거하고 운영자가 종결한다.
-- 근본 원인이 해소되면 admin_requeue_job 으로 되살릴 수 있다(id로 pending 전환).
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('pending', 'processing', 'done', 'failed', 'dead'));

-- job을 dead로 종결(사유 필수). 사유는 last_error에 남기고 admin_audit에 기록한다.
create or replace function public.admin_dead_letter_job(p_job_id uuid, p_reason text)
returns public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job    public.jobs;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'dead-letter 사유는 필수입니다' using errcode = 'check_violation';
  end if;

  update public.jobs
  set status = 'dead', locked_at = null, locked_by = null,
      last_error = 'dead-letter: ' || v_reason
  where id = p_job_id
  returning * into v_job;

  if not found then
    raise exception 'job not found: %', p_job_id using errcode = 'no_data_found';
  end if;

  insert into public.admin_audit (actor, action, target, detail)
  values (auth.uid(), 'dead_letter', p_job_id::text,
          jsonb_build_object('asset_id', v_job.asset_id, 'reason', v_reason));

  return v_job;
end;
$$;

-- dead job 목록(투명성: 무엇을 왜 포기했는지 운영자가 확인).
create or replace function public.admin_dead_jobs(p_limit int default 100)
returns table (
  job_id     uuid,
  asset_id   uuid,
  user_id    uuid,
  attempts   int,
  last_error text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  return query
    select j.id, j.asset_id, j.user_id, j.attempts, j.last_error, j.updated_at
    from public.jobs j
    where j.status = 'dead'
    order by j.updated_at desc
    limit p_limit;
end;
$$;

-- 함수 권한: 익명 차단, 로그인 사용자만 호출 가능(내부에서 다시 is_admin() 검증).
revoke all on function public.admin_failed_jobs(int)        from public;
revoke all on function public.admin_stuck_jobs(int)         from public;
revoke all on function public.admin_requeue_job(uuid)       from public;
revoke all on function public.admin_orphans(int)            from public;
revoke all on function public.admin_dead_letter_job(uuid, text) from public;
revoke all on function public.admin_dead_jobs(int)          from public;
grant execute on function public.is_admin()                    to authenticated;
grant execute on function public.admin_failed_jobs(int)        to authenticated;
grant execute on function public.admin_stuck_jobs(int)         to authenticated;
grant execute on function public.admin_requeue_job(uuid)       to authenticated;
grant execute on function public.admin_orphans(int)            to authenticated;
grant execute on function public.admin_dead_letter_job(uuid, text) to authenticated;
grant execute on function public.admin_dead_jobs(int)          to authenticated;

-- 관리자 등록(최초 1회, 본인 계정만): SQL editor에서 직접 실행한다(앱으로 부여 불가 — 의도적).
--   insert into public.user_roles (user_id, role)
--   values ('<your-auth-uid>', 'admin') on conflict do nothing;
--   (user_id는 Supabase Authentication > Users 에서 확인)
