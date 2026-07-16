---
# ⚠️ 이 프론트매터는 토큰의 "기계 판독용 미러"입니다.
#    정본(단일 소스)은 src/renderer/styles/_base.scss — 값이 다르면 _base.scss 가 우선합니다.
#    각 값의 용도·대비율·치환 맥락은 아래 본문 표를 참조하세요.
name: one-app-design
mood: "Apple — 파치먼트 캔버스 · 흰 카드 · 액션 블루 단일 액센트 · SF Pro · 무그림자 크롬 · 필 버튼"
theme: apple-light-dark   # 라이트(기본 표) + 다크 오버라이드(:root[data-theme='dark'] — 본문 §1 다크 표) · 설정: 시스템/라이트/다크
contrast: "WCAG 2.1 — 본문 4.5:1, 비텍스트 3:1"

colors:
  # 배경 레이어
  bg: "#f5f5f7"                 # 앱 전체 그라운드(파치먼트) · main.ts backgroundColor 동기화 필수
  surface-1: "#ffffff"          # 카드·입력·collapsible (흰 카드 + 헤어라인)
  surface-2: "#e8e8ed"          # hover 표면·팝오버·토스트
  bg-sunken: "#e3e3e8"          # 세그먼트 트랙 등 가라앉은 웰
  # 다크 패널 (로그·코드·커밋 — 애플 니어블랙 타일)
  surface-dark: "#272729"
  surface-dark-2: "#2a2a2c"
  border-dark: "#3d3d40"
  on-dark: "#ffffff"
  on-dark-2: "#cccccc"
  on-dark-3: "#98989d"
  # 보더 · 오버레이
  border: "#e0e0e0"             # 헤어라인
  border-strong: "#c7c7cc"
  highlight: "rgba(255,255,255,0)"     # 무효화 — 애플은 카드 인셋 없음 (구조 보존용 no-op)
  overlay-faint: "rgba(0,0,0,0.03)"
  overlay-hover: "rgba(0,0,0,0.05)"
  overlay-track: "rgba(0,0,0,0.08)"
  scrollbar-hover: "#a1a1a6"
  # 텍스트 (4단 위계 — 니어블랙 잉크)
  text: "#1d1d1f"
  text-2: "#515154"
  text-3: "#66666b"
  text-disabled: "#a1a1a6"      # 비활성 전용 (WCAG 예외)
  # 액센트 (액션 블루 단일 — 링크·버튼·포커스 전부 이 하나)
  accent: "#0066cc"
  accent-hover: "#004f9e"
  accent-btn: "#0066cc"
  accent-btn-hover: "#0057ad"
  accent-soft: "rgba(0,102,204,.12)"
  accent-glow: "rgba(0,102,204,.35)"   # 장식 전용 — 포커스 링 금지
  on-accent: "#ffffff"                 # --accent-btn 배경 위에서만
  accent-on-dark: "#2997ff"            # 다크 패널 안 링크 (스카이 링크 블루)
  accent-hover-on-dark: "#61b0ff"
  # 시맨틱 (애플 시스템 컬러의 접근성 다크 변형 + 밝은 원색 soft 틴트)
  ok: "#217f38"
  warning: "#8a6100"
  danger: "#d70015"
  ot: "#c93400"
  idle: "#6c6c71"
  # 시맨틱 (다크 패널 안)
  ok-on-dark: "#34c759"
  warning-on-dark: "#ffd60a"
  danger-on-dark: "#ff6961"

typography:
  # 정본은 SCSS 믹스인 type-* (크기+행간+웨이트+자간 세트). --fs-* 는 크기만 담음.
  font-display: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"   # SF Pro — 시스템 폰트가 곧 브랜드
  font-mono: "'SF Mono', ui-monospace, Menlo, monospace"
  weight-ladder: [300, 400, 600, 700]   # 500 은 의도적으로 없음 (애플 래더)
  caption: { size: 11px, weight: 600, transform: uppercase }
  small:   { size: 12px, weight: 400 }
  body:    { size: 13px, weight: 400, tracking: -0.008em }
  emph:    { size: 14px, weight: 600 }
  title:   { size: 15px, weight: 600 }
  h2:      { size: 26px, weight: 600, tracking: -0.013em }   # 타이포 드라마 — 큰 제목 + "애플 타이트" 자간
  metric:  { size: 28px, weight: 600, numeric: tabular-nums }

radius: { sm: 8px, md: 11px, lg: 18px, full: 999px }   # 필=액션 문법. 중첩 표면은 부모보다 한 단계 작게
spacing: [4, 8, 12, 16, 20, 24, 32]                    # 4px 그리드
shadow:
  "1": "0 1px 2.5px rgba(0,0,0,0.12)"    # 컨트롤 전용(세그 선택 칩) — 카드 금지
  "2": "0 5px 30px rgba(0,0,0,0.22)"     # 모달·토스트·팝오버 (애플의 단일 그림자 이식)
motion:
  dur-1: .12s          # 색·배경
  dur-2: .18s          # transform·펼침
  dur-pulse: 1.2s      # 상태 점 펄스
  ease: "cubic-bezier(.25,.6,.3,1)"
focus: "outline 2px solid accent, offset 2px (box-shadow 링 금지 · 입력은 offset 0 + border accent 병행 · 다크 패널 안은 accent-on-dark)"
icon: { source: "Lucide path (ISC)", sizes: [12, 14, 16, 18, 20], viewBox: 24, stroke: 2 }
---

# One App 디자인 가이드

> 무드: **Apple** — 파치먼트(#f5f5f7) 그라운드 위 흰 카드, 단일 액션 블루, SF Pro 타이트 헤드라인, 무그림자 크롬, 필(캡슐) 버튼. **UI 크롬은 물러나고 콘텐츠가 말한다.**
> 테마: **애플 라이트 전용** + 로그·코드·커밋 패널만 니어블랙 타일(#272729 — 애플의 라이트↔다크 타일 교차 이식). 이 문서가 UI 스타일의 단일 기준이다. 새 UI는 반드시 이 토큰·컴포넌트로만 작성한다.
> (모든 색 조합은 WCAG 2.1 대비율 계산으로 검증됨 — 본문 4.5:1, 비텍스트 3:1)

## 0. 디자인 원칙

1. **크롬은 물러난다** — 깊이는 표면 색 전환(파치먼트↔화이트↔니어블랙)과 1px 헤어라인만으로. **카드·버튼·텍스트에 그림자 금지**(그림자는 모달 등 떠 있는 레이어와 세그 선택 칩에만 — 애플의 "단 하나의 그림자" 철학).
2. **블루는 하나** — 모든 인터랙티브 신호(링크·primary 버튼·포커스·활성)는 액션 블루 `#0066cc` 단일. 두 번째 액센트 금지.
3. **필 = 액션** — 완전 둥근 캡슐(`--r-full`)은 "누르는 것"의 신호. 버튼은 필, 입력은 11px 라운드 사각, 카드는 18px — 라디우스 문법을 섞지 않는다.
4. **모든 값은 토큰에서** — hex·px 매직넘버 금지. 새 값이 필요하면 토큰을 추가한다.
5. **상태는 빠짐없이** — 인터랙티브 요소는 hover / active / focus-visible / disabled / **loading** 5상태를 정의한다.
6. **아이콘은 SVG** — 이모지·텍스트 글리프(▸ ↗ ✕ ◀ ⚙️ 등) 금지. 공용 `Icon` 컴포넌트만 사용. (허용 예외: 비밀번호 마스킹 표기 `●`)
7. **웨이트 래더 300/400/600/700 — 500 금지** — 본문 400, 강조·제목 600. 헤드라인은 600에 음수 자간("애플 타이트"), 700은 쓰지 않는다.

## 1. 컬러 토큰 (`:root` CSS 변수, `_base.scss`)

베이스는 뉴트럴(무채색) — 웜/쿨 틴트 없음. macOS 시스템 설정과 같은 구성.

### 배경 레이어
| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#f5f5f7` | **앱 전체 그라운드(파치먼트)** — 메인·사이드바·탑바 단일 배경(구분은 보더). main.ts BrowserWindow backgroundColor와 동기화 필수 |
| `--surface-1` | `#ffffff` | 카드·입력·collapsible — **흰 카드 + 헤어라인**이 기본 단위 |
| `--surface-2` | `#e8e8ed` | hover 표면·팝오버·토스트 |
| `--bg-sunken` | `#e3e3e8` | 세그먼트 트랙 등 가라앉은 웰 |

### 다크 패널 (로그·코드·커밋 전용 — §4 '다크 패널 스코프' 참조)
| 토큰 | 값 | 용도 | 대비(다크 위) |
|---|---|---|---|
| `--surface-dark` | `#272729` | 로그·코드·커밋 패널 (애플 니어블랙 타일 1) | — |
| `--surface-dark-2` | `#2a2a2c` | 다크 패널 안 승격 표면 (타일 2 — 마이크로 스텝) | — |
| `--border-dark` | `#3d3d40` | 다크 패널 보더·내부 구분선 | — |
| `--on-dark` | `#ffffff` | 다크 패널 안 본문·강조 (애플은 다크 위 순백) | 14.9 |
| `--on-dark-2` | `#cccccc` | 다크 패널 안 보조·로그 본문 (body-muted) | 9.3 |
| `--on-dark-3` | `#98989d` | 다크 패널 안 메타·타임스탬프 | 5.2 |

### 보더·오버레이
| 토큰 | 값 | 용도 |
|---|---|---|
| `--border` | `#e0e0e0` | 기본 헤어라인 (흰 카드의 유일한 윤곽) |
| `--border-strong` | `#c7c7cc` | hover 보더·입력 기본 보더·스크롤바 thumb |
| `--highlight` | `rgba(255,255,255,0)` | **무효화** — 애플은 카드 인셋 하이라이트 없음 (`card-surface` 구조 보존용 no-op) |
| `--overlay-faint` | `rgba(0,0,0,0.03)` | 은은한 배경(일정 블록 등) |
| `--overlay-hover` | `rgba(0,0,0,0.05)` | 투명 요소 hover(collapsible head 등) |
| `--overlay-track` | `rgba(0,0,0,0.08)` | 진행바 트랙 |
| `--scrollbar-hover` | `#a1a1a6` | 스크롤바 thumb hover |

### 텍스트 (4단 위계 — 니어블랙 잉크, 순흑 금지)
| 토큰 | 값 | 용도 | 대비(bg/s1/s2) |
|---|---|---|---|
| `--text` | `#1d1d1f` | 본문·제목 (애플 잉크 — "인쇄물이 아니라 사진처럼") | 15.5/16.8/13.8 |
| `--text-2` | `#515154` | 보조 텍스트·캡션·표 헤더 | 7.3/7.9/6.5 |
| `--text-3` | `#66666b` | 메타·타임스탬프·플레이스홀더 | 5.2/5.7/4.7 |
| `--text-disabled` | `#a1a1a6` | **비활성 전용** (WCAG 예외 대상만) | — |

### 액센트 (액션 블루 단일 — 진짜 애플 값이 그대로 AA 통과)
| 토큰 | 값 | 용도 |
|---|---|---|
| `--accent` | `#0066cc` | 링크·활성·아이콘 틴트·포커스 링 (bg 5.1 / s1 5.6 / s2 4.6:1 — 전 표면 통과) |
| `--accent-hover` | `#004f9e` | 링크 hover (라이트 테마 hover 는 더 어둡게) |
| `--accent-btn` | `#0066cc` | primary 필 버튼 배경 (흰 글자 5.6:1) — **--accent 와 동일값**(단일 블루 원칙) |
| `--accent-btn-hover` | `#0057ad` | primary hover (흰 글자 7.1:1) |
| `--accent-soft` | `rgba(0,102,204,.12)` | 활성 배경(사이드바 등) |
| `--accent-glow` | `rgba(0,102,204,.35)` | **장식 전용** — 포커스 링에 쓰지 말 것 |
| `--on-accent` | `#ffffff` | `--accent-btn` 배경 위에서만 사용 (그 외 조합 금지) |
| `--accent-on-dark` | `#2997ff` | **다크 패널 안** 링크 (애플 스카이 링크 블루 — 다크 위 4.9:1) |
| `--accent-hover-on-dark` | `#61b0ff` | 다크 패널 안 링크 hover |

※ 애플 문서의 `#0071e3`(포커스 블루)은 라이트 위 텍스트 4.3:1로 미달이라 **채택 안 함** — 포커스 링도 `--accent` 하나로 통일.

### 시맨틱 (애플 시스템 컬러 계열 — 글자는 접근성 다크 변형, soft 는 밝은 원색 틴트)
| 토큰 | 값 | soft (배경) | soft@s1 위 글자 대비 |
|---|---|---|---|
| `--ok` | `#217f38` | `rgba(52,199,89,.14)` | 4.5 |
| `--warning` | `#8a6100` | `rgba(255,204,0,.18)` | 5.1 |
| `--danger` | `#d70015` | `rgba(255,59,48,.12)` | 4.6 |
| `--ot` | `#c93400` | `rgba(255,149,0,.16)` | 4.6 |
| `--idle` | `#6c6c71` | `rgba(142,142,147,.14)` | 4.5 |

다크 패널 안 시맨틱: `--ok-on-dark #34c759`(6.7) · `--warning-on-dark #ffd60a`(10.6) · `--danger-on-dark #ff6961`(5.3) — §4 다크 패널 스코프가 자동 치환.

### 차트 카테고리컬 팔레트 (T/OT 쌍 — CSS 토큰 `--chart-1t`~`--chart-10o`가 단일 소스)
애플 시스템 컬러 10종을 T로, **O쌍(진한 쪽)은 ptag 글자색 겸용이라 15% 틴트 배경 위 4.5:1로 어둡게 보정**(9번 옐로만 bg 위 4.49 — 초경계, 허용).
```
1 #007aff/#0064d1 (블루)   2 #34c759/#207b37 (그린)   3 #ff9500/#9e5c00 (오렌지)
4 #af52de/#9345ba (퍼플)   5 #30b0c7/#207483 (틸)     6 #ff2d55/#c72342 (핑크)
7 #5856d6/#5856d6 (인디고) 8 #a2845e/#7e6749 (브라운) 9 #f5c400/#896e00 (옐로)
10(기타) #8e8e93/#6c6c70 (그레이)
```
- 색각 보정: 스택 세그먼트 사이 **1px 경계선**(`borderColor: --surface-1, borderWidth: 1`)을 chartTheme 기본값으로.
- 범례·툴팁에 항상 프로젝트명 텍스트 병기 (색 단독 전달 금지).
- ptag(프로젝트 태그): **글자는 O쌍, 배경은 T쌍 15% 틴트** — T색 글자는 대비 미달.

### 다크 모드 (`:root[data-theme='dark']` 오버라이드 — 환경설정 테마: 시스템/라이트/다크)
**메커니즘**: `renderer/lib/theme.ts` 가 `<html data-theme>` 를 설정(부팅 시 localStorage 미러로 첫 페인트부터 적용, `system` 이면 matchMedia 로 macOS 모드 추종). 설정 정본은 settings.json `theme`(환경설정 → 일반 세그먼트, 즉시 저장) — main.ts 가 창 생성 시 이 값+`nativeTheme` 으로 backgroundColor(`#1c1c1e`/`#f5f5f7`)를 고른다. chart.js 는 토큰을 스냅숏으로 읽으므로 `useThemeMode()` 훅으로 재생성. **다크 블록에 없는 토큰은 라이트 값 공용** — 새 토큰 추가 시 다크에서도 성립하는지 확인.

| 구분 | 다크 값 (핵심) | 대비 |
|---|---|---|
| 배경 | bg `#1c1c1e` · s1 `#2c2c2e` · s2 `#3a3a3c` · sunken `#141416` | — |
| 다크 패널 | **`#000000`(퓨어 블랙 — bg 와 1.06:1이라 블랙으로 분리)** · border `#333336` | on-dark 계열 그대로(블랙 위 대비 더 상승) |
| 텍스트 | `#f5f5f7` / `#b0b0b6` / `#98989f` / disabled `#636369` | 15.6 / 7.9 / 5.9 (bg 기준) |
| 액센트 | 링크 `#409cff` · **hover `#6cb2ff`(다크에선 밝게 — 라이트와 반대)** · btn `#0b6fd8`(흰 4.9) · soft rgba(10,132,255,.2) | 링크 bg 6.0 / s1 4.9 |
| 시맨틱 | ok `#30d158` · warning `#ffd60a` · danger `#ff817a` · ot `#ff9f0a` · idle `#a8a8ae` (soft 알파 .16) | soft@s1 전부 4.5+ |
| 차트 | 애플 시스템 다크 10종, **O쌍은 밝게 보정**(라이트와 반대 방향) | 틴트 위 4.5+ |
| 기타 | color-scheme: dark(네이티브 컨트롤) · highlight rgba(255,255,255,.05) 부활 · 그림자 더 짙게 | — |

## 2. 타이포그래피

- **폰트 = 시스템 = 브랜드**: macOS 시스템 스택(-apple-system → **SF Pro**)이 곧 애플의 서체다. 별도 폰트 없음. `--font-display` 도 같은 스택(과거 세리프 흔적 제거).
- **모노**: `--font-mono: 'SF Mono', ui-monospace, Menlo, monospace` — 코드·로그·커밋 해시.
- **웨이트 래더 300/400/600/700** — **500 사용 금지**(애플은 500을 의도적으로 비움). 본문 400, 강조·제목 600.
- **"애플 타이트"**: 제목(`type-h2`)은 음수 자간 -0.011em, 본문도 -0.008em 미세 타이트. 11px 이하에는 음수 자간 금지.

**정본은 SCSS 믹스인** — 크기·행간·웨이트·자간이 묶인 세트. `--fs-*` 변수는 크기만 담는다(chartTheme이 읽음).

| 믹스인 | 스펙 | 용도 (크기 아닌 **용도 기준**으로 매핑) |
|---|---|---|
| `type-caption` | 11px/1.35 · 600 · ls .05em · uppercase · **--text-2** | 패널 캡션·표 헤더·칩 T/OT 라벨·차트 legend (uppercase 는 시스템 유지 예외) |
| `type-small` | 12px/1.45 · 400 | 힌트·메타·위젯 본문·로그 |
| `type-body` | 13px/1.5 · 400 · ls -0.008em | 기본 UI·입력·버튼 |
| `type-emph` | 14px/1.45 · 600 | 목록 이름(roster)·강조 본문 |
| `type-title` | 15px/1.4 · 600 | 카드 제목(프로젝트명) |
| `type-h2` | **26px**/1.25 · **600** · ls **-0.013em** | 섹션 제목·상세 카드 큰 제목 — 700 금지, 큰 크기+타이트 자간의 "타이포 드라마"가 시그니처 |
| `type-metric` | **28px**/1.1 · **600** · tabular-nums | 큰 숫자 (애플은 볼드 대신 세미볼드) |

숫자 정렬(시각·합계)은 `font-variant-numeric: tabular-nums`. 버튼 라벨은 **400**(애플 필 버튼 웨이트).

## 3. 스페이싱 · 라운드 · 그림자 · 모션 · 포커스

- **스페이싱**: 4px 그리드 — `4/8/12/16/20/24/32`. 컴포넌트 세로 패딩만 ±2px 허용 (예: 버튼 sm 6px).
- **라운드 (애플 문법 — 섞지 말 것)**: `--r-sm: 8px`(칩·아이콘 버튼·세그 칩) · `--r-md: 11px`(입력·중첩 패널) · `--r-lg: 18px`(카드·모달) · `--r-full: 999px`(**버튼 필**·뱃지·바). **필 = 액션 신호.** 중첩 표면은 부모보다 한 단계 작게.
- **그림자 (애플 무그림자 크롬)**: 카드·버튼·텍스트에 그림자 **금지** — `card-surface` 는 헤어라인만. `--shadow-1`(0 1px 2.5px rgba(0,0,0,.12))은 **세그 선택 칩 등 컨트롤 전용**, `--shadow-2`(0 5px 30px rgba(0,0,0,.22) — 애플의 단일 제품 그림자 이식)는 **떠 있는 레이어**(모달·토스트·팝오버) 전용.
- **모션**: `--dur-1: .12s`(색·배경) · `--dur-2: .18s`(transform·펼침) · `--dur-pulse: 1.2s`(상태 점 펄스) · 스피너 .9s · `--ease: cubic-bezier(.25,.6,.3,1)`. `prefers-reduced-motion` 시 transition·pulse 제거.
- **포커스** (`@mixin focus-ring`): `outline: 2px solid var(--accent); outline-offset: 2px;`
  - box-shadow 링 **금지**. Chromium은 outline이 radius를 따라 라운드로 그려짐(필 버튼에서도 캡슐형 링).
  - 입력은 offset 0 + `border-color: var(--accent)` 병행.
  - 다크 패널 안에서는 스코프 재정의로 `--accent-on-dark` 링이 된다(별도 처리 불필요).

## 4. 컴포넌트 스펙

> **명명 단일화** — 명명의 정본은 **React 컴포넌트 + prop**(variant/size…)이다. SCSS 는 BEM(`.blk` · `.blk--variant` · `.blk__part`)으로 대응. 새 UI 는 아래 레지스트리에서 공용 컴포넌트를 먼저 찾고, 없으면 표에 추가한 뒤 구현한다. `.btn`·`.input` 등 루트 클래스 직접 사용 금지(컴포넌트 경유), 기능 SCSS 에서 size 오버라이드 금지(size prop 사용).

| 컴포넌트 | React API | 루트 클래스 | variant / size |
|---|---|---|---|
| `Button` | `<Button variant size loading>` | `.btn` | **필 캡슐**. variant: `primary`(액션 블루)·`ghost`(기본)·`danger` / size: `md`(기본)·`sm` |
| `IconButton` | (클래스 직접) | `.icon-btn` | 24×24 / bordered 28×28 |
| `TextLink` | `<TextLink small external>` | `.textlink` | `small` · 외부링크 arrow-up-right |
| `Input` | `<Input small>` | `.input` | `small` → `.input--sm` (11px 라운드 사각 — 필 아님) |
| `Textarea` | `<Textarea code>` | `.input` | `code` → `.input--code`(모노·**다크 패널**) |
| `FileTrigger` | `<FileTrigger>` | `.filetrigger` | — |
| `Segment` | `<Segment options value onChange>` | `.seg-group` | on = **흰 칩 + shadow-1** (macOS 세그먼트) |
| `Badge` | `<Badge variant>` | `.badge` | `busy`·`ok`·`fail`·`idle`·`pill` |
| `StatusDot` | `<StatusDot status md>` | `.status-dot` | `busy`·`ok`·`fail`·`idle` / `md` |
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

### Button (`.btn`) — 필 캡슐 (`--r-full`)
- **variant**: `primary`(--accent-btn 블루 + --on-accent) · `ghost`(surface-1 + --border, hover: surface-2 + border-strong) · `danger`(danger-soft 배경 + --danger 글자 + rgba 보더)
- **size**: `md`(8px 16px / 13px) · `sm`(6px 12px / 12px)
- **상태**: hover(배경 한 단계 어둡게) / **active: `transform: scale(0.97)`**(애플 시그니처 마이크로 인터랙션 — reduced-motion 시 제거) / focus-ring / disabled(opacity **0.45**) / **loading**(12px 스피너 + 라벨 유지 + disabled)
- 라벨 웨이트 **400** (애플 필 버튼 웨이트 — 600·500 금지)

### IconButton (`.icon-btn`) — 24×24 / bordered 28×28, --r-sm, SVG 전용
### TextLink — --accent 글자, hover: --accent-hover(더 어둡게) + underline, 외부 링크는 arrow-up-right 아이콘. 크기 body/small
### Input (`.input`)
- 배경 **surface-1(흰색)**, 보더 **--border-strong**, radius **--r-md(11px — 필 아님)**, placeholder --text-3, disabled opacity 0.45
- **size sm**(6px 10px / 12px). date/time/number/textarea 동일 계열. 코드 textarea 는 `.input--code` = **panel-dark + --font-mono**
- focus: border accent + focus-ring(offset 0). ※ 비포커스 경계는 AA 3:1 미달을 보더 상향+라벨 병행으로 절충(라이트 테마 공통의 알려진 한계)
### FileTrigger — Input 룩의 트리거 버튼. ellipsis, hover: border-strong→accent
### Segment (`.seg`) — 트랙: --bg-sunken + --border, radius --r-md. on: **--surface-1(흰 칩) + --border-strong + --text + shadow-1** (macOS 세그먼트 컨트롤 — 유일하게 그림자 허용되는 컨트롤). off 글자 --text-2, hover --text. disabled 0.45
### Badge — 필(pill): soft 배경 + 시맨틱 글자 + StatusDot. variant: `busy`(warning + 점 pulse) · `ok` · `fail`(danger) · `idle` · `pill`(점 없는 정보형). 글자 400. 부속 타임스탬프는 type-caption + --text-3, 간격은 gap(음수 마진 금지)
### StatusDot — sm 6px(뱃지 내) / md 8px(VPN 위젯). busy=--warning+pulse, ok=--ok, fail/error=--danger, idle=--idle. **VPN error 는 --danger 점**으로 disconnected 와 시각 구분
### Chip — `<button>`(접근성). surface-1 + --border, hover surface-2, excluded: opacity+line-through 유지
### Card 패턴 (`@mixin card-surface`) — **surface-1(흰색) + --border 헤어라인 + --r-lg(18px). 그림자 없음**(하이라이트 인셋은 no-op 토큰으로 무효화). 인터랙티브 카드(roster): hover **surface-2 + border-strong만**(translateY 금지). selected: **accent 보더 + accent-soft 배경**(이중 링 금지)
### Collapsible — 바깥 --r-lg, head 화살표 SVG chevron-right(open 시 rotate 90°, --dur-2)
### Banner — variant `warning`(기본, alert-triangle)·`danger`(alert-triangle)·`info`(info, accent). soft 배경 + 시맨틱 보더/글자 + 아이콘 16px
### Confirm (전역 `.confirm` + ConfirmProvider·useConfirm — window.confirm 대체)
- **promise 기반**: `if (!(await confirm({ title, message?, confirmLabel?, danger? }))) return;` — 호출부가 async 면 그대로 치환된다.
- 룩: surface-1 + --border + --r-lg + shadow-2, max-width 420px, **중앙(광학 중심 살짝 위)** 배치 — macOS 알럿. 액션은 우측 정렬 [취소(ghost)] [확인(primary / danger)].
- 키보드: **Escape=취소·Enter=확인**(capture 로 아래 깔린 Modal 의 Escape 닫힘 차단), 확인 버튼 autoFocus. 오버레이 클릭 = 취소. z-index 95(모달 90 위·토스트 100 아래).
- ⚠️ DeploySection 처럼 `confirm` 이름이 이미 쓰이는 곳에선 `const confirmDialog = useConfirm()` 로 받는다.
### Toast (전역 `.toast` + ToastProvider) — surface-2 + --border + --r-md + **shadow-2**, 하단 중앙, 지속 2s, 진입 slide-up --dur-2
### EmptyState (`.empty-state`) — surface-1 카드 + 아이콘 + --text-3, 중앙 정렬
### Spinner (`.spinner`) — 보더 스피너(accent) / ProgressBar — 트랙 --overlay-track + --r-full, 채움은 시맨틱 색
### 중첩 패널 (`.panel-sunken` — 로그·커밋 패널 공용) — **panel-dark** + --r-md. 로그: --font-mono type-small + --text-2(→on-dark-2 자동). 커밋 항목: 제목 type-body 600 / 본문 --font-mono type-small / 메타 type-caption --text-3. 로딩·에러·빈 3상태 정의(에러는 --danger + alert-triangle — 다크 안에선 danger-on-dark 자동)

### 셸 (macOS 네이티브 시그니처 — 비브런시 + 프로스트)
- **비브런시 사이드바**: 220px, `BrowserWindow vibrancy: 'sidebar'` 재질이 그대로 비치도록 **배경 transparent**(Finder 류). html/body 도 투명 유지, **불투명 채색은 `.content`(--bg)에서만** — 다른 곳을 불투명하게 칠하면 재질이 가려진다. 항목 hover 는 표면 승격이 아니라 `--overlay-hover`(재질 위 은은한 오버레이), 활성은 **accent-soft + 아이콘 --accent 틴트**. `nativeTheme.themeSource` 를 테마 설정과 연동해 재질·신호등이 앱 테마를 따른다(main.ts·settings ipc).
- **프로스트 탑바**(`.topbar`): `.content` 위 **absolute 오버레이**(z-index 10) — `.main` 이 `padding-top: 44px` 로 바 밑까지 차지해 **콘텐츠가 블러 뒤로 스크롤돼 지나간다**. `background: var(--frost)` + `backdrop-filter: blur(20px) saturate(180%)` (macOS 툴바·apple.com 서브내브). 높이 44px 변경 시 .main padding-top 동기화. **드래그 영역 유지 필수**(.sidebar drag / nav·footer no-drag / 탑바 drag)
- **스크롤바**: thumb --border-strong, hover --scrollbar-hover
- **macOS 신호등 여백**(padding-top 28px)·`hiddenInset` 보존
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
- **파치먼트 그라운드 + 흰 카드 + 헤어라인** — 깊이는 표면 색 전환으로. 코드·로그는 **panel-dark**(니어블랙 타일).
- **인터랙티브 = 액션 블루 하나** — 링크·버튼·포커스·활성 전부 `--accent` 계열만.
- **필은 버튼에, 11px 는 입력에, 18px 는 카드에** — 라디우스 문법 준수.
- **버튼 active 는 scale(0.97)** — 애플 마이크로 인터랙션(reduced-motion 시 제거).
- **웨이트는 300/400/600/700** — 본문·버튼 400, 강조·제목 600. **500 금지.**
- **5상태 정의** — hover / active / focus-visible / disabled(opacity 0.45) / loading 모두.
- **아이콘은 공용 `Icon`(Lucide)만** — 크기는 12·14·16·18·20 5단계 안에서.
- **다크 패널 내부 텍스트는 평소 토큰 그대로** — panel-dark 스코프가 on-dark 로 자동 치환(on-dark 직접 참조 금지).
- **공용 컴포넌트 + variant/size prop 사용**(§4 레지스트리). 숫자 정렬은 `tabular-nums`.

### ⛔ Don't
- ❌ **hex·px 매직넘버**, `.btn`/`.input` 등 루트 클래스 직접 사용, 기능 SCSS 에서 공용 클래스 크기 오버라이드.
- ❌ **이모지·텍스트 글리프**(▸ ↗ ✕ ◀ ⚙️). 유일 예외: 비밀번호 마스킹 `●`.
- ❌ **카드·버튼·텍스트에 그림자** — 그림자는 shadow-2(떠 있는 레이어)와 shadow-1(세그 칩)뿐.
- ❌ **두 번째 액센트 색** — 블루 외 인터랙티브 색 금지(차트 카테고리컬은 예외).
- ❌ **웨이트 500** · **제목 700** · **11px 이하 음수 자간**.
- ❌ **`#0071e3`·`#2997ff` 를 라이트 표면 텍스트로** — 대비 미달. 스카이 블루는 다크 패널 전용.
- ❌ **그라디언트 장식** — 애플은 그라디언트 토큰이 없다.
- ❌ **box-shadow 포커스 링** — outline 사용. **`--accent-glow` 를 포커스 링에** — 장식 전용.
- ❌ **카드 hover 에 `translateY`** — hover 는 `surface-2 + border-strong` 만. **selected 에 이중 링** 금지.
- ❌ **hover 에 brightness(1.n) 밝히기 필터** — 라이트 테마에선 씻겨 보임. hover 는 어둡게.
- ❌ **색 단독으로 정보 전달**(차트 범례·툴팁은 텍스트 병기) · **라운드 임의값** · **아이콘 임의 크기**.

## 7. 마이그레이션 절차 (순서 준수 — 2026-07 애플 전환에 적용)

1. `_base.scss` 토큰 전면 교체(파치먼트·액션블루·애플 시맨틱·차트) + `--font-display` SF 스택 + `type-h2` 600 타이트 + `type-metric` 600 + 라디우스(8/11/18/full)
2. 버튼 필화: `.btn` radius → `--r-full`, 웨이트 400, active `scale(0.97)` / **웨이트 500 전수 제거**(sidebar__item·seg·badge → 400, form-label·deploy rem-why → 600)
3. `src/main/main.ts` backgroundColor → `#f5f5f7` (주석: --bg와 동기화)
4. 무그림자화: `card-surface` 에서 shadow-1 제거(헤어라인만), `--highlight` no-op / 세그 선택 칩은 **--surface-1 흰 칩 + shadow-1**
5. `chartTheme.ts` FALLBACK 맵을 새 토큰 값과 동기화(주석 규칙: _base.scss 와 동일 유지)
6. 다크 패널·ptag 구조는 웜 크림 전환에서 확립된 것 유지(panel-dark 4곳·O쌍 글자) — 값만 애플로
7. 검증: `npx tsc --noEmit` → sass 컴파일 → 앱 실행 후 전 섹션 육안 확인(특히 필 버튼·세그 칩·다크 패널·차트)

## 8. 백로그 (이번 범위 밖)

- ~~`window.confirm` → 앱 내 커스텀 다이얼로그~~ → **완료(2026-07 Confirm 컴포넌트)** — §4 Confirm 참조. 트레이의 네이티브 dialog 확인은 main 프로세스라 유지.
- 네이티브 폼 컨트롤(checkbox·time 피커·number 스피너) 커스텀 렌더링 — macOS 네이티브와 톤이 맞아 위화감 적음
- ~~서브내브 frosted glass~~ · ~~BrowserWindow vibrancy~~ → **완료(2026-07 셸 강화)** — §4 셸 참조 · ~~다크 테마 재지원~~ → **완료(2026-07 테마 설정)** — §1 다크 모드 참조
- 배포 폼 화면 전환 → 모달/사이드 패널 검토
