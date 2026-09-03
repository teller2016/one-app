---
name: build
description: One App 을 빌드해 /Applications 의 설치본을 교체하고 실행한다. 개발 인스턴스(npm start)는 건드리지 않는다. 사용법 - /build 또는 /build --make 또는 /build --no-launch
---

# /build — 빌드해서 /Applications 에 반영

현재 소스로 `.app` 을 만들어 **`/Applications/One App.app` 을 교체**하고 다시 띄운다.
개발 인스턴스(`npm start`)와 빌드 앱은 **동시에 떠 있는 것이 정상**이므로, 개발 쪽은 종료하지 않는다.

⚠️ **재시작은 확인 없이 자동으로 한다** — 실행 중인 빌드 앱이 있으면 묻지 말고 종료하고,
교체 후 바로 다시 띄운다. 이 절차에서 사용자에게 묻는 경우는 **빌드 실패·서명 검증 실패뿐**이다.

ℹ️ **단독 배포판(One App Lite)은 이 스킬의 대상이 아니다** — 별도 프로젝트라 자기 폴더
(`standalone/lite`)에서 빌드하고 `/Applications` 에 설치하지 않는다. 동료에게 건네는 zip 이
`out/make/zip/...` 에 떨어질 뿐이다. 절차·함정은 `.claude/rules/standalone-lite.md` 와 그 폴더
README 를 볼 것.

## 인자
| 인자 | 동작 |
|------|------|
| (없음) | `npm run package` — `.app` 만 (~1분). 평소엔 이걸 쓴다 |
| `--make` | `npm run make` — 위에 더해 `out/make/zip/darwin/arm64/*.zip` 생성. 남에게 전달할 때만 |
| `--no-launch` | 교체까지만 하고 실행하지 않는다 |

⚠️ **`--make` 가 만드는 것은 `.zip` 뿐이다** — `forge.config.ts` 의 makers 에 macOS 용은
`MakerZIP({}, ['darwin'])` 하나뿐이고 DMG maker 는 없다(나머지 Squirrel·Rpm·Deb 은 win32·linux 전용이라
darwin 빌드에서 건너뛴다). `.app` 자체는 `package` 와 **완전히 동일**하므로, `/Applications` 에 반영하는
것이 목적이라면 `--make` 는 시간만 더 쓴다.

## ⚠️ 반드시 지킬 것
- **서명을 검증하기 전에 교체하지 않는다.** `forge.config.ts` 의 `postPackage` 가 자가서명 인증서
  `One App Sign` 으로 서명하는데, 이 인증서가 없는 Mac 에서는 **서명 없이 조용히 통과**한다.
  서명이 adhoc 이거나 없으면 **`safeStorage` 의 키체인 접근이 끊겨 저장된 계정·비밀번호가 전부 날아간다**
  (2026-07 실사고). 검증에 실패하면 교체하지 말고 사용자에게 보고한다.
- **설정은 싱크할 필요가 없다.** 개발 인스턴스와 빌드 앱은 같은 userData
  (`~/Library/Application Support/One App`)를 **공유**한다 — 설정·프로젝트·터미널 작업영역·계정이
  이미 같은 파일이다. 앱을 교체해도 이 폴더는 건드리지 않으므로 그대로 유지된다.
  (포트·tmux 소켓·창 위치·세션 목록만 갈라져 있다 — `src/main/lib/devInstance.ts`)
- **`/Applications/One App.app` 삭제는 새 빌드가 성공한 뒤에** 한다. 먼저 지우면 빌드 실패 시 앱이 사라진다.

## 절차

### 1. 사전 점검
```bash
npx tsc --noEmit
```
오류가 있으면 **빌드하지 말고** 사용자에게 보고한 뒤 진행 여부를 묻는다.

아이콘 원본(`assets/icon.png`)이 `assets/icon-dev.png` 보다 최신이면 개발 아이콘도 다시 만든다:
```bash
npm run icon:dev
```

### 2. 빌드
```bash
npm run package     # 또는 --make 면 npm run make
```
산출물: `out/One App-darwin-arm64/One App.app`
로그에 `[forge] "One App Sign" 로 서명 완료` 가 보이는지 확인한다.

### 3. 서명 검증 (교체 전 필수)
```bash
codesign -dv --verbose=2 "out/One App-darwin-arm64/One App.app" 2>&1 | grep -E "Authority|Signature"
```
- ✅ `Authority=One App Sign` → 진행
- ⛔ `Signature=adhoc` 이거나 Authority 가 없음 → **중단**하고 보고한다.
  원인은 보통 키체인에 인증서가 없는 것: `security find-identity -v -p codesigning | grep "One App Sign"`
  으로 확인하고, 없으면 사용자에게 알린다(교체를 강행하면 저장된 계정 정보가 날아간다).

⚠️ **이 단계에서 `--verify --deep --strict` 로 판정하지 말 것** — `out/` 은 iCloud 동기화 폴더
(`~/Desktop`) 안이라 `fileproviderd` 가 `com.apple.FinderInfo` 를 계속 다시 붙여 detritus 로 실패한다.
서명 자체는 유효하다. 엄격 검증은 File Provider 밖(`/Applications`)으로 옮긴 6단계에서 한다.
상세는 `.claude/rules/build-packaging.md`.

### 4. 실행 중인 빌드 앱 종료 (묻지 않는다)
```bash
pgrep -fl "/Applications/One App.app/Contents/MacOS/One App"
```
떠 있으면 **확인을 받지 말고 바로** 종료한다(7단계에서 다시 띄우므로 재시작일 뿐이다).
⚠️ **개발 인스턴스가 떠 있는지에 따라 종료 방식이 갈린다** — 두 앱의 이름이 같아서
`osascript -e 'quit app "One App"'` 은 **dev 까지 함께 끈다**(2026-09-01 실측 — 사용자의 dev 를
말없이 내렸다). dev 가 있으면 전체 경로로 빌드 앱만 특정한다.
```bash
if pgrep -f "electron-forge start" >/dev/null; then
  # dev 보존 — 경로로 빌드 앱만. SIGTERM 이라 before-quit 은 안 돌지만 잃는 상태가 없다
  # (tmux 세션은 별개 서버, 팝아웃 배정은 레코드가 남아 재시작 때 복원된다)
  pkill -f "/Applications/One App.app/Contents/MacOS/One App"
else
  osascript -e 'quit app "One App"'   # graceful — dev 가 없을 때만
fi
```
종료 뒤 `pgrep -f "electron-forge start"` 로 **dev 가 살아 있는지 반드시 확인**한다.
- 터미널 세션은 tmux 가 들고 있어 앱을 껐다 켜도 살아남는다 — 잃는 상태가 없으므로 물을 이유가 없다.
- ⚠️ `pkill -f "One App"` 처럼 넓은 패턴을 쓰지 말 것 — 개발 인스턴스나 무관한 프로세스까지 잡는다. 위처럼 **`/Applications/…/MacOS/One App` 전체 경로**여야 빌드 앱만 잡힌다.

### 5. 교체 + 재서명
`/Applications` 는 File Provider 밖이라 여기서 정리한 확장 속성은 **다시 붙지 않는다.**
정리 후 한 번 더 서명해 깨끗한 상태로 확정한다.
```bash
rm -rf "/Applications/One App.app"
cp -R "out/One App-darwin-arm64/One App.app" "/Applications/"
xattr -cr "/Applications/One App.app"
codesign --force --deep --sign "One App Sign" "/Applications/One App.app"
```

### 6. 결과 확인
```bash
defaults read "/Applications/One App.app/Contents/Info.plist" CFBundleShortVersionString
codesign -dv --verbose=2 "/Applications/One App.app" 2>&1 | grep Authority
codesign --verify --deep --strict "/Applications/One App.app" && echo "✅ 검증 통과"
```
버전·서명(`One App Sign`)·엄격 검증 통과를 사용자에게 보고한다.
엄격 검증이 여기서도 실패하면 **실행하지 말고** 보고한다.

### 7. 재실행 (`--no-launch` 가 아니면 항상)
```bash
open -a "/Applications/One App.app"
```
4단계에서 앱을 껐다면 **반드시 여기서 다시 띄운다.** 실행 여부를 사용자에게 되묻지 않는다.

## 보고 형식
- 🔧 빌드: 성공/실패 · 소요 시간
- ✅ 서명: `One App Sign` 확인 여부
- 📁 설치: 교체된 경로 · 버전
- ⚠️ 설정: 공유 userData 라 그대로 유지됨을 한 줄로 확인

## 참고
- Dock 에서 두 앱을 구분하는 방법: 개발 인스턴스는 아이콘 하단에 **오렌지 DEV 밴드** + Dock 뱃지 `DEV`
  + 창 제목 `One App — DEV`. 빌드 앱은 표시가 없다.
- 개발 인스턴스의 MO 터미널 서버는 **포트가 +1** 이다(빌드 앱 18317 / 개발 18318) — 폰에서 접속할 때
  어느 쪽에 붙는지는 이 포트로 갈린다.
