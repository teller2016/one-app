---
paths:
  - "src/main/features/settings/**"
  - "src/main/features/vpn/**"
  - "src/main/features/mirror/**"
  - "src/main/features/notify/**"
  - "src/main/features/tray/**"
  - "src/main/features/applink/**"
  - "src/renderer/features/settings/**"
  - "src/renderer/features/vpn/**"
  - "src/renderer/features/mirror/**"
  - "src/renderer/features/applink/**"
---

# 시스템·위젯 기능 (환경설정 · VPN · 미러링 · 알림 · 트레이 · 딥링크)

> **사이드바 위젯(VPN·미러링·근태)은 공용 `SidebarWidget` 셸로 감싼다** — 사이드바가 접히면
> 아이콘 타일만 남고, 누르면 위젯 본체가 오른쪽 팝오버로 펼쳐져 접은 채로 전부 조작된다.
> 새 위젯을 만들 때도 이 셸을 쓸 것. 상세·함정은 `renderer-ui` 규칙의 '축소 사이드바' 절.

## 환경설정
`renderer/features/settings` + `main/features/settings`

비즈박스 ID/비밀번호 관리 + **터미널 입력대기 알림 강도**(터미널 그룹 — `terminal:notify-level` IPC, 즉시 저장) + **테마(시스템/라이트/다크)** — 테마는 [저장] 없이 세그먼트 변경 즉시 적용·저장(`settings:theme:set`). 적용은 `renderer/lib/theme.ts`(`<html data-theme>` + localStorage 미러 — 부팅 플래시 방지), 다크 토큰은 `_base.scss` 의 `:root[data-theme='dark']` 블록, main 은 창 생성 시 `theme`+`nativeTheme` 으로 backgroundColor 선택.

연동 설정(Jira 주소·이메일·API 토큰, Gitea 주소·토큰)과 알림 설정(`settings.notifyDeploy`), 로그인 시 자동 시작 토글도 여기에 있다.

## 알림 (공통 인프라)
`main/features/notify`

`notify({title, body, section, action})` 호출 시 앱 창을 앞으로 가져와(`app.focus({steal:true})`) **알럿(`dialog.showMessageBox`)** 으로 표시.

- `section` 지정 시 '이동' 버튼 → `app:navigate` IPC 로 해당 섹션 이동(App.tsx `onNavigate` 구독)
- `action`(버튼 라벨) 지정 시 그 버튼이 기본 버튼이 되고 **클릭 여부를 반환**해 호출부가 후속 동작을 처리한다
- macOS 미서명/개발 모드에서 Electron `Notification` 이 표시되지 않아(UNErrorDomain 1) OS 알림 권한과 무관한 알럿 방식을 사용한다
- 창이 닫혀 있으면(맥) 알럿만 독립적으로 뜬다. 창 참조는 `main.ts` 에서 `setNotifyWindow()` 로 등록
- 사용처: ①배포 완료/실패 알림(환경설정 `settings.notifyDeploy` on/off) ②출퇴근 리마인더
- 환경설정에 **테스트 알림 버튼**(`notify:test` IPC → `window.oneApp.testNotification()`)이 있어 모양 확인 가능

**새 알림이 필요하면 이 모듈을 재사용한다.**

## VPN
`renderer/features/vpn` + `main/features/vpn`

사이드바 하단 위젯. Homebrew `openvpn` CLI(**필수 의존성**, `/opt/homebrew/sbin/openvpn`)를 osascript 관리자 인증으로 root 데몬 실행하고, management 인터페이스(127.0.0.1 TCP + 비밀번호 파일)로 자격증명 전달·상태 추적·해제(SIGTERM).

비밀번호는 Google OTP — 위젯 설정에 TOTP 시크릿 키를 저장하면 자동 생성(`totp.ts`, RFC 6238), 없으면 매번 수동 입력. 계정·시크릿은 `safeStorage` 암호화로 `userData/vpn.json` 에 저장.

**앱을 종료해도 VPN 데몬은 유지**되고, 재시작 시 `userData/vpn/session.json` 으로 management 에 재접속해 상태 복원. openvpn 로그는 `userData/vpn/openvpn.log`(root 소유).

## 폰 미러링
`renderer/features/mirror` + `main/features/mirror`

사이드바 하단 위젯(맨 위 — 미러링→VPN→근태 순). Homebrew `scrcpy`(선택 의존성)를 spawn — 바탕화면 'Mirror USB.app'·'Control USB.app' 이식.

**두 모드**: `미러링`(`-d --turn-screen-off` — 화면 미러+폰 화면 끔) / `제어`(`-d --no-video --no-audio --keyboard=uhid --mouse=uhid` — 화면 없이 맥 키보드·마우스로 폰 조작). 한 번에 한 모드만.

`adb devices -l` 로 USB 기기 모델명을 표시하고 기기 없으면 버튼 비활성. **기기가 붙어 있으나 쓸 수 없는 상태는 원인을 그대로 표시**(`MirrorDeviceIssue` = unauthorized/offline/no-permission → 위젯 라벨 + 해결 힌트, 문구는 `shared/types.ts` 의 `MIRROR_DEVICE_ISSUE_TEXT` 한 곳 — main 의 실행 실패 사유와 공용).

scrcpy 창을 닫으면 exit 이벤트로 위젯 상태 자동 갱신(`mirror:changed`), 비정상 종료는 stderr 마지막 줄을 에러로 표시. 앱 종료 시 scrcpy 도 함께 종료됨(VPN 과 달리 독립 유지 안 함). 설정·저장 없음.

### ⚠️ adb 함정
- **adb 데몬은 콜드 시작이 3초를 넘는다** — 폰 감지(`mirror/scrcpy.ts`)의 타임아웃을 3초로 두면 데몬이 식어 있을 때 매번 실패한다(실측 콜드 3.03초 / 웜 0.01초). 10초 + 조회 전 `adb start-server` 로 해결. 감지 실패 시 `adb devices -l` 을 직접 돌려 데몬 상태부터 확인할 것.
- **"연결했는데 기기 인식 안 됨" 의 실제 원인 1위는 `unauthorized`** — 폰 화면이 잠긴 채 케이블을 꽂으면 "USB 디버깅 허용" 팝업이 잠금화면 뒤에 가려지고, 승인 없이 방치되면 `adb devices` 가 `unauthorized` 로 남는다(2026-08-05 실측). "이 컴퓨터에서 항상 허용" 을 체크하지 않으면 재연결마다 반복된다. 해결은 폰 잠금 해제 → 재연결 → 항상 허용 체크(팝업이 안 뜨면 개발자 옵션 → **USB 디버깅 승인 취소** 후 재연결).
- ⚠️ **파싱에서 이 상태를 버리지 말 것** — 예전 코드가 `unauthorized|offline` 행을 필터로 제외해 `device: null` 로만 만들었고, 위젯이 '기기 없음' 만 띄워 케이블·포트를 의심하게 했다.

## 트레이·자동 시작
`main/features/tray`

메뉴바 아이콘(항상 표시) — One App 열기 / 출근·퇴근 찍기(확인 대화상자 → `runAttendance` → 결과 알럿 + `attendance:changed` 로 위젯 갱신) / 종료. 창을 닫아도 macOS 에선 앱이 상주하므로 트레이로 복귀.

**로그인 시 자동 시작**은 환경설정 → 일반 토글(`app:autostart:get/set` IPC, OS 로그인 아이템이 원본이라 파일 저장 없음, 패키징 앱에서 실질 동작).

## 딥링크 (applink.kr)
`renderer/features/applink` + `main/features/applink`

applink.kr 디퍼드 딥링크(단축 URL) 생성. 클라이언트 JS 호출이 막혀 있어 **main 에서** `POST /deeplink/deeplink_create.asp` 를 호출(`X-API-KEY` + `$canonical_url`·선택 OG 필드). **API 키는 safeStorage 암호화**로 `userData/applink.json` 에만 저장. UI 는 키 관리 + 대상 URL + 접이식 공유 정보(제목·설명·이미지·PC 링크) + 생성 시 클립보드 자동 복사 + 이번 세션 생성 목록.
