# One App 디자인 가이드

> 무드: **Linear/Raycast** — 깊은 다크, 레이어드 표면, 1px 보더 위계, 절제된 액센트, 정제된 타이포.
> 테마: **다크 전용**. 이 문서가 UI 스타일의 단일 기준이다. 새 UI는 반드시 이 토큰·컴포넌트로만 작성한다.
> (모든 색 조합은 WCAG 2.1 대비율 계산으로 검증됨 — 본문 4.5:1, 비텍스트 3:1)

## 0. 디자인 원칙

1. **깊이는 명도로** — 그림자 대신 표면 명도 차이 + 1px 보더로 위계. 카드에는 상단 1px 하이라이트 인셋 병행.
2. **색은 아껴서** — 화면의 95%는 블루 틴트 그레이. 액센트·시맨틱 색은 상태·포인트에만. 선택 상태도 배경 승격이 우선.
3. **모든 값은 토큰에서** — hex·px 매직넘버 금지. 새 값이 필요하면 토큰을 추가한다.
4. **상태는 빠짐없이** — 인터랙티브 요소는 hover / active / focus-visible / disabled / **loading** 5상태를 정의한다.
5. **아이콘은 SVG** — 이모지·텍스트 글리프(▸ ↗ ✕ ◀ ⚙️ 등) 금지. 공용 `Icon` 컴포넌트만 사용. (허용 예외: 비밀번호 마스킹 표기 `●`)

## 1. 컬러 토큰 (`:root` CSS 변수, `_base.scss`)

베이스 그레이는 블루 틴트(hue ≈ 228°)로 통일.

### 배경 레이어 (깊은 순)
| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg-sunken` | `#0a0b0e` | 로그·코드·중첩 패널 (기존 #0f1012·#16171a 흡수) |
| `--bg` | `#0e0f13` | **앱 전체 그라운드** — 메인·사이드바·탑바 단일 배경(기존 --bg-sidebar 폐지, 구분은 보더). main.ts BrowserWindow backgroundColor와 동기화 필수 |
| `--surface-1` | `#16171e` | 카드·입력·collapsible |
| `--surface-2` | `#1d1f27` | hover 표면·팝오버·토스트·세그먼트 on |

### 보더·오버레이
| 토큰 | 값 | 용도 |
|---|---|---|
| `--border` | `#2e3140` | 기본 보더 (bg 대비 1.49:1) |
| `--border-strong` | `#3f4354` | hover 보더·입력 기본 보더·스크롤바 thumb |
| `--highlight` | `rgba(255,255,255,0.045)` | 카드 상단 1px 인셋 (`inset 0 1px 0`) |
| `--overlay-faint` | `rgba(255,255,255,0.03)` | 은은한 배경(일정 블록 등) |
| `--overlay-hover` | `rgba(255,255,255,0.05)` | 투명 요소 hover(collapsible head 등) |
| `--overlay-track` | `rgba(255,255,255,0.08)` | 진행바 트랙 |
| `--scrollbar-hover` | `#4a5065` | 스크롤바 thumb hover |

### 텍스트 (4단 위계)
| 토큰 | 값 | 용도 | 대비(bg/s1/s2) |
|---|---|---|---|
| `--text` | `#e9ebf1` | 본문·제목 | 16.1/15.0/13.8 |
| `--text-2` | `#a0a6b5` | 보조 텍스트·캡션·표 헤더·로그 본문(#cfd3d8 치환) | 7.9/7.3/6.7 |
| `--text-3` | `#828a9e` | 메타·타임스탬프·플레이스홀더 | 5.5/5.2/4.8 |
| `--text-disabled` | `#666c7a` | **비활성 전용** (WCAG 예외 대상만) | — |

### 액센트 (확정: 블루 유지·정제 — 기존 #4c8dff·weekly 인디고 #6366f1 통합)
| 토큰 | 값 | 용도 |
|---|---|---|
| `--accent` | `#5b87f5` | 링크·활성·아이콘 틴트 (bg 위 5.7:1) |
| `--accent-hover` | `#6f97ff` | 링크 hover·**surface-2 위 링크는 항상 이 값** |
| `--accent-btn` | `#3663db` | primary 버튼 배경 (흰 글자 5.3:1) |
| `--accent-btn-hover` | `#2e5fd0` | primary hover (더 어둡게 — --accent-hover 금지) |
| `--accent-soft` | `rgba(91,135,245,.13)` | 활성 배경(사이드바 등) |
| `--accent-glow` | `rgba(91,135,245,.4)` | **장식 전용** — 포커스 링에 쓰지 말 것 |
| `--on-accent` | `#ffffff` | `--accent-btn` 배경 위에서만 사용 (그 외 조합 금지) |

### 시맨틱 (전 기능 통일 — 파일별 하드코딩 전부 치환)
| 토큰 | 값 | soft (배경) | 치환 대상 |
|---|---|---|---|
| `--ok` | `#4cc38a` | `rgba(76,195,138,.13)` | #7bd88f, #4ade80 |
| `--warning` | `#e6c35c` | `rgba(230,195,92,.13)` | #f0c675, rgba(255,180,80,…) — OT(코랄)와 혼동 방지 위해 옐로 쪽 |
| `--danger` | `#f47067` | `rgba(244,112,103,.13)` | #ff8a8a, #f87171(맥락별!), #f8a1a1, #3a2224, #5a2e2e |
| `--ot` | `#f59e6b` | `rgba(245,158,107,.13)` | #f0a06a(칩)·#f87171(stype) → OT 단일화 |
| `--idle` | `#7c8494` | `rgba(124,132,148,.13)` | #6b6f76 (VPN off) — 뱃지 글자로도 4.5:1 통과 |

시맨틱 soft 배경 위 글자 대비: ok 6.5 / warning 8.0 / danger 5.2 / ot 6.7:1 — 전부 통과.

### 차트 카테고리컬 팔레트 (T/OT 쌍 — CSS 토큰 `--chart-1t`~`--chart-10o`가 단일 소스)
```
1 #5b87f5/#3663db (액센트)   2 #8f7af5/#7a5fe0   3 #22b8cf/#1a93a8
4 #4cc38a/#3aa374   5 #ecb35e/#cf9543   6 #e5484d/#c23a3f (--danger와 구분되는 레드)
7 #f591bb/#d1568d   8 #35b8a2/#2a9484   9 #c6dd55/#a4bc3d   10(기타) #8b93a5/#6c7385
```
- 색각 보정: 스택 세그먼트 사이 **1px 경계선**(`borderColor: --surface-1, borderWidth: 1`)을 chartTheme 기본값으로.
- 범례·툴팁에 항상 프로젝트명 텍스트 병기 (색 단독 전달 금지).

## 2. 타이포그래피

폰트: 시스템 스택(-apple-system…) 유지. `--font-mono: 'SF Mono', ui-monospace, Menlo, monospace`.

**정본은 SCSS 믹스인** — 크기·행간·웨이트·자간이 묶인 세트. `--fs-*` 변수는 크기만 담는다(chartTheme이 읽음).

| 믹스인 | 스펙 | 용도 (크기 아닌 **용도 기준**으로 매핑) |
|---|---|---|
| `type-caption` | 11px/1.35 · 600 · ls .05em · uppercase · **--text-2** | 패널 캡션·표 헤더 (기존 10·11.5px 승격 포함: 칩 T/OT 라벨, 차트 legend, rem-head) |
| `type-small` | 12px/1.45 · 400 | 힌트·메타·위젯 본문·로그 (기존 11.5/12.5px: attend__error, badge-time 등) |
| `type-body` | 13px/1.5 · 400~500 | 기본 UI·입력·버튼 (기존 13/13.5px) |
| `type-emph` | 14px/1.45 · 600 | 목록 이름(roster)·강조 본문 |
| `type-title` | 15px/1.4 · 700 | 카드 제목(프로젝트명) |
| `type-h2` | 20px/1.3 · 700 · ls -0.01em | 섹션 제목·상세 카드 큰 제목(사원 이름 h3) |
| `type-metric` | 24px/1.1 · 700 · tabular-nums | 큰 숫자 (weekly-hours 20px·도넛 중앙 21px 통합 — 텍스트 제목엔 쓰지 않음) |

숫자 정렬(시각·합계)은 `font-variant-numeric: tabular-nums`.

## 3. 스페이싱 · 라운드 · 그림자 · 모션 · 포커스

- **스페이싱**: 4px 그리드 — `4/8/12/16/20/24/32`. 컴포넌트 세로 패딩만 ±2px 허용 (예: 버튼 sm 6px).
- **라운드**: `--r-sm: 6px`(칩·아이콘 버튼) · `--r-md: 8px`(버튼·입력·중첩 패널) · `--r-lg: 12px`(카드·패널) · `--r-full: 999px`(필·바). **중첩 표면은 부모보다 한 단계 작게** (r-lg 카드 안 → r-md 패널). 기존 7/9/10/14px 폐기.
- **그림자**: `--shadow-1: 0 1px 2px rgba(0,0,0,.4)`(카드) · `--shadow-2: 0 8px 24px rgba(0,0,0,.5)`(토스트·팝오버). 카드엔 항상 `--highlight` 인셋 병행.
- **모션**: `--dur-1: .12s`(색·배경) · `--dur-2: .18s`(transform·펼침) · `--dur-pulse: 1.2s`(상태 점 펄스) · 스피너 .9s · `--ease: cubic-bezier(.25,.6,.3,1)`. `prefers-reduced-motion` 시 transition·pulse 제거.
- **포커스** (`@mixin focus-ring`): `outline: 2px solid var(--accent); outline-offset: 2px;`
  - box-shadow 링 **금지** — 카드 하이라이트 인셋·shadow와 상호 교체돼 깜빡임. Chromium은 outline이 radius를 따라 라운드로 그려짐.
  - 입력은 offset 0 + `border-color: var(--accent)` 병행.

## 4. 컴포넌트 스펙

### Button (`.btn`)
- **variant**: `primary`(--accent-btn 배경 + --on-accent, hover는 --accent-btn-hover 배경 교체 — brightness filter 폐기) · `ghost`(surface-1 + --border, hover: surface-2 + border-strong) · `danger`(danger-soft 배경 + --danger 글자 + rgba 보더)
- **size**: `md`(8px 16px / 13px) · `sm`(**6px 12px** / 12px) — deploy·settings·weekly·위젯의 로컬 오버라이드와 `.deploy__detail-toggle`(→ ghost sm) 전부 흡수
- **상태**: hover / active(한 단계 어둡게) / focus-ring / disabled(opacity **0.45** 통일) / **loading**(12px 스피너 + 라벨 유지 + disabled — '실행 중…' 5곳 통일)

### IconButton (`.icon-btn`) — 24×24 / bordered 28×28, --r-sm, SVG 전용
### TextLink (신설) — 버튼을 링크처럼(.deploy__link 흡수). --accent 글자, hover: --accent-hover + underline, 외부 링크는 arrow-up-right 아이콘. 크기 body/small
### Input (`.input`)
- 배경 **surface-1 통일**(기존 --bg/#16171a 혼용 제거), 보더 **--border-strong**(식별성), radius --r-md, placeholder --text-3, disabled opacity 0.45
- **size sm**(**6px 10px** / 12px — 위젯·설정 시각/분 입력). date/time/number/textarea 동일 계열. 코드 textarea는 --font-mono + --bg-sunken(`.input--code`)
- focus: border accent + focus-ring(offset 0). ※ 비포커스 경계는 AA 3:1 미달을 보더 상향+라벨 병행으로 절충(알려진 한계)
### FileTrigger (신설) — Input 룩의 트리거 버튼(.vpnw__file 흡수). ellipsis, hover: border-strong→accent
### Segment (`.seg` 공용 승격) — 트랙: --bg-sunken + --border, radius --r-md. on: **surface-2 + --border-strong + --text** (배경 승격 방식 — accent 테두리 폐지). off 글자 --text-2, hover --text. disabled 0.45
### Badge (신설) — 필(pill): soft 배경 + 시맨틱 글자 + StatusDot. variant: `busy`(warning + 점 pulse) · `ok` · `fail`(danger) · `idle` · `pill`(점 없는 정보형 — weekly__period 흡수). 부속 타임스탬프는 type-caption + --text-3, 간격은 gap(음수 마진 금지)
### StatusDot — sm 6px(뱃지 내) / md 8px(VPN 위젯). busy=--warning+pulse, ok=--ok, fail/error=--danger, idle=--idle. **VPN error는 --danger 점**으로 disconnected와 시각 구분
### Chip (weekly 칩 공용화) — `<button>`으로 변경(접근성). surface-1 + --border, hover surface-2, excluded: opacity+line-through 유지
### Card 패턴 (`@mixin card-surface`) — surface-1 + --border + --r-lg + highlight 인셋 + shadow-1. 인터랙티브 카드(roster): hover **surface-2 + border-strong만**(translateY 금지 — 서브픽셀 시머). selected: **accent 보더 + accent-soft 배경**(이중 링 금지)
### Collapsible — 바깥 --r-lg, head 화살표 SVG chevron-right(open 시 rotate 90°, --dur-2)
### Banner — variant `warning`(기본, alert-triangle)·`danger`(alert-triangle)·`info`(info, accent). soft 배경 + 시맨틱 보더/글자 + 아이콘 16px
### Toast (전역 `.toast` + ToastProvider) — surface-2 + --border + --r-md + shadow-2, 하단 중앙, 지속 2s, 진입 slide-up --dur-2. **settings 저장 피드백·weekly 복사 피드백 공용**
### EmptyState (`.empty-state`) — 점선 폐기 → surface-1 카드 + 아이콘 + --text-3, 중앙 정렬
### Spinner (`.spinner`) — 보더 스피너(accent) / ProgressBar — 트랙 --overlay-track + --r-full, 채움은 시맨틱 색
### 중첩 패널 (`.panel-sunken` — 로그·커밋 패널 공용) — --bg-sunken + --border + **--r-md**. 로그: --font-mono type-small + --text-2. 커밋 항목: 제목 type-body 600 / 본문 --font-mono type-small / 메타 type-caption --text-3. 로딩·에러·빈 3상태 정의(에러는 --danger + alert-triangle)

### 셸
- **사이드바**: 220px, 배경 --bg + border-right --border. 활성 항목: **accent-soft 배경 + --text + 아이콘만 --accent 틴트** (좌측 바·글로우 없음). 브랜드 ◈ → SVG 로고 마크(accent)
- **탭바 → 탑바**(`.topbar`): 장식 탭 필 제거 → 44px 헤더(현재 섹션 아이콘+이름, 하단 --border). **드래그 영역 유지 필수**(.sidebar drag / nav·footer no-drag / 탑바 drag)
- **스크롤바**: thumb --border-strong, hover --scrollbar-hover
- **macOS 신호등 여백**(padding-top 28px)·`hiddenInset` 보존

### Icon (`Icon.tsx`)
- **Lucide path 이식**(ISC — 파일 상단 라이선스 고지 주석, 의존성 추가 없음). viewBox 24 / stroke-width 2 / `currentColor`
- 크기 스케일(이 5단계 외 임의 크기 금지): **12**(위젯 캡션·버튼/아이콘 버튼 안) · **14**(인라인·md 버튼 안) · **16**(기본 — 사이드바·배너) · **18**(섹션 제목) · **20**(빈 상태)
- 세트: calendar, bar-chart, rocket, settings, lock, building, key, bell, clock, refresh-cw, chevron-right/down/left, arrow-up-right, x, check, plus, copy, circle, alert-triangle, info

## 5. 레이아웃

- 콘텐츠 폭: `--w-content: 760px`(기본 .section) / `--w-wide: 1200px`(주간보고)
- 브레이크포인트(주간보고): 980px(2단→1단) · 1100px(차트 2열→1열) — SCSS 상수로 기록
- roster sticky `max-height: calc(100vh - 168px)`·차트 canvas `max-height 200px + minmax(0)/min-width:0` 오버플로 제약은 **보존**(주석 유지)
- 고정 min-width(라벨 72px·대상명 120px·주 라벨 170px)는 유지 시 주석 필수

## 6. 마이그레이션 절차 (순서 준수 — 2026-07 리디자인에 적용)

0. **별칭 브리지**: `_base.scss`에 `--bg-elevated: var(--surface-1); --text-dim: var(--text-2);` 선언(기존 참조 51곳 파손 방지) → 전체 완료 후 `grep -rn 'bg-elevated\|text-dim' src/renderer` 0건 확인하고 제거
1. `_base.scss` 토큰+믹스인 전면 개편 / `_settings.scss` 분리(_schedule.scss 동거 해소) / `.sidebar__footer` → `_layout.scss` 이관
2. `src/main/main.ts` backgroundColor → `#0e0f13` (주석: --bg와 동기화)
3. 기능별 SCSS 치환 — **hex 일괄 치환 금지**: #f87171은 맥락별로 --danger(경고)·--ot(stype) 분기, 20px은 용도별로 h2·metric 분기
4. 컴포넌트 신설: Icon(+이모지·글리프 전면 제거, SectionHeader에 icon prop), Badge, StatusDot, TextLink, FileTrigger, Segment, Toast / Button·Input에 size·loading 추가
5. `weekly/lib/chartTheme.ts` 신설 — **useEffect 내 lazy로** getComputedStyle 읽기(+`.trim()`+폴백 맵), 색·폰트(--fs 토큰) 공급, report.ts에서 색 제거(프레젠테이션 분리). weekly 인디고(#6366f1·#565aa8·#a5b4fc·rgba(99,102,241,…)) → 액센트 토큰 통일
6. TSX 인라인 스타일 제거 4곳(settings 3·ProjectForm 1). 동적 값(진행바 width%·ptag 색)은 유지
7. **죽은 코드 정리**: 미정의 클래스 5종(sidebar__brand-name·sidebar__item-label·tab__icon·tab__label·vpnw__form — 정의 또는 제거), .placeholder+SECTIONS 주석 8개 항목(제거), collapsible head 9px radius 불일치
8. 리마인더 그리드: 헤더/행 동일 grid 셀 구조로 재구성 → padding-left 23px 핵 제거
9. 문서 정정: _weekly.scss '40시간' 주석 2곳 → 38h

## 7. 백로그 (이번 범위 밖)

- `window.confirm`(배포·출퇴근·삭제 확인) → 앱 내 커스텀 다이얼로그
- 네이티브 폼 컨트롤(checkbox·time 피커·number 스피너) 커스텀 렌더링
- BrowserWindow vibrancy(반투명), 라이트 테마(토큰 구조는 대응 가능)
- 배포 폼 화면 전환 → 모달/사이드 패널 검토
