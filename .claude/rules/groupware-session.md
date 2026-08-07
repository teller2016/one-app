---
paths:
  - "src/main/features/groupware/**"
  - "src/main/features/mail/**"
  - "src/main/features/attendance/**"
  - "src/main/features/weekly/**"
  - "src/main/features/schedule/**"
  - "src/main/features/overtime/**"
  - "src/main/lib/groupware.ts"
---

# ⚠️ 그룹웨어 접근은 공용 세션(`features/groupware/session.ts`)을 쓸 것

같은 계정으로 **거의 동시에 로그인하면 서버가 뒤쪽을 거부**해 로그인 페이지로 되돌려보낸다(2026-07-30 실측: 시작 시 메일+근태가 각자 로그인 → 메일 4/4 실패, "계정 정보를 확인하세요" 라는 오해성 메시지. 중복 로그인 확인창은 안 뜨므로 다이얼로그 처리로는 해결 불가). 그래서 **로그인은 1회만 하고 쿠키를 공유**한다.

## 사용법
- `getGroupwareSession()` → 쿠키 확보(TTL 20분 캐시, 동시 요청은 하나의 로그인을 공유).
- `peekGroupwareSession()` → **TTL 검사 없이** 캐시만 본다(재로그인 유발 없음). 폴링류 소비자(메일)가 "세션이 갈렸는지" 신원 비교에 쓴다 — 폴링이 서버를 계속 건드려 서버 세션은 살아 있으므로 TTL 만료만으로 선제 재로그인하면 20분마다 Chrome 이 떴다(2026-08-07 감사). 유효성은 실제 응답(로그인 페이지 → invalidate)으로 판정한다. 메일 세션 수립 실패에는 지수 백오프(1→2→…→15분)가 걸려 있다.
- HTTP 호출은 `session.header`(메일).
- 브라우저가 필요한 기능은 **`gotoWithSession(page, url, waitUntil?)`** — 쿠키를 주입해 **로그인 화면을 건너뛰고** 목표 URL 로 직행하고, 세션이 서버에서 만료돼 튕기면 **1회 재로그인 후 재시도**한다.
- 인증 실패를 감지하면 `invalidateGroupwareSession()`.

## 함정
- ⚠️ 쿠키는 이름이 같고 경로만 다른 `JSESSIONID` **2개**(`gw.forbiz.co.kr` `/gw` + `.forbiz.co.kr` `/`)다 — 합친 문자열이 아니라 **도메인·경로가 붙은 객체 목록이 정본**이고 헤더는 파생값.
- ⚠️ `waitUntil` 기본값은 `networkidle2` 지만 **포털 화면(userMain.do)은 상시 폴링이 있어 idle 판정이 14~20초까지 늘어진다** — 뒤에서 필요한 요소를 직접 기다리는 호출부(근태의 `readInfo`)는 `'domcontentloaded'` 를 넘길 것.
- 참고: 근태 조회가 드물게 20초 이상 걸리는 건 **그룹웨어가 `userMain.do` 응답을 늦게 주는 경우**(단계별 계측으로 goto 구간 확인, 8회 중 1회) — 앱 코드 문제가 아니다.

## 적용 현황
- **메일·근태는 공용 세션**(근태 조회 4.5초 → **0.7초**, 6~7배).
- **주간보고·야근결재·일정 등록은 아직 각자 로그인**하며 `main/lib/groupware.ts` 의 `withGroupwareLogin()` 직렬화 큐를 경유한다(공용 세션의 로그인도 같은 큐를 지나므로 서로 충돌하지 않음). 이들도 `gotoWithSession` 으로 옮기면 같은 이득을 얻지만, 야근결재는 상신(쓰기) 흐름이라 E2E 검증이 어려워 보류했다.
- `standalone/` 은 별도 프로세스라 큐·세션이 공유되지 않는다.

계정은 전부 환경설정의 비즈박스 계정 공용이다.
