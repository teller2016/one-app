---
name: commit
description: 변경사항을 스테이징하고 이 프로젝트 컨벤션(한국어 conventional commit, Claude 서명 없음)으로 커밋한다. 사용법 - /commit 또는 /commit "커밋 메시지"
---

# /commit — 프로젝트 커밋 스킬

현재 변경사항을 검토하고 이 프로젝트 컨벤션에 맞춰 커밋한다.

## 핵심 규칙
- 🚫 **Claude 서명 금지**: 커밋 메시지에 `Co-Authored-By: Claude ...`, `Generated with Claude Code` 같은 문구를 **절대 넣지 않는다.**
- 📝 **한국어 conventional commit**: 제목은 `<type>: <요약>` 형식.
  - `feat`(기능) · `fix`(버그) · `refactor`(리팩터) · `docs`(문서) · `chore`(설정/잡일) · `style`(포맷)
  - 변경이 크면 본문(추가 `-m`)에 요점을 불릿으로 정리.
- 🚫 **푸시하지 않는다**. 사용자가 명시적으로 요청할 때만 `git push`.

## 절차
1. **변경 파악**: `git status --short` 와 `git diff`(스테이징 안 된 것 포함)로 무엇이 바뀌었는지 확인한다.
2. **민감/불필요 파일 점검**: `node_modules/`, `.env`, 계정이 담긴 `settings.json`, 빌드 산출물(`.vite/`, `out/`, `*.app`)이 섞이지 않았는지 확인. 섞였으면 커밋에서 제외하거나 사용자에게 알린다. 커밋 메시지·diff에 실제 비밀번호/토큰이 없는지도 확인.
3. **타입 검사(권장)**: `npx tsc --noEmit` 실행. 오류가 있으면 사용자에게 보고하고 커밋 여부를 확인한다.
   이어서 **변경 파일이 단독 배포판(lite)에 실리는지** 본다 — 경로를 외우지 말고 import 그래프로 판단한다:
   ```bash
   (git diff --name-only HEAD; git ls-files --others --exclude-standard) | xargs node standalone/lite/scripts/reach.mjs --hits
   ```
   실리는 파일이 있으면 **`cd standalone/lite && npm run typecheck`** 도 돌린다(루트 tsc 는 단독판을 보지 않는다).
   `npm test` 도 돌린다 — lite 도달 그래프 테스트가 외부 패키지 누출·버전 불일치를 잡는다.
4. **One App Lite 변경 이력**: 3에서 **실리는 파일이 있었던** 커밋이면
   `standalone/lite/CHANGELOG.md` 의 **`## Unreleased`** 에 받는 사람 말로 **한 줄**(표기 포함)을 **같은 커밋에** 넣는다.
   배포 때 `/release` 가 그 절을 릴리스 노트로 찍는다 — 여기서 안 적으면 배포 시점에 기억을 더듬게 된다.
   - **표기**: `[추가]` 새 기능 · `[변경]` 기존 동작이 달라짐 · `[개선]` 같은 일이 더 잘 됨 · `[수정]` 버그 · `[주의]` 받는 사람이 할 일
     (버전 자리 규칙은 CHANGELOG 머리말 — 표기가 자리를 정하므로 과장하지 않는다)
   - 받는 사람에게 **보이는 변화가 없는** 변경(리팩터·주석·테스트·배포 스크립트·문서)은 넣지 않는다. 애매하면 초안을 보여주고 묻는다.
   - diff 에 이미 Unreleased 줄이 들어 있으면 그대로 넘어간다. 문구는 구현어·파일 이름 금지 — 예: `[수정] 야근 시간 합계가 0시간으로 기입되던 문제를 고쳤습니다`
5. **스테이징**: `git add -A`.
6. **커밋**:
   - 인자로 메시지가 주어지면(`/commit "..."`) 그것을 제목으로 사용한다.
   - 인자가 없으면 diff를 보고 성격에 맞는 `type`과 한국어 요약 제목을 직접 작성한다.
   - Claude 서명을 넣지 않는다.
7. **결과 확인**: `git log --oneline -3` 를 보여주고, 마지막 커밋 본문에 `Co-Authored` 문구가 없음을 확인한다.

## 참고
- 이 저장소는 개인 프로젝트이므로, 사용자가 별도 지시하지 않으면 현재 브랜치(보통 `main`)에 그대로 커밋한다.
- 예시 메시지: `feat: 일정 등록 탭에 날짜 선택 추가`, `refactor: IPC 핸들러를 기능별로 분리`, `fix: 빈 일정 입력 시 실행되던 문제 수정`
