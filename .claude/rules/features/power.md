---
paths:
  - "src/main/features/power/**"
  - "src/renderer/lib/powerState.ts"
---

# 전원·잠자기 (잠자기 상태 감시 · 깨어남 폭주 경고 · 잠자기 중 폴링 중단)

`main/features/power` + `renderer/lib/powerState.ts`

> 배경(2026-09-16): 덮개를 닫고 퇴근했는데 맥이 Wi-Fi/BT 칩 사유(`pmset -g log` 의
> `DarkWake … wifibt SMC.OutboxNotEmpty centauri-beta`)로 **57분 동안 248번** 다크웨이크해 41분을 켜진 채
> 있었고, 가방 안이라 방열이 안 되어 `Thermal Emergency Sleep` → 강제 종료까지 갔다. 같은 폭주가 전날들에도
> 매일 있었다(98회·112회). One App 은 잠자기를 막지 않았지만(assertion·wake request 없음) 폴러 타이머가
> 다크웨이크마다 헛돌았고, 터미널 안 Claude 세션이 돌린 도커 빌드가 직전까지 돌고 있었다.

## 잠자기 상태 (`sleepState.ts`)
- **`suspend` → 잠자기**, 해제는 **사람이 깨운 증거가 있을 때만**: 화면 잠금 해제(`unlock-screen`) 또는
  resume 뒤 5초 주기로 `powerMonitor.getSystemIdleTime()` 을 봐서 **resume 이후에** 입력이 있었을 때.
- ⚠️ **`powerMonitor` 의 `resume` 은 다크웨이크에도 발화한다** — 그걸 복귀로 보면 폴러가 다크웨이크마다
  깨어난다. 다크웨이크는 몇 초 만에 다시 `suspend` 가 와서 입력 감지 타이머를 걷어낸다.
- ⚠️ 입력 시각은 **resume 시각과 비교**한다 — `getSystemIdleTime` 은 마지막 입력 이후 초라, 덮개를 닫기
  직전의 타이핑이 첫 다크웨이크(잠든 3초 뒤)에서 "최근 입력" 으로 잡힌다.
- ⚠️ **창 포커스(`browser-window-focus`)를 복귀 증거로 쓰지 말 것** — `notify()` 알럿이 `app.focus({steal})`
  로 창을 앞으로 가져와 다크웨이크 중에도 발화할 수 있다. 같은 이유로 근태 틱은 잠자기 중 아무것도 하지 않는다.
- 상태는 `power:state`(`PowerState {asleep}`) 로 broadcast — 렌더러 `lib/powerState.ts` 가 한 번 구독해
  `isSystemAsleep()`·`onSystemWake()` 로 공유하고, main 안은 `features/power`(index) 의 `isSystemAsleep()`.
- **소비자**: `usePolling`(틱 건너뛰기 + 완전 복귀 즉시 따라잡기) · 근태 리마인더 `tick` · VPN 감시
  `checkInterfaces`/`runProbe`. 새 폴러는 `usePolling` 을 쓰면 저절로 따라온다.
- 폰(MO)·구 preload 에는 `power` 브리지가 없다 → 항상 깨어 있는 것으로 본다(옵셔널 가드). 폰은 맥이
  잠들면 WS 자체가 끊기고 복귀 신호도 못 받아 멈추면 영영 안 풀린다 — `oneApp.test.ts` 의 `DESKTOP_ONLY`.

## 깨어남 폭주 경고 (`wakeReport.ts` + 순수 규칙 `wakeLog.ts`)
- 완전 복귀 때 **한 번만** `pmset -g log` 를 읽어 [처음 잠든 시각, 지금] 구간을 집계한다 — 다크웨이크 수·
  완전 깨어남 수·배터리 시작/끝·덮개 닫힘(`'Clamshell Sleep'`)·발열 비상(`Thermal Emergency`)·어댑터(`Using AC`).
- ⚠️ 로그가 **14MB / 2.4초**(2026-09-17 실측, 부팅 뒤 며칠치) — `maxBuffer` 64MB, 10분 미만 잠자기는 생략,
  다크웨이크마다 돌리지 말 것(그 자체가 부하).
- 폭주 판정: 발열 비상이면 무조건, 아니면 **다크웨이크 20회 이상이면서 시간당 15회 이상**. 실측 기준값 —
  폭주 09-16 248회/57분·09-14 98회/3h·09-15 112회/5.4h, 정상 밤새는 한 자릿수.
- 알림은 `sendToast`(sticky, `dedupeKey: 'power-wake-storm'`) — 복귀한 사용자가 One App 을 볼 때 그대로
  있으면 된다. 알럿(`notify`)으로 바꾸지 말 것(포커스를 뺏을 이유가 없다).
- `Sleep/Wakes since boot … Dark Wake Count in this sleep cycle:N` 요약 줄은 쓰지 않는다 — 잠든 시각 기준으로
  자를 수 없다. 표본 줄과 규칙은 `wakeLog.test.ts`.

## 근본 조치는 OS 전원 설정이다
앱은 감지·절감만 한다. 폭주 자체는 배터리에서도 켜져 있던 **잠자기 중 네트워크 유지**가 Wi-Fi/BT 칩을
살려 둔 것이 유력해, 사용자가 직접 `sudo pmset -b tcpkeepalive 0 && sudo pmset -b powernap 0` 을 적용했다
(배터리 전원에만 — 덮개 닫고 배터리일 때 푸시 알림을 못 받는 대신 잠을 잔다). 확인은 다음 덮개 닫기 뒤
`pmset -g log | grep -c "DarkWake from"` 과 복귀 토스트.

- ⚠️ 덮개가 **열린** 상태에서 Claude Code 가 작업 중이면 `caffeinate -i -t 300` 을 띄워 유휴 잠자기를 막는다
  (`pmset -g` 에 `sleep prevented by caffeinate`). Claude Code 의 의도된 동작이고 덮개 닫힘 잠자기는 못 막으니
  이 기능이 다룰 일이 아니다.
