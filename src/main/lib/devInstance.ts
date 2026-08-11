// 개발 인스턴스(npm start)와 빌드 앱(/Applications/One App.app)을 **동시에** 띄우기 위한 구분.
//
// 설정(userData 의 JSON 들)은 두 인스턴스가 **그대로 공유**한다 — 개발에서 손본 설정·
// 프로젝트·터미널 작업영역이 빌드 앱에도 자동으로 반영되길 원하기 때문(사용자 결정).
// 대신 공유하면 서로를 망가뜨리는 '런타임 상태' 셋만 갈라놓는다:
//   1. MO 터미널 서버 포트  — 같은 포트를 두 프로세스가 bind 할 수 없다(뒤에 뜬 쪽이 EADDRINUSE)
//   2. tmux 소켓            — 같은 세션에 동시 attach 하면 창 크기가 작은 클라이언트로 끌려가고
//                             입력이 양쪽에 미러링된다
//   3. 창 위치·세션 목록    — 두 창이 정확히 겹쳐 뜨고, 서로가 연 세션을 죽은 것으로 오해한다
//
// 설정 파일에는 이 분리를 적용하지 않는다(= runtimeFile 을 쓰지 않는다).
import { app } from 'electron';

/** npm start 로 띄운 개발 인스턴스인가 (패키징된 .app 이면 false) */
export const IS_DEV_INSTANCE = !app.isPackaged;

/**
 * 런타임 상태 파일만 개발 인스턴스용 이름으로 바꾼다 — `foo.json` → `foo-dev.json`.
 * ⚠️ 설정 파일에는 쓰지 말 것. 쓰는 순간 개발↔빌드 설정 공유가 깨진다.
 */
export const runtimeFile = (filename: string): string =>
  IS_DEV_INSTANCE ? filename.replace(/\.json$/, '-dev.json') : filename;
