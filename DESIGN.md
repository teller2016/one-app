---
# ⚠️ 이 프론트매터는 토큰의 "기계 판독용 미러"입니다.
#    정본(단일 소스)은 src/renderer/styles/_base.scss — 값이 다르면 _base.scss 가 우선합니다.
#    각 값의 용도·대비율·치환 맥락은 아래 본문 표를 참조하세요.
name: one-app-design
mood: "Signal — 흑연 바탕 · 인디고 단일 액센트 · 조밀한 정보 · 키는 모노 · 상태는 점+문구"
theme: signal-dark-light   # 다크(Signal 기본 무드) + 라이트 — 설정: 시스템/라이트/다크
contrast: "WCAG 2.1 — 본문 4.5:1, 비텍스트 3:1"
mockup: "https://claude.ai/artifact/D6HFb87Zfa5MiJpEt3oSdB (디자인 언어 · 화면 · 모달 · 상태 화면)"

colors:            # 라이트 / 다크
  bg:              ["#f4f5f7", "#0b0c0e"]   # 그라운드
  surface-1:       ["#ffffff", "#111316"]   # 패널·카드·입력·사이드바
  surface-2:       ["#eef0f3", "#1e2227"]   # hover·팝오버·토스트
  bg-sunken:       ["#e4e7eb", "#171a1e"]   # 세그 트랙
  surface-dark:    ["#111316", "#08090b"]   # 로그·코드·터미널 면
  border:          ["#e3e6ea", "#23272d"]
  border-strong:   ["#d5d9df", "#2f353c"]
  text:            ["#15171a", "#e8eaed"]
  text-2:          ["#4a515b", "#aeb4bc"]
  text-3:          ["#69717c", "#858c96"]
  accent:          ["#4353d6", "#8c9bff"]   # 링크·primary·포커스·앱 아이콘 켜진 타일
  on-accent:       ["#ffffff", "#0b0c0e"]   # 다크의 밝은 액센트 위는 어두운 글자
  ok:              ["#136b44", "#4ccb8d"]
  warning:         ["#a55f00", "#f2a53a"]
  danger:          ["#c4323a", "#f2676d"]
  ot:              ["#b45309", "#ff8f4d"]
  idle:            ["#69717c", "#858c96"]

typography:
  font-body: "'IBM Plex Sans KR' (@fontsource 번들 — lib/fonts.ts)"
  font-mono: "'JetBrains Mono NL' (assets/fonts 번들)"   # 키·번호·경로·해시·시각·포트·로그
  weight-ladder: [400, 500, 600, 700]
  caption: { size: 11px, weight: 600, transform: uppercase }   # 라벨 — 식별자에는 쓰지 말 것
  small:   { size: 12px, weight: 400 }
  body:    { size: 13px, weight: 400 }
  emph:    { size: 14px, weight: 600 }
  title:   { size: 15px, weight: 600 }
  h2:      { size: 20px, weight: 600, tracking: -0.01em }
  metric:  { size: 22px, weight: 500, numeric: tabular-nums }

radius: { xs: 3px, sm: 5px, md: 6px, lg: 10px, full: 999px }   # 모달만 lg 보다 한 단 더 (컴포넌트에서)
spacing: [4, 8, 12, 16, 20, 24, 32]
control-height: { md: 32px, sm: 28px }
shadow:
  "1": "세그 선택 칩 전용"
  "2": "떠 있는 레이어(모달·토스트·팝오버) — 그림자 + 1px 윤곽"
motion: { dur-1: .12s, dur-2: .18s, dur-3: .28s, lift: 4px, list-items: "진입 모션 금지" }
focus: "outline 2px solid accent, offset 2px (box-shadow 링 금지)"
icon: { source: "Lucide path (ISC)", viewBox: 24, stroke: 2 }
---

# One App 디자인 가이드 — Signal

> 무드: **Signal** — 흑연 바탕 위 단 하나의 인디고 액센트. 정보는 조밀하게, 상태는 **색 + 모양(점·아이콘) + 문구**로 함께, 티켓 키·빌드 번호·포트·경로 같은 식별자는 모노로.
> 테마: **다크가 기본 무드**, 라이트는 같은 역할의 대비만 뒤집은 것. 설정은 시스템/라이트/다크.
> 목업(정본 시안): https://claude.ai/artifact/D6HFb87Zfa5MiJpEt3oSdB — 화면·모달·상태 화면이 모두 여기 있다. 새 UI 는 목업과 이 문서를 함께 본다.
> ⚠️ 2026-09-30 리디자인 진행 중 — §0~§4(공용 컴포넌트)까지 Signal 기준으로 갱신됨. **§4 '셸' 과 §5 레이아웃은 3단계(사이드바 3그룹·상태바·탑바)에서 갱신한다** — 그 전까지 비브런시·위젯 서술은 현행 구조 설명이다.

## 0. 디자인 원칙

1. **액센트는 하나** — 링크·primary 버튼·포커스·활성 표시는 `--accent`(인디고) 단일. 두 번째 액센트 금지. 앱 아이콘의 켜진 타일도 같은 색이다.
2. **상태 = 색 + 모양 + 문구** — 색만으로 구분하지 않는다. 배지는 점 + 문구, 경고는 아이콘 + 문구.
3. **식별자는 모노** — 티켓 키(`BBJ-2924`)·빌드 번호(`#482`)·해시·포트·경로·시각·IP 는 `--font-mono`.
4. **조밀하되 숨 쉬게** — 목록 행 38px 안팎, 컨트롤 32px, 4px 그리드. 섹션 설명 문장은 빈 상태에서만.
5. **크롬은 물러난다** — 깊이는 표면 단계(bg → surface-1 → surface-2)와 1px 헤어라인으로. 그림자는 떠 있는 레이어에만.
6. **모든 값은 토큰에서** — hex·px 매직넘버 금지. 새 값이 필요하면 토큰을 추가한다.
7. **상태는 빠짐없이** — hover / active / focus-visible / disabled / loading, 그리고 섹션의 빈·오류·로딩·미설정 화면(목업 "상태 화면" 페이지).
8. **아이콘은 SVG** — 이모지·텍스트 글리프 금지. 공용 `Icon` 만.

## 1. 컬러 토큰 (`_base.scss` — `:root` 라이트 / `:root[data-theme='dark']` 다크)

| 역할 | 토큰 | 라이트 | 다크 | 용도 |
|---|---|---|---|---|
| 그라운드 | `--bg` | `#f4f5f7` | `#0b0c0e` | 메인 영역 바탕 |
| 패널 | `--surface-1` | `#ffffff` | `#111316` | 카드·입력·사이드바·상세 패널 |
| 떠 있는 면 | `--surface-2` | `#eef0f3` | `#1e2227` | hover·팝오버·토스트 |
| 웰 | `--bg-sunken` | `#e4e7eb` | `#171a1e` | 세그 트랙 |
| 코드 면 | `--surface-dark` | `#111316` | `#08090b` | 로그·코드·커밋·터미널 (`panel-dark` 스코프) |
| 헤어라인 | `--border` / `--border-strong` | `#e3e6ea` / `#d5d9df` | `#23272d` / `#2f353c` | 윤곽 / hover·입력 보더 |
| 잉크 | `--text` / `-2` / `-3` | `#15171a` / `#4a515b` / `#69717c` | `#e8eaed` / `#aeb4bc` / `#858c96` | 본문 / 보조 / 메타 |
| 액센트 | `--accent` | `#4353d6` | `#8c9bff` | 링크·활성·포커스 (bg 위 5.9 / 7.9:1) |
| 버튼 글자 | `--on-accent` | `#ffffff` | `#0b0c0e` | ⚠️ 다크는 액센트가 밝아 **어두운 글자** — 흰 글자는 2.4:1 |
| 성공 | `--ok` | `#136b44` | `#4ccb8d` | 성공·연결됨·작업 중 아크 |
| 주의 | `--warning` | `#a55f00` | `#f2a53a` | 입력 대기·PROD·미달/초과 |
| 위험 | `--danger` | `#c4323a` | `#f2676d` | 실패·종료·삭제 |
| 초과근무 | `--ot` | `#b45309` | `#ff8f4d` | OT 전용 |
| 유휴 | `--idle` | `#69717c` | `#858c96` | 빌드 이력 없음 등 |

- 각 시맨틱에는 `-soft`(배지·배너 배경) 짝이 있다. soft@surface-1 위 글자 대비는 전부 4.5:1 이상.
- **차트 팔레트** `--chart-1t`~`--chart-10o`: 1~5 는 인디고·스카이·앰버·핑크·민트(목업 주간보고와 같은 순서), 6~10 은 보조. O쌍은 ptag 글자색 겸용 — 다크에선 밝게, 라이트에선 어둡게 보정.
- 메커니즘: `renderer/lib/theme.ts` 가 `<html data-theme>` 설정(localStorage 미러로 첫 페인트부터). chart.js 는 `useThemeMode()` 로 재생성. **다크 블록에 없는 토큰은 라이트 값 공용.**

## 2. 타이포그래피

- **본문 = IBM Plex Sans KR** — `@fontsource/ibm-plex-sans-kr` 400/500/600/700 을 `src/renderer/lib/fonts.ts` 가 import(진입점 3곳: renderer · mobile-app · standalone/lite). 한글은 unicode-range 로 나뉘어 쓰는 글자 묶음만 로드된다. 오프라인에서도 같은 글꼴.
- **모노 = JetBrains Mono NL** — 기존 번들 그대로(`assets/fonts`, `font-display: block` — xterm 셀 폭 때문).
- **웨이트 래더 400/500/600/700** — 본문 400, UI 라벨·버튼 500, 제목·강조 600, 로고·큰 제목만 700.

| 믹스인 | 스펙 | 용도 |
|---|---|---|
| `type-caption` | 11px · 600 · uppercase · ls .05em · --text-2 | 패널 라벨·표 헤더 (⚠️ 식별자 금지) |
| `type-small` | 12px · 400 | 힌트·메타·로그 |
| `type-body` | 13px · 400 | 기본 UI |
| `type-emph` | 14px · 600 | 목록 이름·강조 |
| `type-title` | 15px · 600 | 카드·패널 제목 |
| `type-h2` | 20px · 600 · ls -0.01em | 섹션·상세 제목 |
| `type-metric` | 22px · 500 · tabular-nums | 큰 숫자(시간·잔여연차) — 가능하면 모노 |

## 3. 스페이싱 · 라운드 · 그림자 · 모션 · 포커스

- **스페이싱**: 4px 그리드 `4/8/12/16/20/24/32`.
- **컨트롤 높이**: `--control-h: 32px` / `--control-h-sm: 28px`. 기능 SCSS 에서 높이 오버라이드 금지.
- **라운드**: `--r-xs 3`(인라인 마크) · `--r-sm 5`(칩·작은 버튼) · `--r-md 6`(버튼·입력) · `--r-lg 10`(카드·패널) · 모달 14(컴포넌트에서) · `--r-full`(카운트 뱃지·진행 바·스위치만 — **버튼은 필이 아니다**).
- **그림자**: 카드·버튼에 금지. `--shadow-1` 은 세그 선택 칩, `--shadow-2` 는 모달·토스트·팝오버(그림자 + 1px 윤곽).
- **모션**: `--dur-1 .12s`(hover·토글) · `--dur-2 .18s`(팝오버·드로어·모달 진입) · `--dur-3 .28s`(폭·높이 변화). 진입 이동 `--lift 4px`. 목록 선택·탭 전환은 즉시. **목록 항목에 진입 모션 금지**. 진입 믹스인 fill-mode 는 `backwards`(`.claude/rules/styles.md` 참고). `prefers-reduced-motion` 은 `.01ms` 로 즉시 종료.
- **포커스**: `outline: 2px solid var(--accent); outline-offset: 2px`. box-shadow 링 금지. 입력은 offset 0 + 보더 액센트.

## 4. 컴포넌트 스펙

> **명명 단일화** — 명명의 정본은 **React 컴포넌트 + prop**(variant/size…)이다. SCSS 는 BEM(`.blk` · `.blk--variant` · `.blk__part`)으로 대응. 새 UI 는 아래 레지스트리에서 공용 컴포넌트를 먼저 찾고, 없으면 표에 추가한 뒤 구현한다. `.btn`·`.input` 등 루트 클래스 직접 사용 금지(컴포넌트 경유), 기능 SCSS 에서 size 오버라이드 금지(size prop 사용).

| 컴포넌트 | React API | 루트 클래스 | variant / size |
|---|---|---|---|
| `Button` | `<Button variant size loading>` | `.btn` | **6px 각형**(필 아님). variant: `primary`(액센트 면)·`ghost`(기본 — surface-2 면)·`danger`(soft 면) / size: `md` 32px·`sm` 28px |
| `IconButton` | (클래스 직접) | `.icon-btn` | 24×24 / bordered 28×28 |
| `TextLink` | `<TextLink small external>` | `.textlink` | `small` · 외부링크 arrow-up-right |
| `Input` | `<Input small>` | `.input` | `small` → `.input--sm` (6px 라운드) |
| `Textarea` | `<Textarea code>` | `.input` | `code` → `.input--code`(모노·**다크 패널**) |
| `Checkbox` | `<Checkbox label danger>` | `.checkbox` | 네이티브 input 유지 + `appearance:none` 커스텀 체크(16px · --r-xs · 체크 시 액센트 면) / `danger` |
| `Select` | `<Select options value onChange small>` | `.select` | 커스텀 팝오버(picker 계열 재사용 — 네이티브 드롭다운 아님). 트리거 `.input` 실루엣·`--control-h`, ↑↓/Enter/Escape 키보드 / `small` |
| `FileTrigger` | `<FileTrigger>` | `.filetrigger` | — |
| `Segment` | `<Segment options value onChange>` | `.seg-group` | on = **`--seg-on` 칩 + shadow-1** (다크에선 트랙보다 한 단 밝게) |
| `Badge` | `<Badge variant>` | `.badge` | `busy`·`ok`·`fail`·`idle`·`pill` |
| `StatusDot` | `<StatusDot status md>` | `.status-dot` | `busy`·`ok`·`fail`·`idle` / `md` |
| `SidebarWidget` | `<SidebarWidget icon dot tooltip>` | `.sbwx` | 축소 사이드바 위젯 셸 — 아이콘 타일(`__mini`) + 오른쪽 팝오버(`__body--pop`). 펼침 시엔 개입 없음(`display: contents`) |
| `Banner` | `<Banner variant>` | `.banner` | `warning`(기본)·`danger`·`info` |
| `Collapsible` | `<Collapsible title icon storageKey defaultOpen>` | `.collapsible` | — |
| `SectionHeader` | `<SectionHeader icon title sub>` | `.section-head` | 제목은 `type-h2`(600·타이트 자간) |
| `RefreshButton` | `<RefreshButton size>` | `.icon-btn` 계열 | 회전 스피너 |
| `FormRow` | `<FormRow>` | — | 라벨+입력 행 |
| `Modal` | `<Modal title onClose wide>` | `.modal` | `wide` |
| `Confirm` | `useConfirm()` + `<ConfirmProvider>` | `.confirm` | promise 기반 — `danger`·confirmLabel/cancelLabel |
| `Toast` | `useToast()` + `<ToastProvider>` | `.toast` | 하단 중앙 2s |
| `Icon` | `<Icon name size>` | inline svg | size 12·14·16·18·20 |

### 다크 패널 스코프 (`@mixin panel-dark`) — 핵심 패턴
로그·코드·커밋 패널은 `panel-dark` 믹스인 하나로 니어블랙 타일로 뒤집는다. 배경·보더 교체와 함께 **스코프 안에서 CSS 변수를 재정의**하므로, 내부 요소가 쓰는 `--text-2`·`--accent`·`--danger` 등이 **코드 수정 없이** on-dark 값으로 자동 해석된다.
```scss
@mixin panel-dark {
  background: var(--surface-dark);
  border-color: var(--border-dark);
  color: var(--on-dark-2);
  --text: var(--on-dark); --text-2: var(--on-dark-2); --text-3: var(--on-dark-3);
  --border: var(--border-dark);
  --accent: var(--accent-on-dark); --accent-hover: var(--accent-hover-on-dark);
  --ok: var(--ok-on-dark); --warning: var(--warning-on-dark); --danger: var(--danger-on-dark);
}
```
적용처: `.panel-sunken`(로그) · `.input--code`(코드 textarea) · `.deploy__preview-list`(배포 커밋 미리보기) · `.prs__create-files`(PR 변경 파일). **새 로그·코드성 UI 는 반드시 이 믹스인을 사용**하고, 내부 텍스트는 평소처럼 `--text-2` 등을 쓰면 된다(on-dark 직접 참조 금지).

### Button (`.btn`) — 6px 각형 (`--r-md`, sm 은 `--r-sm`)
- **variant**: `primary`(--accent-btn 면 + --on-accent 글자 600 — 다크는 밝은 인디고라 **어두운 글자**) · `ghost`(기본 — surface-2 면 + --border-strong, hover surface-3) · `danger`(danger-soft 면 + --danger 글자 + 35% 보더, hover soft-strong)
- **size**: `md`(높이 `--control-h` 32 · 좌우 12 · 13px) · `sm`(`--control-h-sm` 28 · 좌우 10 · 12px)
- **상태**: hover(면 한 단계) / focus-ring / disabled(opacity 0.45) / **loading**(12px 스피너 — 트랙은 글자색 25% 틴트). 누를 때 수축(scale) 없음 — 도구는 즉시 반응한다
- 라벨 웨이트 **500** (primary 만 600)

### IconButton (`.icon-btn`) — 24×24 / bordered 28×28, --r-sm, SVG 전용
### TextLink — --accent 글자, hover: --accent-hover(더 어둡게) + underline, 외부 링크는 arrow-up-right 아이콘. 크기 body/small
### Input (`.input`)
- 배경 surface-1, 보더 --border-strong, radius --r-md(6px), placeholder --text-3, disabled opacity 0.45
- **size sm**(6px 10px / 12px). date/time/number/textarea 동일 계열. 코드 textarea 는 `.input--code` = **panel-dark + --font-mono**
- focus: border accent + focus-ring(offset 0). ※ 비포커스 경계는 AA 3:1 미달을 보더 상향+라벨 병행으로 절충(라이트 테마 공통의 알려진 한계)
### FileTrigger — Input 룩의 트리거 버튼. ellipsis, hover: border-strong→accent
### Segment (`.seg`) — 트랙: --bg-sunken + --border, radius --r-md. 칩: 12px · 500. on: **--seg-on + --border-strong + --text + shadow-1**(유일하게 그림자 허용되는 컨트롤). off 글자 --text-2, hover --text. disabled 0.45
### Badge — **작은 사각**(높이 20 · --r-sm · 12px 500): soft 배경 + 시맨틱 글자 + StatusDot. variant: `busy`(warning + 점 pulse) · `ok` · `fail`(danger) · `idle` · `pill`(점 없는 정보형 — surface-2). 부속 타임스탬프는 type-caption + --text-3, 간격은 gap(음수 마진 금지)
### StatusDot — sm 6px(뱃지 내) / md 8px(VPN 위젯). busy=--warning+pulse, ok=--ok, fail/error=--danger, idle=--idle. **VPN error 는 --danger 점**으로 disconnected 와 시각 구분
### Chip — `<button>`(접근성). surface-2 + --border-strong + --r-md, 높이 28, hover surface-3. excluded: **점선 윤곽 + 투명 면 + opacity 0.55 + 취소선**(색만으로 구분하지 않는다)
### Card 패턴 (`@mixin card-surface`) — **surface-1 + --border 헤어라인 + --r-lg(10px). 그림자 없음**(하이라이트 인셋은 no-op 토큰으로 무효화). 인터랙티브 카드(roster): hover **surface-2 + border-strong만**(translateY 금지). selected: **accent 보더 + accent-soft 배경**(이중 링 금지)
### Collapsible — 바깥 --r-lg, head 화살표 SVG chevron-right(open 시 rotate 90°, --dur-2)
### Banner — variant `warning`(기본, alert-triangle)·`danger`(alert-triangle)·`info`(info, accent). soft 배경 + 시맨틱 보더/글자 + 아이콘 16px
### Confirm (전역 `.confirm` + ConfirmProvider·useConfirm — window.confirm 대체)
- **promise 기반**: `if (!(await confirm({ title, message?, confirmLabel?, danger? }))) return;` — 호출부가 async 면 그대로 치환된다.
- 룩: surface-1 + --border-strong + **--r-xl(14px)** + shadow-2, max-width 420px, **중앙(광학 중심 살짝 위)** 배치 — macOS 알럿. 액션은 우측 정렬 [취소(ghost)] [확인(primary / danger)].
- 키보드: **Escape=취소·Enter=확인**(capture 로 아래 깔린 Modal 의 Escape 닫힘 차단), 확인 버튼 autoFocus. 오버레이 클릭 = 취소. z-index 95(모달 90 위·토스트 100 아래).
- ⚠️ DeploySection 처럼 `confirm` 이름이 이미 쓰이는 곳에선 `const confirmDialog = useConfirm()` 로 받는다.
### 떠 있는 레이어 공통 — 팝오버(`.picker__pop`)·컨텍스트 메뉴(`.ctx`)는 **surface-2 + --border-strong + --r-lg + shadow-2**, 툴팁(`.tip__pop`)은 surface-3 + --text. 모달·확인창은 surface-1 + --r-xl. 딤은 `--scrim`. 전부 body portal (모달 `overflow: hidden` 에 잘리지 않는다)
### Toast (전역 `.toast` + ToastProvider) — 떠 있는 면: surface-2 + --border-strong + --r-lg + **shadow-2**, 우측 아래 스택, 진입 rise-in
### EmptyState (`.empty-state`) — surface-1 카드 **점선 윤곽** + 아이콘 + --text-3, 중앙 정렬 (빈 칸이라는 뜻을 모양으로)
### Spinner (`.spinner`) — 보더 스피너(accent) / ProgressBar — 트랙 --overlay-track + --r-full, 채움은 시맨틱 색
### 중첩 패널 (`.panel-sunken` — 로그·커밋 패널 공용) — **panel-dark** + --r-md. 로그: --font-mono type-small + --text-2(→on-dark-2 자동). 커밋 항목: 제목 type-body 600 / 본문 --font-mono type-small / 메타 type-caption --text-3. 로딩·에러·빈 3상태 정의(에러는 --danger + alert-triangle — 다크 안에선 danger-on-dark 자동)

### 셸 (macOS 네이티브 시그니처 — 비브런시 + 프로스트)
- **비브런시 사이드바**: 기본 220px(가변 — 아래 '폭 조절' 참조), `BrowserWindow vibrancy: 'sidebar'` 재질이 그대로 비치도록 **배경 transparent**(Finder 류). html/body 도 투명 유지, **불투명 채색은 `.content`(--bg)에서만** — 다른 곳을 불투명하게 칠하면 재질이 가려진다. 항목 hover 는 표면 승격이 아니라 `--overlay-hover`(재질 위 은은한 오버레이), 활성은 **accent-soft + 아이콘 --accent 틴트**. `nativeTheme.themeSource` 를 테마 설정과 연동해 재질·신호등이 앱 테마를 따른다(main.ts·settings ipc).
- **프로스트 타이틀바**(`.topbar`): **창 전체 폭을 가로지르는 fixed 바**(z-index 10, 높이 `--titlebar-h: 44px`) — `.main`·`.sidebar` 가 `padding-top: var(--titlebar-h)` 로 바 밑까지 차지해 **콘텐츠가 블러 뒤로 스크롤돼 지나간다**. `background: var(--frost)` + `backdrop-filter: blur(20px) saturate(180%)` (macOS 통합 툴바). **드래그 영역 유지 필수**(.sidebar drag / nav·footer no-drag / 탑바 drag)
  - ⚠️ **좌측 여백은 `max(var(--titlebar-safe), calc(var(--sidebar-w) + 16px))`** — `--titlebar-safe: 84px` 는 macOS 신호등(`hiddenInset`, 창 좌상단 고정) 예약폭이다. 접으면 신호등 오른쪽에서, 펼치면 콘텐츠 컬럼에 맞춰 컨트롤이 시작한다.
  - ⚠️ **사이드바 우측 경계선은 `border-right` 가 아니라 `.sidebar::after`**(`top: var(--titlebar-h)`) — 보더로 두면 상단 44px 에서도 선이 프로스트 바 밑으로 비쳐 통짜 스트립이 갈라지고, **신호등이 그 이음선에 걸친 모양이 된다**(2026-08-06 사용자 지적 — 접힌 60px 레일에서 초록 버튼이 경계선 위에 놓였다). grip 도 같은 이유로 `top: var(--titlebar-h)`.
- **사이드바 폭 조절 / 축소 모드** (`Sidebar.tsx` + `.sidebar__grip`): 우측 테두리를 끌어 **180~320px** 로 조절하고, **150px 아래로 끌면 60px 축소 모드**로 스냅한다(더블클릭·Enter 로도 토글). 폭·접힘은 `localStorage`(`sidebar:width`·`sidebar:collapsed`)에 남는다.
  - 실제 폭은 **`--sidebar-w`** 로 노출된다 — 사이드바 폭에 기대는 레이아웃(`.jira-view` 의 `calc(100vw - var(--sidebar-w) - 48px)`)은 반드시 이 변수를 봐야 한다. **px 하드코딩 금지.**
  - 축소 폭 60px = 좌우 패딩(8) + 아이콘 필 44. 신호등은 전체폭 타이틀바가 흡수하므로 이 폭과 무관하다(예전엔 신호등 침범 때문에 72px 하한이 있었다).
  - ⚠️ grip 에 **`-webkit-app-region: no-drag` 필수** — `.sidebar` 가 `drag` 라 이게 없으면 창 드래그가 pointerdown 을 가로채 리사이즈가 시작조차 안 된다.
  - 축소 시엔 **글자만 감추고 상태를 나르는 점은 남긴다**(StatusDot·메일 안읽음 점·근태 완료 체크). 위젯 루트의 `title` 이 감춰진 글자를 대신한다.
  - ⚠️ **축소 상태에서도 조작 경로는 반드시 남긴다** — 사이드바 위젯(VPN·미러링·근태)은 공용 `SidebarWidget` 셸이 아이콘 타일(`.sbwx__mini`)만 남기고, 타일을 누르면 위젯 본체가 **오른쪽 팝오버**(`.sbwx__body--pop`, 232px · usePopover `side: 'right'`)로 펼쳐진다(macOS 메뉴바 위젯). 접은 채로 미러링·VPN 연결·출퇴근·야근 결재까지 다 된다. 메일 위젯은 예외로 타일 자신이 진입점(접혀 있으면 브라우저가 아니라 앱 내 모달).
  - ⚠️ **조작 버튼을 `display:none` 으로 감추지 말 것** — 예전엔 축소 모드에서 `.sbw__actions`·`.sbw__buttons` 를 지웠고, 그래서 접은 채로는 아이콘을 눌러도 아무 일도 일어나지 않았다(2026-08-05 사용자 지적).
- **스크롤바**: thumb --border-strong, hover --scrollbar-hover
- **macOS 신호등**: `hiddenInset` 보존 + `trafficLightPosition: { x: 20, y: 16 }` (44px 타이틀바 세로 중앙 정렬 — 기본값은 28px 타이틀바 기준이라 위로 떠 보인다). 렌더러 쪽 여백은 `--titlebar-h`/`--titlebar-safe` 가 담당
- ⚠️ **backgroundColor 를 창에 지정하지 말 것** — 비브런시 재질이 가려짐(로드 전 배경도 재질이라 플래시 없음)

### Icon (`Icon.tsx`)
- **Lucide path 이식**(ISC — 파일 상단 라이선스 고지 주석, 의존성 추가 없음). viewBox 24 / stroke-width 2 / `currentColor`
- 크기 스케일(이 5단계 외 임의 크기 금지): **12**(위젯 캡션·버튼/아이콘 버튼 안) · **14**(인라인·md 버튼 안) · **16**(기본 — 사이드바·배너) · **18**(섹션 제목) · **20**(빈 상태)
- 세트: calendar, bar-chart, rocket, settings, lock, building, key, bell, clock, refresh-cw, chevron-right/down/left, arrow-up-right, x, check, plus, copy, circle, alert-triangle, info

## 5. 레이아웃

- **여백은 콘텐츠의 pedestal** — 기본 섹션 패딩 `44px 44px 48px`(밀도보다 호흡). 섹션 리드(`.section-head__sub`)는 fs-emph 로 본문보다 한 단계 크게, 아래 여백 28px.
- 콘텐츠 폭: `--w-content: 800px`(기본 .section — 패딩 확대에 맞춰 상향) / `--w-wide: 1200px`(주간보고)
- 브레이크포인트(주간보고): 980px(2단→1단) · 1100px(차트 2열→1열) — SCSS 상수로 기록
- roster sticky `max-height: calc(100vh - 168px)`·차트 canvas `max-height 200px + minmax(0)/min-width:0` 오버플로 제약은 **보존**(주석 유지)
- 고정 min-width(라벨 72px·대상명 120px·주 라벨 170px)는 유지 시 주석 필수

## 6. Do's & Don'ts (빠른 체크리스트)

> 위 원칙·토큰·컴포넌트 스펙에서 **실수하기 쉬운 항목**만 추린 체크리스트. 새 UI 는 커밋 전 이 목록으로 self-review.

### ✅ Do
- **값은 토큰·믹스인에서만** — 색은 `var(--*)`, 타이포는 `type-*` 믹스인, 크기는 `--fs-*`. 새 값이 필요하면 토큰을 먼저 추가한다.
- **그라운드 → 패널 → 떠 있는 면 + 헤어라인** — 깊이는 표면 단계로. 코드·로그는 **panel-dark**.
- **인터랙티브 = 인디고 하나** — 링크·버튼·포커스·활성 전부 `--accent` 계열만.
- **버튼·입력 6px, 카드·패널 10px, 모달 14px, 필(`--r-full`)은 카운트·바·스위치만** — 라디우스 문법 준수.
- **웨이트는 400/500/600/700** — 본문 400, UI 라벨·버튼 500, 제목·강조 600.
- **5상태 정의** — hover / active / focus-visible / disabled(opacity 0.45) / loading 모두.
- **아이콘은 공용 `Icon`(Lucide)만** — 크기는 12·14·16·18·20 5단계 안에서.
- **다크 패널 내부 텍스트는 평소 토큰 그대로** — panel-dark 스코프가 on-dark 로 자동 치환(on-dark 직접 참조 금지).
- **공용 컴포넌트 + variant/size prop 사용**(§4 레지스트리). 숫자 정렬은 `tabular-nums`.
- **떠오르는 레이어·화면 전환에는 진입 모션** — `rise-in`/`fade-in`/`pop-in` 믹스인(§3). 이동은 `--lift`(4px)까지, `opacity`·`transform` 만.
- **식별자는 모노** — 티켓 키·빌드 번호·해시·포트·경로·시각·IP.
- **폭·높이를 드래그로 바꾸는 곳은 드래그 중 transition 을 끈다** — 손끝을 뒤따라오면 조작감이 무너진다(`--dragging` 클래스).

### ⛔ Don't
- ❌ **hex·px 매직넘버**, `.btn`/`.input` 등 루트 클래스 직접 사용, 기능 SCSS 에서 공용 클래스 크기 오버라이드.
- ❌ **이모지·텍스트 글리프**(▸ ↗ ✕ ◀ ⚙️). 유일 예외: 비밀번호 마스킹 `●`.
- ❌ **카드·버튼·텍스트에 그림자** — 그림자는 shadow-2(떠 있는 레이어)와 shadow-1(세그 칩)뿐.
- ❌ **두 번째 액센트 색** — 인디고 외 인터랙티브 색 금지(차트 카테고리컬은 예외).
- ❌ **11px 이하 음수 자간** · **다크의 액센트 면 위 흰 글자**(2.4:1 — `--on-accent` 를 쓴다).
- ❌ **그라디언트 장식** — 앱 아이콘 외에는 쓰지 않는다.
- ❌ **box-shadow 포커스 링** — outline 사용. **`--accent-glow` 를 포커스 링에** — 장식 전용.
- ❌ **카드 hover 에 `translateY`** — hover 는 `surface-2 + border-strong` 만. **selected 에 이중 링** 금지.
- ❌ **hover 에 brightness 필터** — 면 토큰(surface-2 → surface-3)을 한 단계 올린다.
- ❌ **색 단독으로 정보 전달**(차트 범례·툴팁은 텍스트 병기) · **라운드 임의값** · **아이콘 임의 크기**.
- ❌ **reduced-motion 에서 `animation: none`** — 진입 모션의 fill-mode 때문에 상태가 어긋난다. `animation-duration: .01ms` 로 즉시 끝낼 것(§3).
- ❌ **진입 모션에 `--ease-out` 아닌 곡선**, **퇴장에 `--ease-out`** · **`width`/`height`/`top` 애니메이션**(레이아웃 속성 — 펼침·패널 폭처럼 불가피한 곳만).
- ❌ **목록 항목(카드·행)에 진입 모션·계단(stagger)** — 조회 결과는 즉시 보여야 한다(§3).

## 7. 마이그레이션 절차 (2026-09-30 Signal 리디자인 — 브랜치 `feat/redesign-signal`)

1. **토대** ✅ — `_base.scss` 토큰 값 교체(역할 이름 유지) · IBM Plex Sans KR 번들 · 앱 아이콘(`npm run icon`)
2. **공용 컴포넌트** ✅ — 버튼 6px 각형·500 · 배지 작은 사각 · 세그 `--seg-on` · 커스텀 체크 · 떠 있는 레이어 surface-2 · 모달 `--r-xl` · `--scrim`
3. **셸** — 사이드바 개발/리소스/업무 3그룹 + 축소 · 탑바(뒤로/앞으로 + 경로) · 위젯 4종 → 하단 상태바 + 팝오버
4. **⌘K 명령 팔레트** (신규)
5. **섹션별 재구성** — 목업 보드와 대조하며 한 섹션씩(기능 SCSS 의 `--r-full` 필 잔재도 이때 정리)
- 매 단계: `tsc` · `lint` · `test` · lite `typecheck` · 개발 인스턴스 확인 · `chartTheme.ts` FALLBACK 을 토큰과 동기화

## 8. 백로그 (이번 범위 밖)

- ~~`window.confirm` → 앱 내 커스텀 다이얼로그~~ → **완료(2026-07 Confirm 컴포넌트)** — §4 Confirm 참조.
- 네이티브 폼 컨트롤(checkbox·time 피커·number 스피너) 커스텀 렌더링 — macOS 네이티브와 톤이 맞아 위화감 적음
- ~~서브내브 frosted glass~~ · ~~BrowserWindow vibrancy~~ → **완료(2026-07 셸 강화)** — §4 셸 참조 · ~~다크 테마 재지원~~ → **완료(2026-07 테마 설정)** — §1 다크 모드 참조
- 배포 폼 화면 전환 → 모달/사이드 패널 검토
