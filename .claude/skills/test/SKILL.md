---
name: test
description: 개발 인스턴스(npm start)를 실제로 띄워 이슈가 없는지 확인한다. main 예외·렌더러 콘솔 에러를 감시하고, 필요하면 puppeteer 로 화면을 직접 조작해 검증한다. 메인 대화에서 직접 실행한다. 사용법 - /test 또는 /test "확인할 것" 또는 /test --fix
argument-hint: [확인할 것] [--fix]
---

# /test — 개발 인스턴스로 실제 구동 테스트

> 💬 **메인 대화에서 직접 실행한다** — 서브에이전트(`tester`)로 넘기지 않는다(2026-10-01 사용자 지시).
> 확인 지점에서는 `AskUserQuestion` 으로 바로 묻고 이어서 진행한다.
> 확인할 것: $ARGUMENTS

정적 검사로 안 보이는 것 — 런타임 예외·렌더 실패·IPC 미연결·콘솔 에러·레이아웃 회귀 — 을 dev 를 **실제로 띄워** 본다.
**빌드하지 않는다**(`/build`·`npm run package|make` 는 설치본을 교체한다).

```
.claude/skills/test/
├── dev.sh            # dev 관리: status · up <로그> · wait · down  ← 손으로 pkill 하지 말 것
├── lib.mjs           # puppeteer 헬퍼: attach · gotoSection · errors · waitFor · measure/diff · realClick · visibility · shot/realShot
├── smoke.mjs         # 섹션 스모크: --only 포트,Jira (기본) | --all ("전체 스모크" 지시 때만)
└── reference/
    ├── recipes.md    # 셀렉터·IPC 표 · 터미널 pane 순서 · 테스트 claude 세션 · 포트 없는 dev 에 붙기 · MO
    ├── pitfalls.md   # 가려진 창 · 클릭 · 기동/종료 · zsh/macOS 셸 함정 · 판정 함정
    └── noise.md      # 무해한 로그 기준선 (grep 결과를 판정할 때)
```
**새 스크립트를 처음부터 쓰지 말 것** — 스크래치패드 스크립트에서 `lib.mjs` 를 절대경로로 import 해 쓴다(사용 예는 파일 머리말).
헬퍼에 없는 동작이 두 번 이상 필요해지면 `lib.mjs` 에 추가를 제안한다.

## 0. 시작 전에 반드시 알 것

- ⚠️ **dev 는 userData(설정)를 설치본과 공유한다.** 상태를 바꾸는 IPC(`set*`·`save*`·`delete*`)는 전 값을 읽어 두고 **끝나면 원복**한다.
- ⚠️ **떠 있는 dev 는 사용자나 다른 Claude 세션의 것일 수 있다** — 진짜 작업(터미널 세션)이 들어 있고, 다른 세션이 테스트 중일 수 있다.
  말없이 내리지 않는다. `dev.sh status` 확인과 `dev.sh up` 을 **한 응답에 병렬로 보내지 않는다**(10-06 dev 를 두 개 띄웠다).
- ⚠️ 그룹웨어 결재·근태처럼 **외부에 실제 기록을 남기는 기능**은 묻지 않고 실행하지 않는다.
- ⚠️ **이 Claude 는 설치본 One App 의 터미널 안에서 돌 수 있다** — 설치본을 끄면 사용자 화면이 사라진다.
  설치본을 꺼야만 검증되는 것(VPN 관리 소켓 등)은 dev 로 하지 말고 `/build` 로.
- dev 와 설치본이 함께 떠 있으면 출퇴근 리마인더·알림이 2벌 돈다 — 오래 켜둘 거면 사용자에게 알린다.

## 1. 사전 검사 — 여기서 걸리면 앱을 띄울 이유가 없다

```bash
npx tsc --noEmit        # 실패하면 멈추고 보고
npm test                # 순수 로직을 건드렸을 때만
```
`npm run lint` 는 경고만 확인한다. `standalone/lite` 가 import 하는 곳(결재·Jira 보고·환경설정·공용 컴포넌트)을 바꿨으면
`cd standalone/lite && npm run typecheck` 도.

## 2. 띄울지 / 재사용할지

```bash
git status --short; .claude/skills/test/dev.sh status
```
| 바뀐 곳 | 판단 |
|---------|------|
| `src/renderer/**` · `src/mobile-app/**` · `*.scss` | **HMR** — 떠 있으면 재사용 (폰 페이지는 새로고침 필요) |
| `src/main/**` · `src/preload/**` · `src/shared/**` · `vite.*`·`forge.config.ts`·`package.json` | **재시작 필요** |

- 재시작이 필요한데 **이미 떠 있으면** → status 의 "띄운 곳"·"붙어 있는 클라이언트"·dev tmux 세션을 근거로 `AskUserQuestion`.
  거절하면 떠 있는 인스턴스로 볼 수 있는 것까지만.
- 떠 있는데 **디버깅 포트가 없으면**(사용자가 그냥 `npm start`) → 재시작을 묻기 전에 `reference/recipes.md` 의 SIGUSR1 경로로 붙을 수 있다.
- HMR 로 충분하면 재시작하지 않는다(창 상태·세션 복원을 흔든다).

## 3. 띄우기 · 내리기

```bash
.claude/skills/test/dev.sh up <스크래치패드>/dev.log    # ← Bash run_in_background 로
.claude/skills/test/dev.sh wait                         # 포트 + 메인 창 페이지까지. 옛 고아가 포트를 쥐면 실패로 알려준다
.claude/skills/test/dev.sh down                         # 포트가 빌 때까지 TERM→KILL + 설치본 생존 확인
```
- `up` 은 이미 떠 있으면 거부한다. 손으로 `pkill` 하지 않는다 — 첫 TERM 에 Electron 이 안 죽는 게 **거의 매번**이었고,
  `electron-forge start` 패턴은 단독판 lite 까지 죽인다(`dev.sh` 는 작업 폴더로 걸러낸다).
- 내가 띄운 dev 를 내리면 백그라운드 작업 종료 알림이 온다 — 내가 내린 것이니 진단하지 않는다.

## 4. 이슈 감시 — 이 스킬의 본체

### A. main 프로세스
```bash
grep -inE "error|exception|unhandled|rejection|EADDRINUSE|failed" <스크래치패드>/dev.log
```
판정은 `reference/noise.md` 기준선으로. **기준선에 없는 에러는 무관해 보여도 🟡** 로 올린다.

### B·C. 렌더러 콘솔 + 화면 스모크 — **작업한 섹션 + 영향 가는 섹션만**
```bash
node .claude/skills/test/smoke.mjs --only 포트,Jira [--reload] [--shot <스크래치패드>/s.png]
```
- 12개 전체 순회는 너무 오래 걸린다(2026-09-30 사용자 지적) — `--all` 은 인자가 **"전체 스모크"** 를 명시했을 때만.
  공용 컴포넌트·셸·토큰을 바꿨으면 그 부품을 쓰는 대표 화면 몇 개를 `--only` 에 넣는다.
- `.err-box` = ErrorBoundary 가 잡은 렌더 예외 → 즉시 🔴. 숨긴 메뉴는 팔레트로 열고, 끝나면 원래 보던 섹션으로 돌려놓는다.
- `--reload` 는 초기 로딩 콘솔까지 볼 때만 — 사용자가 보던 화면 상태가 날아간다.

### D. 바뀐 기능 직접 검증
- 스크래치패드에 스크립트를 쓰되 `lib.mjs` 로 붙는다. `window.oneApp.<기능>.<메서드>()` 를 `page.evaluate` 로 불러 main 로직을 단독 검증할 수 있다.
- **레이아웃을 바꿨으면** 작업 대상만 재지 말고 **같은 화면의 이웃 영역**까지 `t.measure` 로 전/후를 재서 `t.diff` 로 비교한다
  (10-20 `listH:203` 을 재고도 통과로 보고 → 사용자가 "'위치' 영역이 너무 좁아졌어").
- 셀렉터·IPC 는 `reference/recipes.md` 표부터 본다. 측정이 이상하면 `reference/pitfalls.md`(가려진 창·transition·클릭).
- 상태를 바꾸는 호출은 원복(§0), 외부 기록이 남는 호출은 사용자 확인 후에만.

### E. MO(폰) 화면 → `reference/recipes.md` 의 MO 절

## 5. 정리

- [ ] 테스트로 바꾼 설정·창 크기·테마를 **원복**했는가
- [ ] 테스트로 만든 터미널 세션을 **`terminal.kill(id)`** 로 지웠는가 — 남기면 재부팅 뒤 `claude --resume` 으로 되살아난다
- [ ] 열어 둔 팝오버·모달·팔레트를 닫았는가 (사용자가 그 dev 를 쓴다)
- [ ] 외부(그룹웨어 등)에 남긴 기록을 보고했는가
- [ ] dev 를 원래 상태로 — 원래 떠 있었으면 되살리고, 내가 띄운 것이면 내린다.
      단 **보고 뒤 수정이 이어질 것 같으면**(🔴·🟡 가 있거나 연속 작업 중) 내리지 말고 보고에 "dev 띄워 둠" 을 적는다 — 작업을 마칠 때 내린다
- [ ] `dev.sh down` 이 "설치본 살아 있음" 을 찍었는가 · 리포에 임시 파일을 만들지 않았는가

## 6. 보고

```
🔴 이슈 — 재현됨. 무엇이 / 어디서(파일:줄 또는 화면) / 어떻게 재현하는지
🟡 의심 — 원인 미확정이거나 이번 변경과 무관해 보이는 에러(그래도 올린다). 노이즈일 가능성 명시
✅ 확인됨 — 실제로 돌려서 정상임을 본 것
```
- **기대값이 있으면 대조표로** — 목업·의도한 값·사용자가 말한 수치가 있으면 `항목 | 기대 | 실측` 표로 보고한다
  ("이슈 없음" 만 쓴 보고 뒤 사용자가 디자인 차이를 찾은 게 2회, 대조표로 바꾼 뒤엔 0회).
- 측정했는데 이상한 값(-1, 0, 예상 밖 크기)은 결론에 안 쓰더라도 보고에 남긴다.
- **테스트하지 못한 것을 분명히 적는다** — 외부 기록이 남아 건너뛴 것, 창이 가려져 못 본 것. 안 본 것을 본 것처럼 쓰지 않는다.
- 새로 알아낸 함정은 `reference/` 의 해당 파일에 기록할지 제안한다.

## 7. 수정과 다음 단계

- **이번 작업이 만든 🔴** (방금 고친 코드가 원인) → 묻지 않고 고친 뒤 **같은 확인을 다시 돌려** 사라졌는지 본다.
- **기존 코드의 🔴 · 모든 🟡** → 보고 뒤 `AskUserQuestion` 으로 고칠지 묻는다. `--fix` 면 묻지 않고 🔴 전부 고친다.
- 재확인할 때 렌더러는 HMR 로 즉시, main/preload 는 재시작(§2 규칙대로).
- **커밋·빌드는 하지 않는다.** 마지막 `AskUserQuestion` 에 다음 단계로 `/commit` · `/commit 후 /build` 선택지를 둔다
  (보고 뒤 사용자 응답 대부분이 "커밋" · "커밋하고 빌드" 였다). 사용자가 고르면 그 스킬로 진행한다.
