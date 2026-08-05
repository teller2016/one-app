---
paths:
  - "src/renderer/**/*.ts"
  - "src/renderer/**/*.tsx"
  - "src/mobile-app/**/*.ts"
  - "src/mobile-app/**/*.tsx"
---

# 렌더러 UI 규칙 (공용 컴포넌트·훅)

## 공용 UI는 `components/` 의 컴포넌트 사용
버튼 `Button`(variant: primary/ghost/danger · size: md/sm · loading), 입력 `Input`(small)·`Textarea`(code), 라벨+입력 행 `FormRow`, 섹션 제목 `SectionHeader`(icon), 배너 `Banner`(variant: warning/danger/info), 새로고침 `RefreshButton`, 열고닫기 `Collapsible`(icon·storageKey), 아이콘 `Icon`, 상태 뱃지 `Badge`·`StatusDot`, 링크형 버튼 `TextLink`, 파일 선택 `FileTrigger`, 세그먼트 `Segment`, 토스트 `useToast`, 모달 `Modal`(title·onClose·wide — Escape/오버레이 클릭 닫힘, 부모가 조건부 렌더로 제어), 확인 다이얼로그 `useConfirm`(promise 기반 window.confirm 대체 — `await confirm({title, danger})`), 빈 상태 `EmptyState`(icon·message·hint), 마크다운 렌더 `Markdown`, 날짜 선택 `DatePicker`(미니 캘린더 팝오버 — "YYYY-MM-DD"), 시간 선택 `TimePicker`(타이핑 허용 + N분 단위 리스트 — "HH:MM", `step` 기본 30분·`small` 변형), 체크박스 `Checkbox`(label 래핑·클릭 토글 — `danger`: 운영 확인용), 셀렉트 `Select`(`options` prop — TimePicker 계열 커스텀 팝오버 드롭다운, `small` 변형), 페이지네이션 `Pagination`(`page`(1-based)·`pageSize`·`total`·`onChange` — 서버 페이징 목록 공용. `1 … 6 [7] 8 … 616` 창 방식 + 좌측 "31–60 / 18,475건" 요약, 한 페이지면 아무것도 렌더 안 함, `span`·`unitLabel` 로 조정).

- **네이티브 `input[type=date/time]`·원시 `<input type=checkbox>`·`<select>` 직접 사용 금지** — 항상 공용 컴포넌트 사용.
- `.btn`/`.input` 등 공통 클래스 직접 사용 금지, 기능 scss 에서 공용 클래스 크기 오버라이드 금지(size variant 사용).
- 이모지·텍스트 글리프 대신 공용 `Icon` 컴포넌트(Lucide path) 사용.

## 피커 팝오버는 `body` 로 portal + `fixed`
`Select`·`TimePicker`·`DatePicker` → `lib/usePopover.ts`. 절대배치로 두면 **모달 본문(`.modal__body`, `overflow-y:auto`)의 스크롤 높이에 포함돼 스크롤바가 생기고 잘린다**(2026-08 실측). 훅이 트리거 rect 기준으로 좌표를 계산하고 아래 공간이 모자라면 위로 flip, 좌우는 뷰포트 클램프, scroll(capture)·resize 에서 재배치한다.

- ⚠️ **옵션 스타일을 조상 스코프(`.picker--select .picker__option`·`.terminal-new__select .picker__option`)로 걸면 안 먹는다** — 팝오버 자신의 클래스(`.picker__pop--select`·`--sm`)에 쓸 것.
- 폭도 CSS `width: 100%` 가 body 기준이 되므로 훅이 인라인으로 트리거 폭을 준다(`matchWidth`).
- 앵커는 컨테이너(`.picker`)가 아니라 **트리거 요소**를 넘긴다(부모 flex 에서 stretch 되면 6px 간격이 어긋난다).

## 공통 훅 재사용 (중복 정의 금지)
- 주기 폴링·시계 틱은 `lib/usePolling.ts`(`usePolling`·`useTick`)
- 클립보드 복사+토스트는 `lib/useCopy.ts` (⚠️ 폰은 평문 http = insecure context 라 `navigator.clipboard` 가 없어 `execCommand` 폴백이 들어 있다)
- 드롭다운·팝오버 배치는 `lib/usePopover.ts`
- 테마 전환은 `lib/theme.ts`(`<html data-theme>` + localStorage 미러 — 부팅 플래시 방지, `useThemeMode` 훅)

## 기능 간 참조
- 기능 간 참조는 `features/<기능>/index.ts`(공개 API)로만. 기능 내부 파일을 다른 기능에서 직접 import 하지 않는다.

## 저장 위치 주의
- ⚠️ **localStorage 는 이 앱에서 강제 종료 시 디스크 flush 가 안 돼 유실된다**(2026-07-29 실측). 보존해야 할 데이터는 IPC 로 main 의 userData JSON 에 저장할 것. (UI 상태·필터 같은 휘발성 값은 localStorage 로 충분)
