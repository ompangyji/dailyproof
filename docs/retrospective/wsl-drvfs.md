# 회고 — WSL/drvfs 환경 제약 트러블슈팅

소스를 `/mnt/d`(WSL의 Windows 마운트, drvfs)에 둔 채 작업하며 파일 권한·줄바꿈·빌드에서 반복해 막힌 지점과 푼 과정을 정리한다. 각 항목은 **증상 → 시도/가설 → 원인 → 해결 → 교훈** 순. (구체 작업 기록은 `worklog.md`, 절차는 `runbooks/`.)

<!-- 개인 소감은 여기에 -->

---

## 1. `git config` 쓰기가 chmod 제약으로 막힘

- **증상**: 커밋 author가 전역 설정값(`Backend API Agent`)으로 찍히고 있어 본인으로 바꾸려 `git config user.name/email`을 실행했는데, drvfs에서 설정 파일을 갱신하지 못하고 실패.
- **시도/가설**: 평소처럼 `git config`로 로컬 설정을 덮어쓰면 될 줄 알았으나, drvfs는 chmod 계열 동작을 제대로 지원하지 않아 git이 설정 파일을 쓰는 과정에서 막혔다.
- **원인**: `/mnt/d`는 Windows 파일시스템 위의 drvfs라 유닉스 퍼미션(chmod)을 제대로 못 건다. `git config`가 임시 파일 생성·권한 변경을 거치는데 그 단계가 거부된다.
- **해결**: `.git/config`의 `[user]` 섹션을 **직접 편집**해 author를 본인(`ompangyji <ompangyji@gmail.com>`)으로 설정.
- **교훈**: drvfs에서 권한을 건드리는 도구 동작은 막힐 수 있다. 막히면 도구를 우회해 **설정 파일을 직접 편집**하는 게 가장 빠르다. (author가 본인이 아니면 Vercel 프리뷰 빌드가 거부되고 GitHub 기여로도 안 잡히므로 교정이 필요했다.)

---

## 2. 외부 변환 라이브러리 설치 실패 (chmod)

- **증상**: Notion sync 변환기를 만들며 마크다운→Notion 변환 라이브러리(martian 등)를 설치하려는데, `npm install` 단계에서 chmod 제약으로 실패.
- **원인**: drvfs에서 일부 패키지 설치 시의 권한 설정 단계가 거부된다.
- **해결**: 외부 변환 라이브러리에 의존하지 않고 의존성을 `@notionhq/client` 하나로 줄인 뒤 변환기를 **직접 구현**했다. (이후 worker·resilience·logger도 같은 사상으로 네이티브/무거운 의존성을 피하고 순수 JS로 작성.)
- **교훈**: 환경 제약이 의존성 선택을 바꿨다. 무거운/네이티브 의존성을 피하고 가볍게 직접 구현하면 환경 함정도 줄고 산출물도 슬림해진다. 같은 이유로 이미지 차원 파싱(PNG IHDR·JPEG SOF)도 sharp 없이 직접 짰다.

---

## 3. CRLF/LF 유령 diff

- **증상**: 내용을 바꾸지 않은 파일이 git에서 통째로 변경된 것처럼 잡힘(diff에 의미 있는 변화가 없는데 줄마다 바뀐 것으로 표시).
- **원인**: Windows 마운트(drvfs)를 거치며 줄바꿈이 CRLF로 바뀌어, 저장소의 LF 기준과 어긋나 모든 줄이 "변경"으로 잡혔다.
- **해결**: `core.autocrlf=input`을 설정 — 커밋 시 CRLF를 LF로 정규화하고 체크아웃 시엔 변환하지 않게 해, 저장소를 LF로 통일.
- **교훈**: "내용은 그대로인데 전부 바뀐 diff"는 줄바꿈 문제다. 윈도우/WSL 혼용 환경에선 **줄바꿈 정규화 정책(`autocrlf=input`)** 을 일찍 깔아 유령 diff와 그로 인한 무의미한 충돌을 막는다.

---

## 4. `next build`·`terraform init`의 `EPERM`/chmod — drvfs 전용 현상

- **증상**: `next build`가 `EPERM copyfile`(`_not-found.html`→`pages/404.html`)로 중단됨. Terraform도 `terraform init`이 drvfs chmod 제약으로 막힘.
- **시도/가설**: 처음엔 코드/설정 문제로 의심(OTel 도입 직후라 그 영향인가). 하지만 에러가 **권한 복사** 단계에서 나는 점이 단서였다.
- **원인**: drvfs가 빌드 산출물 복사·권한 설정을 거부하는 환경 전용 현상이다. 리눅스 네이티브 파일시스템(컨테이너 빌드 포함)에서는 발생하지 않는다.
- **해결**: 소스를 **WSL 네이티브 경로로 옮겨 빌드/검증**하니 `next build`가 성공(exit 0, `.next/standalone/server.js`·static 9/9 생성)하고 `terraform init/validate`도 통과했다. 실제 컨테이너 빌드는 리눅스 fs라 영향 없음.
- **교훈**: 에러 메시지에서 `EPERM`/`copyfile`/`chmod`가 보이면 코드가 아니라 **drvfs를 먼저 의심**한다. "윈도우 마운트에서만 나는 현상"임을 가르는 검증법은 **네이티브 경로에서 같은 명령을 돌려보는 것**이다(거기서 되면 코드는 무죄).

---

## 5. cwd 잔존으로 pathspec 실패

- **증상**: docs push 시 Notion sync 워크플로가 최상위 `docs/` 문서를 빠뜨리고 동기화함(변경 파일 산출 누락).
- **원인**: 변경 파일을 고르는 pathspec이 디렉토리 기준이라 최상위 문서가 매칭에서 누락됐고, 다중 커밋 push에선 얕은 fetch로 `before..sha` diff가 불안정했다.
- **해결**: pathspec을 `:(glob)docs/**/*.md`로 교정해 최상위 문서까지 잡고, `fetch-depth: 0`으로 diff를 안정화. 첫 push·`before` 미존재·수동 실행 시엔 docs 전체를 동기화하도록 보강(`workflow_dispatch` 추가).
- **교훈**: "일부 경로만 누락"은 pathspec 글롭 규칙을 의심한다. CI에서 커밋 범위 diff를 쓰려면 **얕은 체크아웃의 한계**(다중 커밋·첫 push)를 먼저 메운다. drvfs와 직접 관계는 없지만, 경로/작업 위치 가정이 깨지면 조용히 누락된다는 같은 교훈.

---

## 전체적으로 배운 것

- `/mnt/d`(drvfs)는 **chmod·권한 복사**가 안 되는 게 핵심 제약이다 — git config 쓰기, 일부 npm 설치, `next build` 복사, `terraform init`이 모두 여기서 막혔다.
- 두 갈래로 푼다: (1) 막힌 도구를 **우회**(설정 파일 직접 편집), (2) **WSL 네이티브 경로**로 옮겨 실행.
- 환경 제약이 **설계 선택**까지 바꿨다 — 무거운/네이티브 의존성을 피하고 순수 JS로 직접 구현하는 방향으로 정착.
