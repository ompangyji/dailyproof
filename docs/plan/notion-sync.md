# docs → Notion 동기화 설계 메모

`docs/`를 source of truth로 두고, `git push` 시 GitHub Actions가 `docs/**` 변경분을 Notion으로 **단방향 동기화**하는 구조의 설계.
Notion은 작성 원본이 아니라 **공유/열람 채널**이다(원본 수정은 항상 repo에서).

기준일: 2026-06-09 · 상태: 설계 + workflow 초안 (스크립트 구현은 추후)

---

## 1. 원칙

- **단방향**: repo(`docs/`) → Notion. 반대 방향 동기화는 하지 않는다(충돌 방지, source of truth 유지).
- **트리거 범위 한정**: `main` 브랜치 push 중 `docs/**`가 바뀐 경우에만 실행.
- **멱등**: 같은 문서를 다시 sync하면 새 페이지를 만들지 않고 **기존 Notion 페이지를 갱신**한다.
- **배포와 분리**: Notion sync 실패가 앱 배포 파이프라인을 막지 않는다(별도 workflow, 비차단).
- **시크릿 비노출**: Notion 토큰은 GitHub Secrets로만 주입, repo에 커밋하지 않는다.

---

## 2. 흐름

```mermaid
flowchart LR
    dev[로컬에서 docs 편집] -->|git push| gh[GitHub main]
    gh -->|push: docs/**| gha[GitHub Actions<br/>notion-sync]
    gha -->|변경 .md 탐지| script[sync 스크립트]
    script -->|Notion API upsert| notion[(Notion 공유 페이지)]
```

---

## 3. 페이지 매핑 전략

문서 파일 ↔ Notion 페이지의 1:1 매핑을 유지해야 멱등 갱신이 된다.

- 부모 페이지 하나(`NOTION_PARENT_PAGE_ID`) 아래에 `docs/` 트리를 미러링.
- 파일 경로 → 페이지 제목 규칙: 예) `architecture/current-state.md` → "architecture / current-state".
- 매핑 보관 방법(택1, 구현 시 결정):
  - (A) **매니페스트 파일**(`docs/.notion-map.json`)에 `파일경로 → pageId` 저장. 단순·명시적.
  - (B) Notion 페이지 속성에 파일 경로를 키로 저장하고 검색. 외부 파일 불필요하나 조회 비용.
- 1순위: (A) 매니페스트. sync 스크립트가 새 문서면 페이지 생성 후 매핑 추가, 기존 문서면 해당 pageId 갱신.

---

## 4. 마크다운 → Notion 변환

- Notion API는 마크다운을 그대로 받지 않고 **블록(blocks) 구조**로 변환해야 한다.
- 라이브러리: `@notionhq/client` + 마크다운→블록 변환기(예: `@tryfabric/martian` 류).
- **한계**: Mermaid 다이어그램은 Notion이 네이티브로 렌더링하지 않음 → 코드 블록(```mermaid)으로 보존하거나, 이미지로 변환해 첨부(추후 결정). 표·코드·체크박스는 변환 가능.

---

## 5. 인증 / 시크릿

| 키 | 용도 | 출처 |
|----|------|------|
| `NOTION_TOKEN` | Notion 통합(Internal Integration) 토큰 | GitHub Secrets |
| `NOTION_PARENT_PAGE_ID` | 미러링 루트 페이지 ID | GitHub Secrets 또는 Variables |

- Notion에서 Internal Integration 생성 → 대상 페이지에 integration 초대(권한 부여).
- 토큰은 절대 repo/로그에 노출하지 않는다.

---

## 6. 워크플로 초안

`.github/workflows/notion-sync.yml` (초안). 실제 sync 스크립트(`scripts/notion-sync.mjs`)는 추후 구현하며, 그 전까지는 시크릿 부재 시 **조용히 skip**해 실패하지 않도록 한다.

핵심 설계:

- `on: push` + `paths: ['docs/**']` + `branches: [main]`
- `NOTION_TOKEN` 미설정 시 스크립트 호출 전에 skip (PR/포크에서 실패 방지).
- `concurrency`로 중복 실행 취소(최신 push만 반영).

---

## 7. 미결 사항 (구현 단계에서 확정)

- 매핑 보관 방식 (A 매니페스트 vs B 속성) 최종 선택.
- Mermaid 처리(코드 블록 보존 vs 이미지 변환).
- 삭제 동기화: repo에서 문서를 지웠을 때 Notion 페이지를 archive할지 여부.
- sync 스크립트(`scripts/notion-sync.mjs`) 구현.
