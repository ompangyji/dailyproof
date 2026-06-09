# docs → Notion 동기화 설계 메모

`docs/`를 source of truth로 두고, `git push` 시 GitHub Actions가 `docs/**` 변경분을 Notion으로 **단방향 동기화**하는 구조.
Notion은 작성 원본이 아니라 **공유/열람 채널**이다(원본 수정은 항상 repo에서).

기준일: 2026-06-10 · 상태: **구현 완료(로컬 검증)** — 스크립트 `scripts/notion-sync.mjs`, 워크플로 `.github/workflows/notion-sync.yml`

---

## 1. 원칙

- **단방향**: repo(`docs/`) → Notion. 반대 방향 동기화는 하지 않는다(충돌 방지, source of truth 유지).
- **트리거 범위 한정**: `main` 브랜치 push 중 `docs/**`가 바뀐 경우에만 실행.
- **멱등**: 같은 문서를 다시 sync하면 새 페이지를 만들지 않고 **기존 Notion 페이지의 본문만 교체**한다.
- **배포와 분리**: Notion sync 실패가 앱 배포 파이프라인을 막지 않는다(별도 workflow, 비차단).
- **시크릿 비노출**: Notion 토큰은 GitHub Secrets로만 주입, repo에 커밋하지 않는다.

---

## 2. 흐름

```mermaid
flowchart LR
    dev[로컬에서 docs 편집] -->|git push| gh[GitHub main]
    gh -->|push: docs/**| gha[GitHub Actions<br/>notion-sync]
    gha -->|변경 .md 탐지| script[notion-sync.mjs]
    script -->|Notion API upsert| notion[(Notion 부모 페이지)]
```

---

## 3. 페이지 매핑 전략 (폴더 구조 미러링)

`docs/` 트리를 부모 페이지(`NOTION_PARENT_PAGE_ID`) 아래에 **중첩 구조로 미러링**한다.

- 폴더 → **컨테이너 페이지**, 파일 → 그 안의 **잎 페이지**.
  - 예) `architecture/current-state.md` → `architecture`(폴더 페이지) / `current-state`(문서 페이지)
- 페이지 제목 = 폴더명 또는 파일명(확장자 제외). **제목이 매칭 키**다.
- **상태 파일 없이(stateless) 매핑**: 매 실행 시 각 부모 페이지의 `child_page` 목록을 조회해 제목으로 기존 페이지를 찾는다. 있으면 갱신, 없으면 생성. → CI에서 별도 매니페스트/커밋백이 필요 없다.
- 갱신 시 **문서(잎) 페이지의 본문 블록만 교체**한다. 폴더 페이지는 "없으면 생성"만 하고 손대지 않아 하위 문서가 보존된다.

> 제목이 source of truth이므로, Notion에서 **페이지 제목을 직접 바꾸면 다음 sync 때 중복 페이지가 생긴다.** 이모지·아이콘 등 본문 외 꾸미기는 안전하다(본문 블록만 교체하므로 페이지 속성은 유지).

---

## 4. 마크다운 → Notion 변환

- Notion API는 마크다운을 그대로 받지 않고 **블록(blocks) 구조**로 변환해야 한다.
- 변환기는 **직접 구현**(`notion-sync.mjs` 내 라인 기반 파서). 외부 변환 라이브러리(`@tryfabric/martian` 등)는 로컬 환경(WSL `/mnt/d`)의 chmod 제약으로 설치가 막혀, 의존성을 `@notionhq/client` 하나로 최소화했다.
- 지원: 헤딩, 문단, **굵게**·`코드`·링크, 글머리/번호 목록, 체크박스, 인용, 표, 코드블록, 구분선.
- **Mermaid**: Notion이 네이티브 렌더링하지 않으므로 코드블록(` ```mermaid `)으로 **보존**한다(이미지 변환은 하지 않음).

---

## 5. 인증 / 시크릿

| 키 | 용도 | 출처 |
|----|------|------|
| `NOTION_TOKEN` | Notion Internal Connection 토큰(`ntn_...`) | GitHub Secrets / 로컬 env |
| `NOTION_PARENT_PAGE_ID` | 미러링 루트 페이지 ID(32자리) | GitHub Secrets / 로컬 env |

- Notion에서 **Internal Connection** 생성(워크스페이스 전용·최소 권한) → 대상 부모 페이지의 Connections에 추가(권한 부여).
- 토큰은 절대 repo/로그에 노출하지 않는다.

---

## 6. 워크플로

`.github/workflows/notion-sync.yml`:

- `on: push` + `paths: ['docs/**']` + `branches: [main]`
- `NOTION_TOKEN` 미설정 시 sync 단계 skip (시크릿 등록 전/포크에서 실패 방지).
- `git diff`로 직전 커밋 대비 **변경된 `docs/**/*.md`만** 스크립트에 전달.
- `concurrency`로 중복 실행 취소(최신 push만 반영).

로컬 실행: `NOTION_TOKEN=... NOTION_PARENT_PAGE_ID=... npm run notion:sync [파일...]`

---

## 7. 미결 사항

- **삭제 동기화**: repo에서 문서를 지웠을 때 Notion 페이지를 archive할지 — 현재 미구현(수동 정리).
- 큰 문서의 블록/요청 수 최적화(현재는 변경 파일 전체 본문 재작성).
- (결정됨) 매핑은 stateless child_page 조회 방식 / Mermaid는 코드블록 보존.
