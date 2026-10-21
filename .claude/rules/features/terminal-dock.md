---
paths:
  - "src/main/features/terminal/dock.ts"
  - "src/renderer/features/terminal/components/DockTerminalApp.tsx"
  - "src/renderer/features/terminal/components/DockStatusItem.tsx"
  - "src/renderer/styles/_terminal-dock.scss"
---

# 독 패널 — 독 오른쪽 빈자리의 작은 터미널 (2026-10-21)

상태바 [독 터미널](`DockStatusItem`, ⌘P 명령도)로 열고 숨긴다. 창은 main `dock.ts`, **어느 세션을 보여 주나(배정)는
`windows.ts` 의 `dock` 항목**(팝아웃과 같은 `popouts` 맵 — '한 세션 = 전 창 pane 1개' 불변식을 그대로 탄다).
렌더러는 `main_window` 엔트리 `?dock=1` → `DockTerminalApp`(팝아웃 경량판 — 탭바·분할 없이 pane 하나).

## 배정 (`windows.ts`)
- 전용 셸(`dock.shellId`, 제목 '독')이 늘 맨 앞, 손님(탭 우클릭 [독으로 보내기])은 **한 번에 하나** — 새 손님이 오면
  먼저 온 손님은 메인으로 돌아간다. 패널은 `sessionIds` 의 **마지막**을 그린다.
- 메인 창은 전용 셸을 **자리표시자로도 그리지 않는다**(`TerminalWindowInfo.dockShellId` 로 `TerminalSection` 의 `sessions` 에서 뺀다).
  손님은 일반 분리 세션처럼 자리표시자로 남는다(클릭 = `focusPopout('dock')` = 독 열기).
- 닫기(⌘W 포함) = **숨기기** — 항목·배정이 남는다. 비면(셸에서 `exit`) 숨고, 다음에 열 때 셸을 새로 띄운다.
  열림 여부는 창 show/hide 로 sidecar 에 실려 재시작 때 접힌 채 복원된다(⚠️ 복원 루프가 **끝난 뒤** 연다 — 도중에 열면 persist 가 안 읽은 레코드를 지운다).

## 창 (`dock.ts`)
- `type: 'panel'`(눌러도 본창이 앞으로 안 온다 — 사용자 확인) · 프레임 없음 · 투명 + CSS 둥근 다크 패널 · OS 그림자 끔.
- ⚠️ **`enableLargerThanScreen: true` 필수** — 없으면 띄우는 순간 macOS 가 패널을 독 띠 밖으로 밀어 올린다(실측 y 938 → 903).
  Electron 은 이 옵션 + 프레임 없는 창이면 요청한 프레임을 그대로 둔다.
- 자리: 독 있는 화면 = workArea 아래가 24pt 이상 깎인 화면. 높이 = 띠 − 위아래 3, 오른쪽 끝 = 화면 − 8.
  왼쪽 끝 = 실측 독 오른쪽 + 8(auto) · 저장된 비율(manual, `terminal-dock.json` — 개발 인스턴스와 공유하는 화면 취향) ·
  독이 아래에 없으면(자동 숨김·좌우) 화면 오른쪽 아래 520×44(floating). `display-metrics-changed` 에 다시 앉힌다(⚠️ `screen` 은 ready 뒤에 구독).
- 접힘/펼침: **포커스로는 펼치지 않는다**(사용자 결정 — 접힌 2줄로 입력). 패널 안 ⌘↑ 펼침 · ⌘↓·포커스 잃음 = 접힘.
  펼친 높이는 기본 320, 펼친 상태에서 윗변 6px 손잡이로 바꾸면 `expandedHeight` 로 기억(최소 120 · 화면 위까지).
  ⚠️ Esc 금지(claude 중단 키). ⌘↑/↓ 는 xterm 이 원래 버리는 키라 가로채도 잃는 입력이 없다.
- 글자: **접힘·펼침 한 값**(`terminal:dock:font`, 기본 10 — 사용자 요청: 펼칠 때 글자가 바뀌면 화면이 출렁인다).
  10 = 독 아이콘 27 → 띠 47 → 2줄, 11 이상이면 접힌 상태는 1줄. `.xterm` 여백은 4·8·4·12(메인 14 는 한 줄만 남는다).
- '확인함'(useMarkSeen)·입력대기 토스트 게이트는 **창 포커스** 기준 — 접힌 채로 입력하므로 펼침으로 판정하지 않는다.

## 독 너비 실측 (접근성 권한)
- 창 목록 API(CGWindowList)는 독 창을 **화면 전체**로 준다 — 못 쓴다. AX 로 Dock 프로세스의 `AXList` 프레임을 읽는다.
- 상주 `osascript -l JavaScript` 하나가 1초마다 묻는다(패널이 떠 있을 때만). 매 틱 `.` 을 써서 main 이 사라지면 SIGPIPE 로 죽는다(실측 0.3초).
  - ⚠️ AX 속성 이름은 **`$('AXChildren')`(NSString)** — JS 문자열이면 -25201(IllegalArgument). AXValue 는 구조체로 못 풀어 `description`("x:85 y:932")을 파싱한다.
  - ⚠️ **상주 프로세스는 시작 때의 권한을 붙든다** — 허용해도 계속 untrusted 를 찍었다(새 프로세스만 읽음). 그래서 untrusted 동안 main 이
    `isTrustedAccessibilityClient(false)` 를 2초마다 보고 **미허용→허용으로 바뀌는 순간 한 번만** 다시 띄운다('허용이면 재시작'은 판정 주체가 엇갈릴 때 무한 재시작).
- ⚠️ **스위치가 켜져 있어도 서명이 바뀌었으면 허용이 아니다** — 10-21 Apple Development 서명 전환 뒤 설치본이 옛 자가서명
  기준 항목에 걸려 거부됐다(`/usr/bin/log show --predicate 'process == "tccd"'` → `Failed to match existing code requirement
  for subject com.electron.one-app`). `tccutil reset Accessibility com.electron.one-app` 로 지우고 [독 너비 자동]으로 다시 허용한다.
- 권한은 osascript 를 띄운 **앱**에 붙는다(dev = Electron, 설치본 = One App — 각각 한 번). 허용 전엔 왼쪽 6px 손잡이로 수동 경계
  (끄는 동안 메모리만, 놓을 때 저장). 펼친 머리줄 [독 너비 자동] = 시스템 권한 요청 창.

## dev 검증
- 셸이 launchd Background 세션이면 dev 를 Terminal.app 으로 띄워야 패널이 보인다(`/test` pitfalls). 위치는 `CGWindowListCopyWindowInfo`
  의 layer 3 Electron 창으로 잰다(렌더러 `screenY` 와 같았다). ⌘↑·클릭 같은 OS 포커스 동작은 CDP 로 못 만든다 — 사용자 확인.
