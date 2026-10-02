---
paths:
  - "src/main/features/power/**"
  - "src/renderer/lib/powerState.ts"
---

# 전원·잠자기 (잠자기 상태 감시 · 깨어남 폭주 경고 · 잠자기 중 폴링 중단)

`main/features/power` + `renderer/lib/powerState.ts`

> 배경(2026-09-16): 덮개를 닫고 퇴근했는데 맥이 Wi-Fi/BT 칩 사유(`pmset -g log` 의
> `DarkWake … wifibt SMC.OutboxNotEmpty centauri-beta`)로 **57분 동안 248번** 다크웨이크했다(잠이 평균 10초 단위로
> 쪼개져 깨어 있던 합계는 16분이지만 배터리 80→62%). 가방 안이라 방열이 안 되어 `Thermal Emergency Sleep` → 강제 종료까지 갔다. 같은 폭주가 전날들에도
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
- ⚠️ **토스트 힌트로 `pmset tcpkeepalive` 를 가리키지 말 것**(2026-09-23 수정) — 그 설정은 이미 적용돼
  있고 진짜 원인은 블루투스다. 힌트는 `formatWakeStormToast(summary, { bluetoothOff, wifiOff })` 의 두 번째
  인자로 갈린다: 깨운 사유 쪽(블루투스/Wi-Fi) 토글이 꺼져 있으면 켜라고, 켜져 있는데도 폭주했으면 조건(외부 모니터·전원)을
  보라고 안내한다. 순수 함수를 유지하려고 설정 값은 `wakeReport` 가 읽어 넘긴다. 네 갈래는 `wakeLog.test.ts` 가 고정한다.
- ⚠️ **힌트는 깨운 사유부터 본다**(2026-10-01) — `classifyWakeCause` 가 다크웨이크를 `centauri-beta`=블루투스 ·
  `centauri-alpha`/`E_RX_IP_PACKET`/`E_PFN_NET_FOUND`=Wi-Fi · `rtc/Maintenance`=유지관리로 나누고, **Wi-Fi 가 최다면
  블루투스 얘기를 하지 않는다**. 실측: 블루투스 자동 끄기는 정상(bluetoothd `peripheral manager isn't powered on`)이었는데
  14시간 55분 동안 550회 — 535회가 Wi-Fi. 00:21 다크웨이크 중 아는 Wi-Fi 에 자동 접속(`E_PFN_NET_FOUND`)한 뒤 1시간 동안
  6초 간격으로 깼다. 깨운 패킷은 대부분 **ARP 응답**(airportd `_decodeWoWWakeUpDataPacket` 의 ethertype `0806`)이고,
  깰 때마다 로컬 Java 서버가 DB(1521·3306·6379) 연결을 시도했다. 배터리 영향은 80→78% 로 작았다. `womp`(배터리)는 이미 0 이다.
  → 2026-10-02 재발(9시간 4176회)로 **잠잘 때 Wi-Fi 끄기**를 만들었다(아래 절). Wi-Fi 가 최다면 힌트가 그 토글을 가리킨다.
- `Sleep/Wakes since boot … Dark Wake Count in this sleep cycle:N` 요약 줄은 쓰지 않는다 — 잠든 시각 기준으로
  자를 수 없다. 표본 줄과 규칙은 `wakeLog.test.ts`.

## `pmset -g log` 의 `N secs` 읽는 법
⚠️ **Sleep 줄 끝의 `N secs` 는 그 잠자기가 이어진 길이, DarkWake/Wake 줄의 `N secs` 는 그 깨어남이 이어진 길이**다
(다음 줄 시각과 맞춰 보면 확인된다). 처음 조사 때 거꾸로 읽어 "41분 깨어 있었다" 고 보고했다 — 실제는 16분(2026-09-17 정정).

## ⚠️ 통합 로그는 `/usr/bin/log` 로 부를 것
zsh 에는 내장 `log` 명령이 있어 `log show …` 가 **조용히 빈 결과**를 낸다(`too many arguments` 가 stderr 로만 나온다).
첫 조사에서 이 때문에 "강제 종료로 로그가 안 남았다"고 오판했다(2026-09-20 발견). 보존 기간은 며칠이라 사고 당일 로그는 이미 없다.

## 진짜 범인은 블루투스 HID 자동 재연결 루프다 (2026-09-20 확정)
덮개를 닫아 입력장치(MX Master 3 · MINI_KEYBOARD · 로프리 키보드 2대 = HID 4대)가 끊기면 bluetoothd 가 4대에 재연결을
걸어 둔 채(`fConnectingDevices.size:4`, `HIDProfile::startHIDAutoConnect`) 잠들고, Wi-Fi/BT 콤보 칩이 저전력 진입에
실패해(`centaurid` `Controller-S2REntry` 오류, `wifibt … centauri-beta` 다크웨이크) 맥을 깨운다. 깨면 BLE 주소가 바뀌어
연결 시도를 취소하고 다시 처음부터 → 반복. 시간대별 칩 오류 수 = 다크웨이크 수(09-19 146회 중 127건, 09-20 207회 전부).
`tcpkeepalive 0` 은 Wi-Fi 쪽 연쇄만 끊어 발열은 막았지만(잠이 길어짐) 깨어남 자체는 남았다(09-20 10시간 207회·배터리 80→63%).
후보 조치: 덮개 닫기 전 블루투스 끄기 → 안 쓰는 HID 페어링 해제 → **One App 자동 off/on(아래 절에서 구현)**
→ macOS 26.7 업데이트(26.6.2 에서 가용, 효과 미확인). **2026-09-23 자동 off/on 으로 해결됐다**(아래 절) —
안 쓰는 HID 페어링 해제는 이제 선택 사항이다.

## 근본 조치는 OS 전원 설정이다
앱은 감지·절감만 한다. 폭주 자체는 배터리에서도 켜져 있던 **잠자기 중 네트워크 유지**가 Wi-Fi/BT 칩을
살려 둔 것이 유력해, 사용자가 직접 `sudo pmset -b tcpkeepalive 0 && sudo pmset -b powernap 0` 을 적용했다
(배터리 전원에만 — 덮개 닫고 배터리일 때 푸시 알림을 못 받는 대신 잠을 잔다). 확인은 다음 덮개 닫기 뒤
`pmset -g log | grep -c "DarkWake from"` 과 복귀 토스트.
**2026-09-17 첫 검증**: 02:54 덮개 닫힘 → 10:04 복귀(7시간), `TCPKeepAlive=disabled` 확인, 다크웨이크 86회(그중
`wifibt centauri-beta` 77회)지만 3~4회 묶음 뒤 1~2시간씩 푹 잠들어 깨어 있던 합계 12분·배터리 80%→80%·발열 없음.
즉 wifibt 깨우기 자체는 남아 있으나(블루투스 코어 추정) 설정 뒤로는 연쇄가 끊겨 무해하다. 토스트는 시간당 12회로
임계(15회/h) 아래라 뜨지 않았다 — 의도된 동작.

- ⚠️ 덮개가 **열린** 상태에서 Claude Code 가 작업 중이면 `caffeinate -i -t 300` 을 띄워 유휴 잠자기를 막는다
  (`pmset -g` 에 `sleep prevented by caffeinate`). Claude Code 의 의도된 동작이고 덮개 닫힘 잠자기는 못 막으니
  이 기능이 다룰 일이 아니다.

## 잠잘 때 블루투스 끄기 (`bluetooth.ts` + 공통 `radioSwitch.ts`·`unattended.ts`·`store.ts`, 2026-09-22)
> 2026-10-02 Wi-Fi 끄기를 더하면서 **끄고 되돌리는 순서를 `radioSwitch.ts`(`createRadioSwitch(driver)`)로,
> 세 조건 판정을 `unattended.ts` 로** 옮겼다. `bluetooth.ts`·`wifi.ts` 는 "무슨 명령으로 읽고 쓰는지" 만 담은
> 드라이버다. 아래 블루투스 절의 함정(기록 먼저·덮개 열림에서만 복구·재시도)은 이제 공통 흐름의 규칙이고 Wi-Fi 도 똑같이 따른다.

위 재연결 루프를 잠들기 전에 끊는다. 환경설정 → **전원** 의 토글(`settings.json` 의
`sleepBluetoothOff`, **기본 off — 입력장치를 끄는 동작이라 옵트인**)이 켜져 있을 때만 동작한다.
`blueutil`(Homebrew, IOBluetooth 사설 API 래핑)이 필요하고, 없으면 환경설정이 설치 안내를 띄운다.

### 끄는 조건은 3개의 AND 다 — 이게 이 기능의 핵심이다
| 조건 | 판정 | 왜 |
|------|------|-----|
| 덮개 닫힘 | `ioreg -r -k AppleClamshellState` | 사고 조건이 덮개 닫고 가방 |
| 외부 모니터 없음 | `screen.getAllDisplays().some(d => !d.internal)` | **클램셸 사용 중 보호** |
| 배터리 전원 | `powerMonitor.isOnBatteryPower()` | AC 는 책상 = 쓰는 중 |

- ⚠️ **외부 모니터 조건을 빼지 말 것.** 사용자는 모니터 2대에 덮개를 닫고 쓰는 클램셸 사용자다.
  거기서 블루투스를 끄면 **키보드·마우스로 맥을 깨울 수 없다**(덮개를 열어야만 복구된다).
  덮개를 닫고도 맥이 깨어 있으려면 외부 디스플레이가 필수라, 이 조건이 클램셸을 정확히 걸러낸다.
- ⚠️ **`suspend` 핸들러 안에서 동기(`execFileSync`)로 부른다** — 비동기로 미루면 맥이 먼저 잠들어
  결과를 못 받는다. 그래서 타임아웃을 3초로 짧게 끊는다.
- ⚠️ **`blueutil` 은 절대 경로로 찾는다**(`/opt/homebrew/bin` → `/usr/local/bin` → `/opt/local/bin`) —
  GUI 로 뜬 Electron 의 `PATH` 에는 Homebrew 경로가 없어 이름만 부르면 설치돼 있어도 ENOENT 다.
- ⚠️ `ioreg` 출력에는 `AppleClamshellCausesSleep` 이라는 비슷한 키가 함께 나온다 — 키 이름을
  따옴표까지 붙여 정확히 맞출 것.

### 되돌리는 경로는 3개다 (우리가 끈 경우에만)
`power.json` 의 `btOffAt`(Wi-Fi 는 `wifiOffAt`) 플래그가 근거다 — 사용자가 직접 꺼둔 장치를 켜지 않기 위함이고,
⚠️ **메모리가 아니라 파일에 둔다**(발열 강제 종료로 앱이 죽어도 다음 실행이 되돌려야 한다).
⚠️ 키 이름 `btOffAt` 은 바꾸지 말 것 — 이미 저장된 파일의 복구 근거다.

1. `resume` 에 **덮개가 열렸으면** 즉시 (`restoreIfLidOpened`)
2. 완전 복귀(`fullWake`)
3. 앱 시작 — 비정상 종료로 플래그가 남은 경우

- ⚠️ **덮개가 닫힌 채 깬 것(다크웨이크)에서 켜면 안 된다** — 재연결 루프가 되살아나 이 기능이
  막으려던 폭주를 그대로 재현한다. 그래서 1번이 덮개를 먼저 본다.
- ⚠️ 1번을 넣은 이유: 블루투스를 꺼두면 **입력장치 자체가 없어** `getSystemIdleTime` 기반 완전 복귀
  판정이 영영 안 걸릴 수 있다(내장 키보드를 안 쓰면). 덮개 열림을 복귀 신호로 함께 본다.
- 복구 **실패**는 sticky 토스트로 알리고 플래그를 남긴다(다음 기회에 재시도) — 입력장치가 안 돌아온
  채 조용히 넘어가면 사용자가 원인을 알 수 없다.
- ⚠️ **`suspend` 는 진행 중인 복구부터 거둔다**(`cancelRestore` — 토글과 무관, 2026-10-02 리뷰) — 덮개를 열자마자(첫 시도 실패 →
  1·3·7초 재시도 대기) 다시 닫으면 ① 남은 재시도가 다음 다크웨이크에서 장치를 켜고(재연결 루프 재현) ② 잠들기와 엇갈려 늦게
  성공한 켜기가 방금 남긴 "껐다" 기록을 지워 **꺼짐 + 기록 없음**이 됐다. 세대(`restoreGen`)를 올려 늦은 결과를 버리고 켜기
  자식 프로세스를 죽인다. 판정(`judgeUnattended`)은 `onSuspend` 가 한 번 해서 장치마다 넘기고, 판정이 거절이면 장치 찾기도 안 돈다.
- ⚠️ Wi-Fi 장치 이름은 **끌 때 목록에서 찾은 값을 프로세스 동안 기억**한다(`wifi.ts`) — 깨어나는 순간 `networksetup` 이
  configd 에 붙잡혀 목록 조회가 한 번 타임아웃 나면 "장치 없음" 분기로 끈 기록까지 지워졌다.

### 실측·검증 (2026-09-22)
- Electron API: `internal` 플래그가 내장/외부를 정확히 가른다(내장 Retina + LG QHD 2대 →
  `hasExternal: true`), `isOnBatteryPower()`·`ioreg` 모두 기대대로.
- **`pmset sleepnow` 로 E2E 검증** — `suspend` 훅 도달 · AC 조건으로 **끄기 정상 거절**(BT `1` 유지) ·
  `resume` → 덮개 열림 감지 → 복구 경로 진입 · 실패 시 플래그 유지 + sticky 토스트 · 앱 시작 복구 성공.
- ⚠️ **복구 첫 시도가 실패했다** — 평상시 Electron 에서 같은 `blueutil -p 1` 은 성공하는데 `resume`
  직후에만 실패했다(깨어나는 중엔 블루투스 스택이 준비되지 않는다). **한 번 시도하고 포기하면
  입력장치가 안 돌아온 채 방치된다** → `RESTORE_RETRY_MS = [0, 1s, 3s, 7s]` 4회 재시도로 보강.
  복구만 비동기(`execFile`)다 — 잠들기 직전이 아니라 main 을 멈출 이유가 없다. 끄기는 동기 유지.
- ⚠️ **`pmset sleepnow` 로는 잠자기 검증이 잘 안 된다** — MX Master 3 가 5초 만에 깨웠다
  (`Display is turned off` → `UserIsActive … MX Master 3` → `Display is turned on`, `Sleep/Wakes … :0`).
  화면만 꺼졌다 켜진 것이라 실제 Sleep 진입은 0회다. 판정은 `pmset -g log | grep "<오늘 날짜>"` 로 할 것.
  (부수 확인: `bluetoothd` 가 `PreventUserIdleSystemSleep "com.apple.BTStack"` 을 잡고 있고, 잠자기를
  막는 `NoIdleSleepAssertion "Electron"` 은 **Antigravity IDE** 다 — One App 은 여전히 assertion 이 없다.)
- ⚠️ **main 변경 뒤 dev 재시작은 PID 시작 시각으로 확인할 것** — 창 새로고침은 렌더러 helper 만
  새로 뜨고 **main 은 옛 코드 그대로**다(실측: renderer 11:51 / main 11:33). `npm start` 를 통째로 다시 띄운다.
- **✅ 실사용 검증 성공 (2026-09-22 16:32 → 09-23 08:53, 16시간 20분 덮개 닫힘·배터리)**:
  다크웨이크 **19회(시간당 1.2회)** · 깨어 있던 합계 4분 6초 · 배터리 80%→76% · 발열 0건.
  **`wifibt`/`centauri-beta` 사유가 2건까지 떨어졌다** — 09-20 에는 207회 **전부**가 이 사유였다.
  남은 19회는 `rtc/Maintenance` 13 · `AOP` 4 로 정상적인 유지관리 깨어남이다.

  | 시점 | 조치 | 다크웨이크 | 시간당 | 배터리 |
  |------|------|-----------|--------|--------|
  | 09-16 | 없음 | 248회/57분 | 261회 | 80→62% |
  | 09-20 | `tcpkeepalive 0` | 207회/10h | 20.7회 | 80→63% |
  | 09-22~23 | **+ BT 자동 끄기** | **19회/16.3h** | **1.2회** | 80→76% |

  통합 로그의 증거(보존기간 내에만 보인다): 잠든 뒤 `bluetoothd` 의
  **`Stack user controller stopped` → 16시간 무로그 → 복귀 시각에 활동 재개**. 복구도 정상
  (`power.json` 비워짐 · BT `1` · 실패 토스트 없음).
- ⚠️ `blueutil -p 0` 을 **개발 중에 그냥 돌리지 말 것** — 사용자의 키보드·마우스가 그 자리에서 끊긴다.

### lite 에 딸려 보내지 않기
`blueutil` 조회는 `features/power/ipc.ts`(`power:blueutil:check`)에 두고 `registerPowerIpc()` 로 등록한다.
⚠️ **`registerSettingsIpc()` 쪽에 두면 안 된다** — 단독 배포판(lite)도 그 함수를 부르므로 전원 기능
코드가 lite 번들에 딸려간다. 렌더러는 `window.oneApp.power?.checkBlueutil?.()`(옵셔널 — 구 preload·폰 셸에 없다).

## 잠잘 때 Wi-Fi 끄기 (`wifi.ts`, 2026-10-02)
블루투스를 끈 뒤에도 덮개 닫힘(배터리) 9시간 동안 **4176번** 깼다 — 사유 전부 `centauri-alpha E_RX_IP_PACKET`,
배터리 54→39%. 한 번 깨면 powerd 가 `"PM configd - Wait for Device enumeration"` 으로 **5초 붙잡고** 2초 자다 다음
패킷에 또 깨서, 9시간 중 **71%를 깨어 있었다**(깨어 있던 합계 377분 / 잠든 합계 155분).

### 범인 찾는 법 — airportd 가 깨운 패킷을 남긴다
`pmset -g log` 의 `WakeDetails` 와 powerd 통합 로그는 `<private>` 로 가려지지만, **airportd 가 원본 프레임을 hex 로 남긴다**:
```
/usr/bin/log show --start "<시각>" --info --predicate 'process == "airportd" AND eventMessage CONTAINS "WoWWakeUpData:"'
```
`'<fcb214b8beaf 00300dbf8e10 0806 0001 0800 0604 0002 …>'` = 목적지 MAC · 출발 MAC · ethertype(`0806` ARP / `0800` IPv4)
· ARP opcode(`0002` 응답). 보존은 몇 시간~하루라 그날 아침에 볼 것. 10-02 집계(1300여 건): **공유기 → 맥 ARP 응답 1001건(77%)** ·
IPv6 122 · IoT 기기·맥 자신의 gratuitous ARP 수십 건. → 맥 안의 무언가가 **깰 때마다 바깥으로 접속을 시도**해 공유기 주소를 묻고,
그 응답이 잠든 맥을 다시 깨우는 연쇄다. 그때 떠 있던 소켓을 `lsof -i -nP | grep SYN_SENT` 로 찾으면 된다.
- 10-02 범인: femc Claude 세션(`claude --agent metacommerce-orchestrator`) 2개가 띄운 **`mcp-oracle-database`** 가 사내 DB
  `192.168.176.129:1521`(사무실·VPN 밖에선 안 닿음)에 **15초마다 재접속**. 10-01 의 범인은 로컬 Java 서버(DB 1521·3306·6379)였다.
  범인이 매번 바뀌므로 프로세스가 아니라 Wi-Fi 를 끊는다.
- ⚠️ **같은 망 IoT 기기의 브로드캐스트는 범인이 아니었다** — 집 망에 Tuya 플러그(`.50`, UDP 6667 5초)·로보락(`.45`, 58866 5초)·
  삼성 폰(`.16`, 15600 6초)이 상시 뿌리지만 깨운 패킷 집계에는 거의 없다. 간격이 비슷해 보인다고 단정하지 말 것.
- ⚠️ **adb(5353 mDNS 7초 질의)도 아니었다** — 질의 주기가 깨어남 주기(7초)와 같아 의심했지만, 깨어남 주기는
  "5초 붙잡힘 + 2초 잠" 으로 **어떤 패킷이 오든 7초 언저리**가 된다. 주기 일치는 증거가 아니다.
- 폭주는 **아는 Wi-Fi 에 붙어 있는 동안만** 난다(퇴근 덮개 닫기 직후 사무실 2분 · 집 도착 `E_PFN_NET_FOUND` 뒤 밤새, 이동 중엔 0).

### 구현
- 조건·순서는 블루투스와 같다(`radioSwitch.ts` · `unattended.ts`). 토글은 환경설정 → 전원 `잠잘 때 Wi-Fi 끄기`
  (`settings.json` 의 `sleepWifiOff`, **기본 off — 네트워크를 끊는 동작이라 옵트인**). 관리자 권한·설치 도구가 필요 없다.
- 명령: `/usr/sbin/networksetup -setairportpower <장치> off|on`, 읽기 `-getairportpower <장치>`(`Wi-Fi Power (en0): On`).
  장치는 `-listallhardwareports` 의 `Hardware Port: Wi-Fi` 다음 줄 `Device:` 로 **정확히** 찾는다.
- ⚠️ **장치 이름을 짐작해 넘기지 말 것** — `networksetup -setairportpower <Wi-Fi 가 아닌 이름> off` 는 실패하지 않고
  `Turning off the only airport interface found: en0` 를 찍으며 **진짜 Wi-Fi 를 끈다(exit 0)**. 2026-10-02 오류 동작을 보려고
  `en9` 를 넣었다가 사용자 Wi-Fi 를 1~2분 꺼 버렸다(유선 en7 덕에 세션은 살았다). **개발 중에 `-setairportpower` 를 돌리지 말 것.**
- ⚠️ 같은 이유로 **종료 코드를 믿지 않는다** — 드라이버가 `verifyWrite: true` 로 쓰고 나서 다시 읽어 확인한다
  (블루투스는 기존 동작 그대로 종료 코드만 본다).
- 대가: 꺼 둔 동안(가방 안) '나의 Mac 찾기'·폰 MO 접속이 안 된다. 덮개를 열면 `restoreIfLidOpened` 로 즉시 켜고 몇 초 안에 재연결된다.
- 검증 상태(2026-10-02): `tsc`·`lint`·`test`·lite `typecheck`·`reach` 통과, 장치·전원 정규식은 실제 출력으로 확인.
  **실제 잠자기 끄기/켜기는 아직 미검증** — 다음 덮개 닫힘의 `pmset -g log`(E_RX_IP_PACKET 수)와 `[power] Wi-Fi를 껐습니다` 로그로 확인할 것.
