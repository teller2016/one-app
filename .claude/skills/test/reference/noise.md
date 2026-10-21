# 무해한 노이즈 — 실측 기준선 (2026-09-01~)

정상 기동·정상 종료에서 나오는 것들이다. **이것들은 이슈가 아니다.** 새로 판명될 때마다 추가한다.
⚠️ 반대로 **여기 없는 에러는 "무관해 보여도" 🟡 로 보고한다** — 10-02 `workspaces:worktrees` 에러를 무관한 기존 문제로
넘겼다가 10-06 사용자가 같은 원인의 버그(작업 시작 모달 막힘)를 직접 신고했다.

## 기동 시 `dev.log`
```
Port 5173 is in use, trying another one...     ← 3줄. Vite 엔트리가 renderer·mobile·mobile_app
Port 5174 is in use, trying another one...        3개라 한 프로세스가 5173·5174·5175 를 차례로 잡는다
DevTools listening on ws://127.0.0.1:9333/...  ← --remote-debugging-port 를 준 결과
```
✅ **정상 기동 구간에는 `error|exception|unhandled|rejection|EADDRINUSE|failed` grep 이 0건이다.** 기동 로그에서 걸리면 진짜 이슈일 가능성이 높다.

## 렌더러 콘솔 (정상값)
| 종류 | 내용 |
|------|------|
| debug | `[vite] connecting...` · `[vite] connected.` |
| info | `Download the React DevTools for a better development experience…` |
| **error·pageerror** | **0건이 정상** |

## 종료 시에만 (`dev.sh down` 직후) — ⚠️ grep 전에 이 구간을 배제할 것
```
GPU process exited unexpectedly: exit_code=15          ← 15 = SIGTERM, 내가 죽인 결과
Network service crashed or was terminated, restarting
Error sending from webFrameMain: Render frame was disposed before WebFrameMain could be accessed
    at broadcast (.vite/build/main.js:…)  ← 스택에 broadcast·node-pty flush 가 찍힌다
[main] 렌더러 종료: killed 15
(node:<pid>) electron: Failed to load URL: http://localhost:5173/ with error: ERR_CONNECTION_REFUSED
```
`webFrameMain` 줄은 코드 결함이 아니다 — `main/lib/broadcast.ts` 는 `isDestroyed()` + `try/catch` 를 하지만
`webContents.send` 는 동기로 던지지 않고 Electron 내부가 자체 `console.error` 로 찍는다. 종료 중 렌더러가 먼저 죽고 pty flush 가 남아 생긴다.
> ⚠️ 단, **종료가 아닌 평상시에 반복되면 조사할 것** — 닫힌 팝아웃 창으로 계속 보내고 있다는 신호일 수 있다.

로그를 볼 때는 종료 시각 이후를 잘라내고 grep 한다(줄머리 타임스탬프 `[pid:MMDD/HHMMSS…]`).

## macOS 시스템 노이즈
```
Electron[<pid>:...] error messaging the mach port for IMKCFRunLoopWakeUpReliable
```
macOS 입력기(InputMethodKit)가 창 포커스를 주고받을 때 찍는다. 앱 코드와 무관.

## MO(폰) 페이지 — dev 에서만 (로드 1회당)
- 폰 콘솔 3건: Vite HMR 소켓이 MO 서버에서 `403` → `wss://localhost:5173` `ERR_SSL_PROTOCOL_ERROR` → `[vite] failed to connect to websocket`
- main `dev.log`: `[term:upgrade] read ECONNRESET` 한 줄 (HMR 소켓이 끊기는 것)
- 첫 로드 때 404 1건이 Vite 의 `optimized dependencies changed. reloading` 과 같은 시각에 날 수 있다

## 확인된 기준값
- 섹션 **12개**: 터미널 / Jira / Nightwatch / PR / 배포 / 포트 / 프로젝트 / 딥링크 / 결재 / 일정 등록 / 주간보고 / 환경설정
  (`App.tsx` 의 `SECTIONS` 가 정본). 사이드바에 보이는 개수는 메뉴 숨김(`sidebarHidden`)에 따라 줄 수 있다 — `smoke.mjs` 가 팔레트로 전체를 센다.
- 연 섹션마다 `.err-box` 0건 · 콘솔 에러 0건 이 정상.
