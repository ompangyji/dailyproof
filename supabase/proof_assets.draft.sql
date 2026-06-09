-- =========================================================================
-- DailyProof 비동기 후처리 파이프라인 스키마 (초안 / DRAFT)
--
-- 목적: 업로드된 이미지를 worker가 비동기로 후처리(메타데이터·썸네일·해시·
--       중복 탐지)하기 위한 자산 상태 모델(proof_assets)과 작업 큐(jobs).
-- 상태 전이: uploaded -> processing -> ready | failed (failed -> processing 재처리)
--
-- 설계 원칙(기존 schema.sql과 동일):
--   - 멱등/안전 재실행: if not exists, additive, drop+create policy
--   - RLS owner-only (사용자는 자기 자산 상태만 조회)
--   - worker는 SERVICE_ROLE 키로 접속해 RLS를 우회하고 모든 작업을 처리
--   - 큐는 외부 브로커 없이 DB job table + polling (FOR UPDATE SKIP LOCKED)
--
-- 주의: 이 파일은 설계 초안이다. 실제 적용은 컨테이너화·worker 구현 단계에서
--       schema.sql에 통합하거나 마이그레이션으로 반영한다.
-- =========================================================================

create extension if not exists "pgcrypto";

-- -------------------------------------------------------------------------
-- 1. proof_assets : 업로드 자산 + 후처리 결과/상태
-- -------------------------------------------------------------------------
create table if not exists public.proof_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- 원본 스토리지 경로 (media 버킷 기준, 예: <uid>/doits/<uuid>.jpg)
  source_path   text not null,
  -- 업로드 맥락 (기존 업로드 kind와 정합)
  kind          text check (kind in ('doits', 'pages')),
  -- 처리 상태
  status        text not null default 'uploaded'
                  check (status in ('uploaded', 'processing', 'ready', 'failed')),
  -- 후처리로 채워지는 메타데이터
  content_type  text,
  size_bytes    bigint,
  width         int,
  height        int,
  checksum      text,                 -- sha256 등. 중복 탐지에 사용
  thumb_path    text,                 -- 생성된 썸네일 경로 (파생물)
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

-- -------------------------------------------------------------------------
-- 2. jobs : 비동기 작업 큐 (asset 1건당 후처리 작업)
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- 3. updated_at 트리거 (기존 touch_updated_at 재사용)
-- -------------------------------------------------------------------------
drop trigger if exists proof_assets_touch on public.proof_assets;
create trigger proof_assets_touch
  before update on public.proof_assets
  for each row execute function public.touch_updated_at();

drop trigger if exists jobs_touch on public.jobs;
create trigger jobs_touch
  before update on public.jobs
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------------
-- 4. RLS : 소유자만 자기 행 조회/관리. worker는 service_role로 우회.
-- -------------------------------------------------------------------------
alter table public.proof_assets enable row level security;
drop policy if exists "proof_assets owner-only" on public.proof_assets;
create policy "proof_assets owner-only" on public.proof_assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.jobs enable row level security;
drop policy if exists "jobs owner-only" on public.jobs;
create policy "jobs owner-only" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 5. claim_job : 워커가 안전하게 다음 작업 1건을 선점 (동시성 안전)
--    FOR UPDATE SKIP LOCKED 로 여러 worker가 같은 job을 잡지 않게 한다.
--    SECURITY DEFINER 이지만 service_role 워커만 호출하는 전제.
-- -------------------------------------------------------------------------
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

-- 워커(service_role) 전용. anon/authenticated 에는 부여하지 않는다.
-- grant execute on function public.claim_job(text) to service_role;
