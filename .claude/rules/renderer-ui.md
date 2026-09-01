---
paths:
  - "src/renderer/**/*.ts"
  - "src/renderer/**/*.tsx"
  - "src/mobile-app/**/*.ts"
  - "src/mobile-app/**/*.tsx"
---

# 렌더러 UI 규칙 (공용 컴포넌트·훅)

## 공용 UI는 `components/` 의 컴포넌트 사용
버튼 `Button`(variant: primary/ghost/danger · size: md/sm · loading), 입력 `Input`(small)·`Textarea`(code), 라벨+입력 행 `FormRow`, 섹션 제목 `SectionHeader`(icon), 배너 `Banner`(variant: warning/danger/info), 새로고침 `RefreshButton`, 열고닫기 `Collapsible`(icon·storageKey), 아이콘 `Icon`, 상태 뱃지 `Badge`·`StatusDot`, 링크형 버튼 `TextLink`, 파일 선택 `FileTrigger`, 세그먼트 `Segment`, 토스트 `useToast`(우측 아래 스택 — 확인성은 `toast(msg, 'fail')`, 알림성은 옵션 `{title, variant: ok/fail/info, duration, sticky(✕ 직접 닫기), action: {label, section}}` — `section` 은 sectionNav 경유 이동. main 발신은 `notifyToast` → `app:toast`, `features/system` 규칙 / 떠 있는 토스트를 나중에 닫으려면 `useToastDismiss()(dedupeKey)` — 용건이 끝난 sticky 알림 회수용), 모달 `Modal`(title·onClose·wide — Escape/오버레이 클릭 닫힘, 부모가 조건부 렌더로 제어), 확인 다이얼로그 `useConfirm`(promise 기반 window.confirm 대체 — `await confirm({title, danger})`), 빈 상태 `EmptyState`(icon·message·hint), 마크다운 렌더 `Markdown`, 날짜 선택 `DatePicker`(미니 캘린더 팝오버 — "YYYY-MM-DD"), 시간 선택 `TimePicker`(타이핑 허용 + N분 단위 리스트 — "HH:MM", `step` 기본 30분·`small` 변형), 체크박스 `Checkbox`(label 래핑·클릭 토글 — `danger`: 운영 확인용), 셀렉트 `Select`(`options` prop — TimePicker 계열 커스텀 팝오버 드롭다운, `small` 변형, **`searchable`**: 팝오버 상단 고정 검색창 + `limit` 으로 렌더 개수 제한 — 브랜치처럼 수백 개인 목록용. 옵션 라벨이 ReactNode 라 검색 문자열은 `SelectOption.search`(없으면 `value`)로 준다), 페이지네이션 `Pagination`(`page`(1-based)·`pageSize`·`total`·`onChange` — 서버 페이징 목록 공용. `1 … 6 [7] 8 … 616` 창 방식 + 좌측 "31–60 / 18,475건" 요약, 한 페이지면 아무것도 렌더 안 함, `span`·`unitLabel` 로 조정), 사이드바 위젯 셸 `SidebarWidget`(icon·dot·tooltip — 축소 시 아이콘 타일 + 오른쪽 팝오버, 아래 '축소 사이드바' 절), 우클릭 메뉴 `ContextMenu`(x·y·onClose + `ContextMenuItem`(icon·label·danger)·`ContextMenuSeparator` — `body` portal·바깥 pointerdown/Escape/창 블러에 닫힘·뷰포트 클램프. 워크스페이스 타일과 세션 탭이 쓴다).

## 렌더 예외는 `ErrorBoundary` 로 격리한다
`App.tsx` 가 **섹션 렌더(`key={active.id}`)와 사이드바 위젯 4개(메일·미러링·VPN·근태, `compact`)를 각각** 감싸고, MO 셸(`mobile-app/App.tsx`)도 탭마다 감싼다. 하나가 죽어도 나머지 화면은 살아 있다 — 예전엔 섹션 하나의 예외가 React 루트를 통째로 언마운트해 **앱이 백지가 됐다**(Electron 창은 새로고침 경로가 눈에 안 보여 사실상 재시작뿐이다. `allowProposedApi` 누락으로 실제로 겪었다 — `features/terminal.md`).

- ⚠️ **자식을 `attempt` 로 keying 하는 게 핵심**이다 — state 의 error 만 비우면 React 가 같은 엘리먼트 트리를 재사용해 오류 직전 상태가 그대로 살아 있고 [다시 시도]가 즉시 다시 죽는다.
- 섹션 경계는 `key={active.id}` 라 **다른 섹션으로 옮기면 오류 상태가 저절로 초기화**된다.
- 잡히는 것은 **렌더 중 예외뿐**이다 — 이벤트 핸들러·비동기 IPC 실패는 지금처럼 각 기능이 토스트·에러 상태로 처리해야 한다.
- ⚠️ **App 컴포넌트 자신의 예외는 못 잡는다**(경계가 그 안쪽이다) — 전역 조작으로 테스트하면 앱이 통째로 죽어 "경계가 안 먹는다"고 오판하기 쉽다(2026-08-09 실측).

아이콘만 있는 버튼의 설명은 **`Tooltip`**(label — hover 250ms·키보드 포커스는 즉시, `body` portal + `usePopover` 배치)으로 감싼다. 네이티브 `title` 은 지연이 1초 이상이고 OS 스타일이라 어두운 툴바에서 눈에 띄지 않는다(2026-08-05 사용자 지적).

- 접근성 이름은 툴팁이 아니라 **버튼의 `aria-label`** 이 담당한다(툴팁은 시각 보조일 뿐 — 두 곳에 다 쓸 것).
- ⚠️ `.tip__pop` 은 `pointer-events: none` 이다 — 마우스가 툴팁 위로 올라가면 트리거의 leave 가 떠서 깜빡이고 아래 버튼 클릭까지 막힌다.
- ⚠️ 아이콘 버튼의 히트 영역·글리프를 너무 작게 잡지 말 것 — 세션 닫기를 16px 버튼 + 12px 글리프 + `--text-3` 로 뒀더니 점처럼 보여 아예 못 찾았다(2026-08-05). 22px 버튼 + 15px 글리프 + `--text-2` 가 하한선.

- **네이티브 `input[type=date/time]`·원시 `<input type=checkbox>`·`<select>` 직접 사용 금지** — 항상 공용 컴포넌트 사용.
- `.btn`/`.input` 등 공통 클래스 직접 사용 금지, 기능 scss 에서 공용 클래스 크기 오버라이드 금지(size variant 사용).
- 이모지·텍스트 글리프 대신 공용 `Icon` 컴포넌트(Lucide path) 사용.

## 피커 팝오버는 `body` 로 portal + `fixed`
`Select`·`TimePicker`·`DatePicker` → `lib/usePopover.ts`. 절대배치로 두면 **모달 본문(`.modal__body`, `overflow-y:auto`)의 스크롤 높이에 포함돼 스크롤바가 생기고 잘린다**(2026-08 실측). 훅이 트리거 rect 기준으로 좌표를 계산하고 아래 공간이 모자라면 위로 flip, 좌우는 뷰포트 클램프, scroll(capture)·resize 에서 재배치한다.

- `side: 'right'`(기본은 `'bottom'`) — 트리거 **오른쪽**에 붙이고 모자라면 왼쪽으로 flip, 세로는 트리거 중앙 정렬 후 뷰포트 클램프. 접힌 사이드바 위젯이 쓴다. 이 배치에만 `ResizeObserver` 재배치가 걸려 있다(열린 뒤 펼쳐지는 폼이 화면을 넘지 않게. bottom 배치에 걸면 `fitHeight` 의 max-height 와 물려 위/아래 판단이 진동한다).

## 축소 사이드바에서도 조작 경로를 남긴다
사이드바 위젯(VPN·미러링·근태)은 공용 `SidebarWidget` 셸로 감싼다 — 접히면 아이콘 타일만 남고 타일을 누르면 본체가 오른쪽 팝오버로 펼쳐진다.

- ⚠️ **본체는 접힘 여부와 무관하게 항상 같은 자리에 마운트**한다(닫힘은 언마운트가 아니라 `hidden`). 재마운트되면 위젯 초기 조회가 다시 도는데, 근태는 그게 **headless 브라우저 그룹웨어 조회**다. 그래서 팝오버도 `body` portal 이 아니라 제자리 `fixed` 다.
- ⚠️ 외부 클릭 판정에서 `.modal-overlay`·`.picker__pop`·`.toast` 는 제외한다 — 이 위젯들이 띄운 모달·확인창은 `body` portal 이라 좌표상 '팝오버 밖'이고, 그대로 닫으면 야근 결재 모달을 여는 순간 배경이 사라진다.
- ⚠️ SCSS 에서 `.sbw__actions`·`.sbw__buttons` 를 축소 모드에 `display:none` 으로 감추지 말 것 — 그래서 접은 채로 아무 것도 누를 수 없었다(2026-08-05 사용자 지적).
- ⚠️ 위젯 사이 구분선 셀렉터는 `.sbw + .sbw` 가 아니라 **`.sbwx__body + .sbwx__body .sbw`** 다 — 셸 래퍼가 한 겹 끼어 인접 형제가 아니게 된다.

- ⚠️ **옵션 스타일을 조상 스코프(`.picker--select .picker__option`·`.terminal-new__select .picker__option`)로 걸면 안 먹는다** — 팝오버 자신의 클래스(`.picker__pop--select`·`--sm`·`--search`)에 쓸 것.
- ⚠️ **팝오버 안 입력(검색창)의 포커스는 `requestAnimationFrame` 으로 미뤄야 한다** — 트리거 버튼의 기본 포커스가 열림 effect **뒤에** 확정돼서, effect 안에서 바로 `focus()` 하면 곧바로 버튼으로 되돌아간다(2026-08-06 실측: `activeElement` 가 `button.select`, 타이핑이 검색창에 안 들어감). 이때 키보드 선택(↑↓·Enter)도 함께 죽으므로 증상이 "검색도 키보드도 안 된다"로 보인다.
- 폭도 CSS `width: 100%` 가 body 기준이 되므로 훅이 인라인으로 트리거 폭을 준다(`matchWidth`).
- 앵커는 컨테이너(`.picker`)가 아니라 **트리거 요소**를 넘긴다(부모 flex 에서 stretch 되면 6px 간격이 어긋난다).

## 공통 훅 재사용 (중복 정의 금지)
- 주기 폴링·시계 틱은 `lib/usePolling.ts`(`usePolling`·`useTick`)
  - ⚠️ **`usePolling` 에 인라인 화살표(`() => void refresh()`)를 넘기지 말 것** — 매 렌더마다 콜백 identity 가 바뀌어 effect 가 인터벌을 재시작하며 `immediate` 즉시 실행을 반복하고, 응답의 setState 가 다시 렌더를 일으켜 **IPC 왕복 주기(수십 ms)로 폴링이 폭주**한다(2026-08-06 변경사항 diff CPU 폭주 실측 원인). 반드시 `useCallback` 으로 안정화한 콜백을 그대로 넘긴다. (`immediate: false` 여도 안전하지 않다 — 인터벌이 계속 리셋돼 **폴링이 한 번도 발화하지 않는** 반대 증상이 된다. 2026-08-07 터미널 워크트리 폴링 실측.)
  - 두 훅 모두 **창 활성(보임+포커스) 인지**가 내장돼 있다(2026-08-07) — 비활성이면 `usePolling` 은 주기가 6배로 늘고 `useTick` 은 멈추며, 복귀 시 즉시 1회 따라잡는다. 호출부에서 visibility 처리를 중복 구현하지 말 것.
- 조회 한 건의 loading·error·data 는 `lib/useAsync.ts`(`useAsync(fn, {immediate})`) — 세대 카운터가
  **늦게 도착한 응답이 최신 화면을 덮어쓰는 문제**까지 막는다(호출부가 ref 로 손수 방어하던 것).
  ⚠️ `usePolling` 과 같은 규칙 — `fn` 은 `useCallback` 으로 안정화해 넘긴다. IPC 의 `{ok, error}`
  응답은 실패를 `throw` 로 올려야 훅이 error 로 잡는다.
- 예외 → 표시 문구는 `lib/errMsg.ts` 의 **`errMsg(e, fallback?)`** — ⚠️ **`(err as Error).message`
  를 쓰지 말 것.** 그 단언은 거짓일 수 있어 화면에 "실패: undefined" 가 뜬다. IPC 실패 응답은
  같은 파일의 `resultError(res, fallback)`.
- 클립보드 복사+토스트는 `lib/useCopy.ts` (⚠️ 폰은 평문 http = insecure context 라 `navigator.clipboard` 가 없어 `execCommand` 폴백이 들어 있다)
- 날짜·시간 문자열은 **`shared/date.ts`**(`pad2`·`dayKey`·`todayKey`·`parseDayKey`·`toMinutes`·
  `fromMinutes`·`WEEKDAY_KO`) — main 과 공용이다. 로컬에 `pad` 를 다시 정의하지 말 것.
- 드롭다운·팝오버 배치는 `lib/usePopover.ts`
- **섹션 안에서 뒤로/앞으로를 먼저 소비**하려면 `lib/sectionBack.ts` — 앱 히스토리(⌘[ ⌘]·마우스
  뒤로/앞으로·스와이프·탑바)는 원래 섹션 사이를 오가는데, 여기에 핸들러를 걸면 **섹션 이동 전에**
  그 섹션의 자체 이동을 처리한다(핸들러가 `true` 를 반환 = 섹션 이동하지 말 것). 결재(목록↔폼) ·
  터미널(세션·워크트리 히스토리)이 쓴다. **뒤로만 등록하고 앞으로를 빼면 되돌릴 방법이 없어지므로**
  `setSectionForward` 도 짝으로 등록한다. ⚠️ 해제는 `clearSectionBack/Forward(fn)` — 등록소가
  전역 슬롯 하나라, keep-alive 로 숨는 섹션(터미널)이 `setSectionBack(null)` 로 정리하면 그새
  등록한 **다른 섹션의 핸들러를 지운다**. identity 가 맞을 때만 지우는 clear 를 쓸 것.
- 테마 전환은 `lib/theme.ts`(`<html data-theme>` + localStorage 미러 — 부팅 플래시 방지, `useThemeMode` 훅)

## 기능 간 참조
- 기능 간 참조는 `features/<기능>/index.ts`(공개 API)로만. 기능 내부 파일을 다른 기능에서 직접 import 하지 않는다.

## 저장 위치 주의
- ⚠️ **localStorage 는 이 앱에서 강제 종료 시 디스크 flush 가 안 돼 유실된다**(2026-07-29 실측). 보존해야 할 데이터는 IPC 로 main 의 userData JSON 에 저장할 것. (UI 상태·필터 같은 휘발성 값은 localStorage 로 충분)
