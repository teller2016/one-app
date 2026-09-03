---
name: release
description: One App Lite(단독 배포판)를 빌드해 GitHub Releases 에 올리고 팀원 공지 문구까지 만든다. 본체 앱 빌드는 /build 다. 사용법 - /release 또는 /release --minor 또는 /release "티켓 보고 필터 수정"
---

# /release — One App Lite 를 팀원에게 배포

`standalone/lite` 를 Windows·macOS zip 으로 만들어 **배포 리포의 GitHub Releases** 에 올리고,
그대로 붙여넣을 **팀원 공지 문구**까지 만들어 준다.

- 배포 리포: **`teller2016/one-app-lite`** (public — 산출물 + 받는 사람용 README 만, 소스는 없다)
- 팀원 링크: `https://github.com/teller2016/one-app-lite/releases/latest` (**항상 같다** — 한 번만 공유하면 된다)
- 실제 작업은 `standalone/lite/scripts/release.mjs` 가 한다. 이 스킬은 **무엇을 어떤 버전으로 올릴지 판단하고 확인받는 역할**이다.

ℹ️ **본체 One App 빌드는 이 스킬이 아니다** → `/build`. 여기는 `/Applications` 를 건드리지 않는다.

## 인자
| 인자 | 동작 |
|------|------|
| (없음) | **버전 자리는 스킬이 정한다** — CHANGELOG 항목 표기로(아래 2단계). 인자로 강제하지 않는 것이 기본 |
| `--minor` · `--major` · `--patch` | 자리를 강제. 표기 규칙과 어긋나면 그 이유를 사용자에게 말한다 |
| `--version=x.y.z` | 버전 직접 지정 |
| `"…"` (따옴표 문자열) | 변경점 힌트 — CHANGELOG 항목 초안에 반영한다(커밋 로그 대신) |
| `--dry-run` | 빌드까지만 하고 업로드 직전에 멈춘다 (교체 테스트용 빌드에도 쓴다 — README '테스트 훅') |

## ⚠️ 반드시 지킬 것
- **사용자 확인 없이 업로드하지 않는다.** public 릴리스는 되돌리기 번거롭고 팀원이 곧바로 받아 간다.
  버전·변경점·올릴 파일을 **보여주고 승인받은 뒤에** 실행한다.
- **커밋되지 않은 변경도 산출물에 들어간다.** 단독판은 본체 소스를 `@one/*` 로 직접 번들하므로
  작업 트리 그대로가 빌드된다 — 실험 중인 코드가 섞이지 않았는지 3단계에서 확인한다.
- **macOS 서명 검증 실패는 중단 사유다.** 스크립트가 막는다. `--allow-unsigned` 를 **임의로 붙이지 말 것** —
  서명이 빠지면 다음 버전을 받은 사람의 **저장된 계정이 전부 사라진다**(safeStorage 키체인이 서명에 묶여 있다).
- **커밋은 이 스킬이 하지 않는다.** 올라간 `package.json`·`CHANGELOG.md` 는 `/commit` 으로 따로 커밋한다.
- **CHANGELOG 항목 없이 배포하지 않는다.** 스크립트도 `## <버전>` 절이 없으면 멈춘다 — 받는 사람에게 무엇이 달라졌는지
  말하지 않는 배포는 없다. `--notes` 로 건너뛰는 것은 긴급 재배포 같은 예외에만.
- 개발 인스턴스(`npm start`)는 건드리지 않는다 — 떠 있어도 그대로 둔다.

## 절차

### 1. 배포 상태 파악
```bash
gh release view --repo teller2016/one-app-lite --json tagName,publishedAt 2>/dev/null
node -p "require('./standalone/lite/package.json').version"
```
- 릴리스가 없으면 **첫 배포**다(현재 버전을 그대로 올린다 — bump 하지 않는다: `--version=<현재>`).
- 있으면 그 태그·시각을 기준으로 다음 단계의 변경점을 모은다.

### 2. CHANGELOG `Unreleased` 확인 + 버전 결정
이번 배포의 내용은 `standalone/lite/CHANGELOG.md` 의 **`## Unreleased` 절**이다 — 변경을 만든 커밋이 적어 두었어야 한다(`/commit` 절차).
- **채워져 있으면** 그 항목들을 보여주고, 마지막 릴리스 이후 커밋과 대조해 빠진 것이 없는지 본다.
- **비어 있으면** 마지막 릴리스 이후 커밋에서 초안을 만들어 확인받고 Unreleased 에 채운다(사용자가 따옴표로 힌트를 줬으면 반영).
  정말 바뀐 게 없으면 배포할 이유가 없다 — 그렇게 말한다.
```bash
git log --since="<마지막 릴리스 시각>" --oneline
```
**단독판에 실제로 실린 것만 고른다** — 이 앱은 본체의 일부만 담는다.

| 실린다 | 안 실린다 |
|--------|-----------|
| `src/main/features/{approval,jira,settings,groupware}` · `src/main/lib` · `src/shared` | 터미널 · MO · PR · 배포 · 프로젝트 · 주간보고 · 메일 · VPN … |
| `src/renderer/features/approval` · `features/jira` 의 **보고 패널** · `components/` · `lib/` · `styles/` | 그 밖의 섹션·위젯 |
| `standalone/**` (앱 동작에 닿는 것 — 배포 스크립트·문서 변경은 항목이 아니다) | |

항목 한 줄 = 표기 + **받는 사람 말**(내부 구현어·파일 이름 금지).
예: `formatHoursTotal 가드 추가` ❌ → `[수정] 야근 시간 합계가 0시간으로 기입되던 문제를 고쳤습니다` ✅

| 표기 | 뜻 |
|------|-----|
| `[추가]` | 새로 할 수 있는 일 |
| `[변경]` | 기존 동작이 달라짐 (쓰는 방법이 바뀜) |
| `[개선]` | 같은 일이 더 잘 됨 |
| `[수정]` | 버그 |
| `[주의]` | 받는 사람이 직접 해야 할 일 (계정 재입력 등) |

**버전 자리는 표기가 정한다** — `[주의]` 가 있으면 **a**(major) · `[추가]`/`[변경]` 이 있으면 **b**(minor) ·
`[개선]`/`[수정]` 만이면 **c**(patch). 사용자가 `--minor` 등으로 강제했는데 표기와 다르면 이유를 말하고 사용자 뜻을 따른다.
스크립트는 자리 인자가 없으면 **Unreleased 표기대로 스스로 올리고**, 줬는데 표기보다 낮으면 경고한다.
배포 때 `## Unreleased` 를 `## x.y.z — 날짜` 로 찍고 빈 Unreleased 를 위에 새로 두는 것도 **스크립트가 한다** — 손으로 찍지 않는다.

### 3. 사전 점검
```bash
git status --short standalone/lite src
cd standalone/lite && npm run typecheck
```
- 작업 트리가 더러우면 **무엇이 미커밋인지 보여주고** 이대로 빌드해도 되는지 묻는다(위 ⚠️ 참고).
- typecheck 실패면 **빌드하지 말고** 보고한다.

### 4. 계획 확인 (필수)
아래를 한눈에 보여주고 승인받는다 — 여기서 멈추고 물어볼 것.
- 올릴 **버전**(현재 → 다음)과 그 근거 — 어떤 표기 때문에 어느 자리를 올리는지
- **CHANGELOG 항목** 초안(그대로 릴리스 노트가 된다)
- 산출물: `OneAppLite-win32-x64-<버전>.zip` · `OneAppLite-darwin-arm64-<버전>.zip`

승인되면 바로 실행한다 — Unreleased 가 채워져 있어야 하고, 버전 찍기는 스크립트가 한다.

### 5. 실행
```bash
cd standalone/lite && npm run release            # 자리는 Unreleased 표기대로
cd standalone/lite && npm run release -- --minor # 사용자가 자리를 달리 정했을 때만 (--major · --patch · --version=x.y.z)
```
스크립트가 순서대로: gh 인증 → typecheck → 버전 결정·bump → **`## Unreleased` 를 `## <버전> — 날짜` 로 찍어 릴리스 노트로**(비어 있으면 중단) →
`out/make` 비우고 win·mac 빌드 → **macOS 서명 검증** → 이번 버전 zip 수집 → `gh release create v<버전>` →
`CHANGELOG.md` 를 배포 리포에 업로드(빈 Unreleased 헤더는 빼고) → 링크 출력(클립보드 복사).

빌드에 몇 분 걸린다. 실패하면:
| 증상 | 대응 |
|------|------|
| `이미 v… 릴리스가 있습니다` | 버전을 올려 다시. 잘못 올린 것이면 사용자 확인 후 `gh release delete` |
| 서명 검증 실패 | **중단하고 보고.** `security find-identity -v -p codesigning \| grep "One App Sign"` 로 인증서 확인 |
| 업로드만 실패 | 산출물은 `out/make` 에 남아 있다 → `npm run release -- --skip-build` 로 재개 |
| `ETARGET No matching version` | npm 캐시 손상 → `npm cache clean --force && rm -f package-lock.json && npm install` |

### 6. 확인
```bash
gh release view v<버전> --repo teller2016/one-app-lite --json assets --jq '.assets[].name'
```
**두 파일(win32·darwin)이 다 있는지** 본다. 하나만 있으면 그 OS 팀원은 받을 수 없으므로 보고한다.

### 7. 마무리
1. `package.json`·`CHANGELOG.md` 가 바뀌었으므로 **`/commit` 으로 커밋하라고 안내**한다(이 스킬은 커밋하지 않는다).
2. **팀원 공지 문구**를 아래 형식으로 만들어 보여준다 — 그대로 복사해 메신저에 붙일 수 있게. '이번 변경' 은 CHANGELOG 항목 그대로.

```
📦 One App Lite v2.1.0 배포했습니다

쓰던 분 → 앱 상단 배너의 [지금 업데이트] 한 번이면 끝납니다 (설정·계정 유지)
처음 받는 분 → https://github.com/teller2016/one-app-lite/releases/latest
· Windows: OneAppLite-win32-x64-2.1.0.zip
· Mac: OneAppLite-darwin-arm64-2.1.0.zip

이번 변경
· [추가] …
· [개선] …

설치·사용법은 위 페이지 README, 전체 변경 이력은 CHANGELOG 에 있습니다.
```

처음 받는 사람이 있으면 아래 두 줄을 덧붙인다(자동 업데이트에는 필요 없다 — 처음 설치에만).
- Windows: 폴더째 옮기고 `OneAppLite.exe` 실행 · "PC 보호" 경고는 **추가 정보 → 실행**
- Mac: 앱을 옮긴 뒤 터미널에 `xattr -dr com.apple.quarantine /Applications/OneAppLite.app`

⚠️ **2.0.0 을 쓰는 사람에게는 [지금 업데이트]가 없다**(그 버전은 링크만 열어준다) — 2.0.0 이 남아 있는 동안은
"이번 한 번은 페이지에서 받아 덮어쓰세요" 를 공지에 넣는다.

## 보고 형식
- 📦 버전: 이전 → 새 버전 (어느 자리를 왜 올렸는지 한 줄)
- 🔧 빌드: 성공 여부 · 산출물 2개와 크기
- ✅ 서명: `One App Sign` 확인
- 🔗 링크: releases/latest
- 📋 공지 문구 (복사용 코드블록)
- ⚠️ 남은 일: `package.json`·`CHANGELOG.md` 커밋(`/commit`)
