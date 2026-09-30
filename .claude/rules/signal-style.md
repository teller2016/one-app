---
paths:
  - "**/*.scss"
  - "DESIGN.md"
---

# Signal 스타일 사전 — 스타일을 잡을 때 이 순서·이 값으로

> 무엇을 고치든(새 화면·기존 화면 손질·상태 추가) 여기의 **변환표와 패턴 값**을 먼저 쓴다. 토큰 정의·컴포넌트
> 스펙은 `DESIGN.md`, SCSS 작성 함정은 `styles.md`. 목업(정본 시안): https://claude.ai/artifact/D6HFb87Zfa5MiJpEt3oSdB
> (보드 = 화면 이름.dc.html, 공용 클래스 = `oneapp.css`). 2026-09-30 리디자인에서 12개 섹션을 이 값으로 맞췄다.

## 작업 순서
1. **목업 보드를 찾아 인라인 수치를 읽는다** — 감으로 비슷하게 그리지 말 것. 보드가 없는 화면이면 가장 닮은 보드의 패턴을 따른다.
2. **아래 변환표로 토큰에 옮긴다** — 목업 px 가 표에 없으면 가장 가까운 토큰이 아니라 **새 토큰**(`_base.scss` + DESIGN.md)을 만든다.
3. **공용 컴포넌트·클래스부터** (`renderer-ui.md` 목록) — 기능 SCSS 는 배치(그리드·간격·폭)만 쓴다. 공용 크기를 덮어야 하면 공용에 변형을 추가한다.
4. **실측 대조** — `/test` 로 목업 수치와 숫자로 비교한다(작업한 화면 + 영향 화면만).

## 목업 → 토큰 변환표
| 목업 | 토큰 |
|------|------|
| bg-0 · bg-1 · bg-2 | `--bg` · `--surface-1` · `--bg-sunken` |
| bg-3 · bg-4 | `--surface-2` · `--surface-3` (세그 선택 칩은 `--seg-on`) |
| line · line-2 | `--border` · `--border-strong` |
| fg · fg-2 · fg-3 | `--text` · `--text-2` · `--text-3` |
| accent · accent-fg · accent-soft | `--accent` · `--on-accent` · `--accent-soft` (버튼 면은 `--accent-btn`) |
| ok/warn/err/info (+ -soft) | `--ok` · `--warning` · `--danger` · `--info` (+ `-soft`) |
| 글자 9.5 · 10.5 · 11 · 11.5 · 12 · 12.5 · 13 | `--fs-nano` · `--fs-micro` · `--fs-caption` · `--fs-ui-sm` · `--fs-small` · `--fs-ui` · `--fs-body` |
| 글자 14 · 15 · 16 · 18 · 20 · 22 | `--fs-emph` · `--fs-title` · `--fs-heading` · `--fs-detail-title` · `--fs-h2` · `--fs-metric` |
| 모서리 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 14 | `--r-xs` · `--r-mark` · `--r-sm` · `--r-md` · `--r-tile` · `--r-tab` · `--r-rail` · `--r-lg` · `--r-xl` |
| 높이 24 · 28 · 30 · 32 · 36 | `--control-h-xs` · `-sm` · `-btn`(버튼·세그) / `-field`(입력 30) · `--control-h`(입력) · `-lg` |
| 머리 42 · 44 · 상태바 28 | `--panel-head-h` · `--pane-head-h` · `--statusbar-h` |
| .shadow · .scrim | 떠 있는 레이어는 공용 `Modal`·`Toast`·팝오버가 이미 갖는다 — 직접 쓰지 말 것 · `--scrim` |

간격(padding·gap)은 토큰이 없다 — 목업 px 를 그대로 쓰되 **4 의 배수 + 목업에 적힌 값**(6·10·14 포함)만 쓴다.

## 글자 역할
- **페이지 제목** h1 20/600 −0.01em (`type-h2`) — 폼·완료 화면처럼 탑바 경로만으로 부족할 때만. 목록 섹션은 제목 없이 탑바 경로가 대신한다.
- **패널·카드 제목** 15/600 (`--fs-title`) · **본문** 13 · **UI 값**(탭·트리·브랜치) 12.5 · **메타**(시각·작성자·보조) 11.5 `--text-3` · **안내** `.hint` 11.5 `--text-3`.
- **라벨**(목업 `.label` — 모노 11 대문자 0.06em fg-3 500): 영문 라벨만 그대로. **한글 라벨은 본문 서체** 10.5~11 · 500 · `--text-3` 로(`type-caption` 뒤에 색·굵기를 다시 선언).
- **모노는 식별자·숫자만** — 티켓 키·빌드 번호·해시·경로·포트·잡 이름·시각(`09/30 14:02`). ⚠️ 한글이 한 글자라도 섞이면 모노 금지(JetBrains 에 한글이 없다) → 본문 서체 + `font-variant-numeric: tabular-nums`.
- 티켓 키 = 모노 12 `--accent` 500(`IssueChip`) · 숫자 지표 = 모노 22/500 −0.02em.

## 표면 패턴 (값은 목업 `oneapp.css`)
| 패턴 | 값 |
|------|-----|
| 패널 `.panel` | `--surface-1` + 1px `--border` + `--r-lg` (`card-surface` 믹스인) |
| 패널 머리 `.panel-head` | 높이 42 · padding 0 14 · gap 10 · 바닥선 · 제목 15/600(또는 13/600) |
| 카드 `.card` | 패널 면 + padding 14 · hover 는 **테두리만** `--border-strong`(이동·그림자 금지) |
| 표 `.tbl` | th 30 · padding 0 12 · 한글 라벨 규칙 · 바닥선 / td 38 · padding 0 12 · 바닥선 / hover 행 `--bg-sunken` · 선택 행 `--accent-soft` |
| 행 목록 `.row-item` | 38 · padding 0 12 · gap 10 · 바닥선 · 선택 = `--accent-soft` + `inset 2px 0 0 var(--accent)` |
| 가라앉은 면 | `--bg-sunken` — 세그 트랙·추가 행·안내 띠·검색칸 |
| 로그·코드 | `panel-dark` 믹스인 / 공용 `.panel-sunken--log` · 12/20 모노 |
| 구분선 | 1px `--border` (`.divider` 가로 · `.vdiv` 세로 — 탑바 슬롯 안 묶음 구분) |
| 모달 | 공용 `Modal` — 머리 16 20 12 · 본문 4 20 20 · 하단 바(`footer`) 12 20 + 윗선 + `--bg-sunken` · 폭은 `width` prop |
| 빈 상태 | 공용 `EmptyState` · 떠 있는 알림은 `useToast` · 오류·경고 띠는 `Banner`(테두리 없는 soft 면) |

- ⚠️ **목록 마지막 행의 바닥선은 없앤다** — 패널 테두리와 겹쳐 2px 로 보인다(`:last-child { border-bottom: 0 }`).
- ⚠️ **sticky 표 머리는 불투명 면**을 준다(`--surface-1`) — 스크롤되는 행이 비친다.

## 페이지 골격
- **목록 섹션**: `.section` 의 폭 제한·여백을 풀고(`max-width: none; padding: 0; height: 100%`) 본문이 padding 20 을 갖는다. **본문만 스크롤**(패널 `min-height: 0; overflow: auto`) — `.main` 전체가 스크롤되면 스크롤바 폭만큼 탑바 슬롯이 밀린다.
- **섹션 컨트롤은 탑바로** — 세그먼트·검색·새로고침·주 액션은 `<TopbarSlot left right>`. 섹션 안 하위 화면(편집 폼 등)은 `crumb` 로 경로 셋째 칸을 채운다.
- **탑바 검색칸**: 폭 340 · 높이 30 · padding 0 10 · gap 8 · `--bg-sunken` + `--border-strong` · 포커스 시 `--accent` 테두리 · 돋보기 아이콘.
- **폼 페이지**: padding 28 32 · max 720 · gap 18 · h1 · 패널 안 2열 그리드(라벨 120 · column-gap 16 · row-gap 14) · 구분선 · [저장][취소] 왼쪽. 설정처럼 좁은 그리드는 라벨 112.
- **카드 그리드**: 2열 gap 16 → 창 ≤1100 은 1열 · 폰(`html.mo`)은 1열.
- **필드 세로 배치**(모달 안): 라벨 12/500 `--text-2` 위 · gap 6 · 입력 · 안내 `.hint`.

## 상태 표현
- 뱃지 20 · `--r-sm` · 11.5/500 — `busy`(대기·진행 — 섹션에 따라 액센트) · `ok` · `fail` · `idle` · `accent`(점 없는 틴트). 상태는 **점 + 문구** 로 함께.
- 점 6(뱃지 안)·7(목록) · 진행 중은 링(`0 0 0 3px` 22% 틴트) · 진행바 6 · `--r-full` · 트랙 `--surface-3`.
- 카운트 캡슐 18 · 모노 10.5/600 · `--surface-3`(강조는 `--accent` 면).
- 비활성: 버튼 .45 · 면 없는 아이콘 버튼 .35.

## 목업과 일부러 다르게 두는 것 (되돌리지 말 것)
- 한글 섞인 값·라벨의 모노 → 본문 서체(위 글자 역할).
- 티켓 키는 공용 `IssueChip`(클릭 시 Jira 열기) — 목업의 회색 칩 대신.
- 창이 좁으면 2열 카드 그리드를 1열로.
- ⚠️ danger/warn 버튼 대비(다크 danger 3.0:1 · 라이트 warn 3.8:1)는 **목업을 따른 것** — 바꾸려면 목업부터(`_base.scss` 버튼 주석).
