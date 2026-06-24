# 보안 기본기 체크리스트 (4.10)

업로드·API·공개 표면에 적용한 보안 통제를 한곳에 모은 점검표. 각 항목을 **어느 층에서 막는지**(클라이언트 / API / DB / Storage)와 근거·자료로 정리한다. 보안은 단일 게이트가 아니라 여러 층의 합이므로, "어디서 막히나"를 같이 본다.

> **방어 계층(defense in depth)**: 클라이언트 검증은 UX·빠른 피드백용(우회 가능), 진짜 게이트는 서버(API)·DB·Storage다. 한 층이 뚫려도 다음 층이 막도록 겹쳐 둔다.

## 점검표

| 항목 | 통제(어느 층) | 상태 | 근거 / 자료 |
|---|---|---|---|
| **MIME 검증** | Storage 버킷 `image/*` 강제(Storage) + content_type zod 검증(API) + 클라 `file.type`(UX) | ✅ | `152`(버킷) · `148`(API) |
| **파일 크기 제한** | 버킷 8MB(Storage) + `proof_assets_size_chk`(DB) + zod `≤8MB`(API) + 클라 8MB(UX) | ✅ | `152`(버킷) |
| **확장자/경로 검증** | source_path 형식·확장자 sanitize(클라) + **소유 경로 검증**(API, 403) | ✅ | `146`·`149` |
| **권한 경계** | 미들웨어 로그인 강제 + 테이블 RLS owner-only + admin RPC `is_admin()` 재검증 + media RLS read-own | ✅ | `#49` 감사 · [public-url-exposure](public-url-exposure.md) |
| **입력 검증** | zod 스키마로 shape 검증(API, 400+필드별 details) | ✅ | `148`·`149` · [input-validation](../retrospective/input-validation.md) |
| **rate limiting** | grass IP 60/분 · proof-assets uid 30/분, 초과 429+Retry-After(API) | ✅ | `150`·`151` · [rate-limit](rate-limit.md) |
| **공개 URL 오남용** | media 세션 인가(매 요청 RLS) · grass 토큰 96비트·검증 24 hex·집계만 노출 | ✅ | [public-url-exposure](public-url-exposure.md) |
| **스캐닝/공급망** | trivy·gitleaks·CodeQL·Dependabot·SBOM, hard gate(CI) | ✅ | [findings-triage](findings-triage.md) · [retro](../retrospective/security-scanning.md) |
| **런타임 하드닝** | readOnlyRootFilesystem·seccomp·non-root·drop ALL caps(컨테이너/k8s) | ✅ | securityContext |
| **보안 이벤트 모니터링** | 보안 거부(401/403/429) 메트릭+알림 | ✅ | `src/lib/security-events.ts`·`monitoring.yaml` |
| **admission control(Kyverno)** | securityContext·태그 정책을 admission에서 강제 | ✅ | `deploy/kyverno/` (상세 [admission-control](admission-control.md)) |

## 항목별 메모 (무엇을·어디서)

- **업로드 경로의 이중·삼중 방어**: 같은 제약(이미지·8MB)을 **클라(UX) → API(zod) → DB constraint → Storage 버킷** 네 층에 반복. 클라를 우회해도 API가, API를 우회해도 Storage가 막는다. 진짜 우회 불가 게이트는 **Storage 버킷 설정**(`152`).
- **source_path 소유 검증이 핵심**: API guard가 source_path를 본인 uid 폴더로 강제(403). 이게 없으면 타인 경로를 등록해 worker(service_role)가 RLS 우회로 처리하는 교차 사용자 노출이 가능했다([input-validation](../retrospective/input-validation.md)).
- **공개 표면은 grass 하나뿐**: 나머지는 미들웨어가 로그인을 강제. grass는 capability 토큰(96비트)+rate limit+집계-only로 통제.
- **rate limit은 노출도 기준 선별**: 공개(grass)=IP, 인증(proof-assets)=uid. media·login은 각각 RLS·Supabase 자체 통제로 위임([rate-limit](rate-limit.md)).

## 잔여 위험 / 후속

- **service_role 키 rotation** — 과거 노출 이력이 있는 키는 회전 필요(운영 액션).
- **grass 토큰 rotate** — 명시적 회전 기능 부재, 현재는 `enabled=false`/재생성으로 무효화.
- **분산 rate limit** — 현재 in-memory(per-pod·재시작 초기화) → 다중 pod 환경에선 edge(Traefik)/Redis로 전환 필요.
- **egress 보호** — media 대량 다운로드는 CDN 단계 과제([cost](../architecture/cost.md)·[scaling](../architecture/scaling.md)).
