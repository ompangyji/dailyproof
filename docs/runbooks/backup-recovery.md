# 백업·복구 (backup & recovery)

데이터가 손상·유실되면 **무엇을 어디서 되살리고, 얼마나 잃고(RPO), 얼마나 걸리나(RTO)**. 그리고 그게 실제로 되는지 **recovery drill로 검증**한 기록.

> **목적(솔직히)**: 지금은 Supabase 무료 티어 + 로컬 k3s라 별도 백업 자동화는 돌고 있지 않고, **Supabase 관리형 백업에 의존**한다. 이 문서는 ① 무엇이 진짜 위험인지 식별하고 ② 백업·복구 전략과 RPO/RTO 가정을 정의하며 ③ **백업→복원→검증을 실제로 한 번 돌려**("테스트 안 한 백업은 백업이 아니다") 복구가 실제로 됨을 증거로 남긴다.

## 무엇이 상태(state)이고 무엇이 재생성되나

이 스택의 핵심 강점: **앱 티어는 stateless·재생성 가능**(Helm/ArgoCD로 재배포), 진짜 상태는 전부 **외부 Supabase**에 있다. 그래서 백업의 초점은 Supabase이고, 클러스터가 통째로 날아가도 상태는 보존된다.

| 구성요소 | 어디 저장 | 유실 시 | 복구 방법 |
|---|---|---|---|
| **앱(web/worker) 이미지·매니페스트** | git + 레지스트리 | 재배포 | Helm/ArgoCD로 재구축(코드가 source of truth) |
| **DB 스키마** | `supabase/schema.sql`(git) | 재적용 | schema.sql 재실행(멱등) |
| **DB 데이터** | Supabase Postgres | **치명적** | 관리형 백업 / `pg_dump` 복원 |
| **업로드 원본 이미지** | Supabase Storage(media) | **치명적·복구 불가** | secondary copy에서 복원(없으면 손실) |
| **파생물**(thumbnail·width·checksum) | DB + Storage | 재생성 가능 | 원본으로 worker 재처리 |

→ 진짜 지켜야 할 것은 **DB 데이터**와 **업로드 원본**. 나머지는 코드·원본에서 재생성된다.

## DB 백업 전략

1. **관리형 백업(기본선)** — Supabase가 일일 백업을 제공(무료 티어는 보존 짧음, **PITR는 유료**). 1차 방어선.
2. **스키마 source of truth** — 구조(테이블·RLS·함수·트리거)는 `supabase/schema.sql`이 git에 버전관리됨 → 어디서든 재적용해 **구조를 즉시 복원**.
3. **논리 백업 보강** — `pg_dump`로 데이터까지 외부에 주기 백업(관리형 보존 한도·실수 삭제 대비). 아래 drill로 실제 검증함.

## 스토리지 유실 대응

- **원본 이미지가 진짜 위험** — 유실되면 코드로 재생성 불가(사용자 업로드물). 대응: **secondary copy**(다른 버킷/리전/제공자로 주기 복제)로 RPO를 정한다. 현재는 미구성 → 정책으로 선언.
- **파생물은 재생성** — thumbnail·width·height·checksum은 원본만 있으면 worker 재처리로 복구.
- **drift 탐지** — DB와 Storage가 어긋나는 두 방향을 점검:
  - *orphan*(파일은 있는데 참조 행 없음) → `/admin/ops`의 orphan 조회.
  - *missing*(행은 있는데 파일 없음) → 아래 쿼리로 탐지, 영향 asset을 `failed` 처리·통지.
  ```sql
  select a.id, a.source_path from public.proof_assets a
  where not exists (
    select 1 from storage.objects o where o.bucket_id = 'media' and o.name = a.source_path
  );
  ```

## RPO/RTO 가정 (포트폴리오 규모)

RPO(허용 데이터 손실)·RTO(복구 목표 시간)를 구성요소별로 가정한다. 실청구 환경에서 수치는 데이터로 확정([후속]).

| 구성요소 | RPO(가정) | RTO(가정) | 근거 |
|---|---|---|---|
| DB 데이터 | 24h (관리형 일일 백업) / PITR 시 분 단위 | ~1h | 백업 복원 + 마이그레이션 재적용 |
| 업로드 원본 | secondary copy 주기에 의존(미구성 시 최신분 손실) | ~1h | 복제본에서 복원 |
| 파생물 | 0 (원본서 재생성) | 분~시간 | worker 재처리 |
| 앱 티어 | 0 (stateless) | 분 | Helm/ArgoCD 재배포 |

## 복구 시나리오

1. **DB 실수 삭제·손상** — 관리형 백업(또는 PITR)로 복원, 없으면 `pg_dump` 논리 백업 복원 + `schema.sql`로 구조 보정.
2. **스토리지 파일 유실** — secondary copy에서 복원. 없으면 위 *missing* 쿼리로 영향 asset 식별 → `failed` 처리·통지, 파생물은 재생성.
3. **클러스터 전체 손실** — 상태는 Supabase(외부)라 보존됨. **Helm/ArgoCD로 앱만 재배포**하면 복구(이 스택의 강점). 시크릿만 재주입.
4. **잘못된 마이그레이션·배포** — 배포는 [rollback.md](rollback.md)로 롤백, 데이터는 영향 테이블만 백업에서 복원.

## recovery drill (실측)

"백업이 실제로 복원되는가"를 한 번 끝까지 돌려 검증했다.

```bash
# ① 백업: 전체 논리 백업(데이터 포함). 연결은 Supabase Session pooler(IPv4) URI 사용.
docker run --rm postgres:17 pg_dump "postgresql://postgres.<ref>:<PW>@<host>.pooler.supabase.com:5432/postgres" \
  --no-owner --no-privileges > backup.sql      # → 229K, INSERT/COPY 57

# ② 복원: 빈 postgres에 부어넣기(관리형 전용 객체 오류는 무시).
docker run -d --name dp-restore -e POSTGRES_PASSWORD=test postgres:17 && sleep 6
cat backup.sql | docker exec -i dp-restore psql -U postgres -v ON_ERROR_STOP=0

# ③ 검증: 복원본 행 수 = 원본 행 수
docker exec dp-restore psql -U postgres -c \
  "select 'proof_assets' t,count(*) from public.proof_assets union all select 'jobs',count(*) from public.jobs;"
docker rm -f dp-restore
```

**결과**: 복원본 `proof_assets=7 · jobs=7` = Supabase 원본 `7 · 7` **일치** → 백업이 데이터 손실 없이 복원됨을 확인.

**drill에서 배운 것**: vanilla postgres로 복원 시 **Supabase 관리형 전용 객체는 복원되지 않는다** — `supabase_vault` 확장, `authenticated`/`anon` 등 역할, 그 역할에 걸린 RLS grant. 즉 **다른 환경으로 이전할 땐 이 객체들을 별도 재생성**해야 하고(역할·확장·RLS), 순수 앱 데이터(public 스키마)는 그대로 복원된다. → DB 데이터 백업/복원과 "플랫폼 종속 객체 재구성"은 분리해서 봐야 한다.

자료: `142-backup-pgdump-created`(백업 산출물) · `143-backup-restore-rowcount`(복원본 7/7) · `144-backup-source-rowcount`(원본 7/7).

## 복구 체크리스트

- [ ] 원인·영향 범위 파악(어느 구성요소? 데이터/스토리지/앱?)
- [ ] DB: 관리형 백업·PITR 가용 시점 확인 → 복원 / 없으면 `pg_dump` 복원 + `schema.sql` 보정
- [ ] 스토리지: secondary copy 복원 / *missing* 쿼리로 영향 asset 식별
- [ ] 앱: 필요 시 Helm/ArgoCD 재배포 + 시크릿 재주입
- [ ] 정합성: orphan·missing 점검, 파생물 재처리(worker)
- [ ] 복원 후 smoke 검증([rollback.md] 체크리스트 재사용)

## 후속

- 실청구 환경에서 PITR·secondary copy를 실제 구성하고 RPO/RTO 수치를 데이터로 확정.
- 업로드 원본의 secondary copy(주기 복제)는 정책으로만 선언된 상태 → 트래픽 환경에서 구성·검증.
- 백업·recovery drill을 주기적으로 반복(백업은 한 번 됐다고 끝이 아니라 계속 검증해야 함).
