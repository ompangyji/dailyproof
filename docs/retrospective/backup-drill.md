# 회고: 첫 recovery drill (backup → restore → verify)

백업·복구 문서를 "쓰기만" 하지 않고 **실제로 한 번 복원해 보자**(테스트 안 한 백업은 백업이 아니다)에서 출발한 drill. 두 군데서 막혔고, 두 번째는 "막힌 게 아니라 내가 출력을 오해한" 것이었다. 그 과정과 이해를 남긴다.

> 결과 요약: `pg_dump` 전체 백업(229K) → 빈 postgres에 복원 → 복원본 `proof_assets·jobs = 7/7` = 원본 `7/7` 일치. 절차·결과는 [runbooks/backup-recovery.md](../runbooks/backup-recovery.md), 여기선 *막힌 지점·이해·교훈*만.

## 막힌 지점 ① — DB 연결이 안 됨 (IPv6)

**증상**
```
pg_dump: error: connection to server at "db.tekcl...supabase.co"
(2406:da18:...), port 5432 failed: Network is unreachable
```

**원인**: Supabase **직접 연결**(`db.<ref>.supabase.co`)은 **IPv6 전용**이다. 내 WSL/네트워크엔 IPv6 경로가 없어 그 주소로는 아예 닿지 못했다(무료 티어는 직접 연결용 IPv4를 따로 주지 않음).

**해결**: 직접 연결 대신 **Session pooler**(IPv4) 주소를 썼다 — 호스트가 `aws-0-<region>.pooler.supabase.com`, 사용자가 `postgres.<ref>` 형태. pg_dump는 세션 연결이 필요하므로 transaction pooler(6543) 말고 **session pooler(5432)**.

**교훈**: 관리형 DB의 "연결 문자열"은 한 종류가 아니다(직접/세션 풀러/트랜잭션 풀러). **내 네트워크가 IPv4뿐이면 pooler**, 용도(세션 vs 트랜잭션)에 맞는 포트를 골라야 한다. 에러의 `(2406:...)`가 IPv6라는 걸 알아채는 게 핵심이었다.

## 막힌 지점 ② — "전부 실패한 줄 알았다"

**증상**: 복원 명령을 돌리니 화면에 에러만 잔뜩 떴다.
```
ERROR: extension "supabase_vault" is not available
ERROR: role "authenticated" does not exist   (x4)
WARNING: "wal_level" is insufficient ...
```
복원이 다 깨진 것처럼 보였다.

**원인 (두 가지가 겹침)**
1. **성공 출력을 내가 버렸다** — 명령 끝에 `>/dev/null`을 붙여 **stdout(성공 메시지: `CREATE TABLE`, `COPY 7` …)을 폐기**했다. 화면에 남는 건 stderr(에러·경고)뿐 → "성공은 조용하고 에러만 보이는" 착시.
2. **에러는 의도적으로 무시하게 해뒀다** — `ON_ERROR_STOP=0`이라 **실패한 줄은 건너뛰고 계속 실행**. 그 실패 줄들은 전부 **Supabase 관리형 전용 객체**(vault 확장, `authenticated`/`anon` 역할, 그 역할에 걸린 RLS grant)라 vanilla postgres엔 없어서 난 것. 우리 앱 테이블·데이터 줄은 그 사이에서 멀쩡히 실행됐다.

**검증**: 의심을 끝낸 건 로그가 아니라 **행 수**였다 — 복원본 `7/7` = 원본 `7/7`. 주입이 실패했다면 0이었을 것.

**교훈**: **에러의 가시성 ≠ 실패의 양.** `>/dev/null`로 성공을 숨기면 화면이 실제보다 비관적으로 보인다. 복원 같은 작업은 **로그 인상이 아니라 결과(행 수·체크섬)로 판정**해야 한다. 그리고 `ON_ERROR_STOP=0`은 "에러 무시"가 아니라 "**예상된 실패를 통과시키고 본질만 본다**"는 의도적 선택이었다는 걸, 어떤 에러가 떠야 정상인지 미리 알고 있어야 안심할 수 있다.

## 개념 이해 — "빈 DB에 어떻게 주입됐나"

헷갈렸던 지점: 백업을 "데이터 덩어리"로 상상해서 "빈 DB에 부었다"가 마법처럼 느껴졌다. 실제는 단순하다.

- `backup.sql`은 **SQL 명령이 적힌 텍스트 스크립트**다 — `CREATE TABLE public.jobs (...)`, 이어서 `COPY public.jobs ... FROM stdin;` + 데이터 행들.
- 복원 = `cat backup.sql | psql` → **`psql`이 그 명령들을 빈 DB에 한 줄씩 다시 실행(replay)**. `CREATE TABLE`이면 테이블이 생기고, `COPY`/`INSERT`면 행이 들어간다.
- 비유: 백업=레시피, 빈 postgres=빈 주방, psql=레시피대로 만드는 요리사, 파이프=레시피를 건네는 손. 같은 레시피니 같은 요리(=같은 데이터)가 나온다.

즉 "주입"은 복사가 아니라 **명령의 재생**이다.

## 발견 — 관리형 종속성은 데이터와 분리해서 봐야 한다

vanilla postgres로의 복원에서 **관리형 전용 객체(vault·역할·RLS grant)는 복원되지 않고, 순수 앱 데이터(public 스키마)는 그대로 복원**됐다. 시사점: 다른 환경으로 **이전/복구할 때 "데이터 복원"과 "플랫폼 종속 객체(역할·확장·RLS) 재구성"은 별개 단계**다. schema.sql이 구조의 source of truth이므로, 역할·RLS는 그쪽 + 플랫폼 설정으로 재구성하고, 데이터는 덤프로 복원하는 두 트랙으로 봐야 한다.

## 교훈 종합

- **테스트 안 한 백업은 백업이 아니다** — 실제 복원까지 돌려야 "복구된다"를 말할 수 있다.
- **관리형 연결은 IPv6/풀러를 구분** — 에러의 IP 형태(IPv6 `2406:`)가 단서.
- **결과로 판정, 로그 인상으로 판정하지 않기** — `>/dev/null`·`ON_ERROR_STOP=0`의 의미를 알고 행 수로 검증.
- **데이터 ≠ 플랫폼 종속 객체** — 복구 시 두 트랙으로 분리.

자료: `142-backup-pgdump-created`(백업) · `143/144-backup-restore/source-rowcount`(7/7 일치) · `145-backup-restore-managed-skipped`(관리형 객체 스킵 에러 화면).
