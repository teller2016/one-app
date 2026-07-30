// 그룹웨어(gw.forbiz.co.kr) 로그인 직렬화 — 로그인이 필요한 기능들의 공통 인프라.
//
// 같은 계정으로 거의 동시에 로그인하면 서버가 뒤쪽 로그인을 거부해 로그인 페이지로
// 되돌려보낸다 (2026-07-30 실측: 앱 시작 시 메일 위젯과 근태 위젯이 각각 headless
// 브라우저로 동시 로그인 → 메일이 4/4 실패, 단독 재시도는 둘 다 성공).
// 중복 로그인 확인창(confirm)은 뜨지 않으므로 다이얼로그 처리로는 해결되지 않는다.
//
// 따라서 로그인이 필요한 기능(메일·근태·주간보고·야근결재)은 **로그인 구간만** 이 큐로
// 감싸 한 번에 하나만 진행하게 한다. 로그인 이후의 조회·스크래핑은 감싸지 않아 병렬로 돈다.

/** 직전까지 등록된 로그인 작업들의 끝 — 여기에 이어 붙여 순차 실행한다 */
let tail: Promise<unknown> = Promise.resolve();

/**
 * 그룹웨어 로그인 구간을 직렬화해 실행한다.
 * 앞선 로그인이 실패해도 뒤 작업은 그대로 이어서 진행된다(체인이 끊기지 않게).
 */
export function withGroupwareLogin<T>(login: () => Promise<T>): Promise<T> {
  const run = tail.then(login, login);
  // 실패를 삼킨 프로미스를 다음 대기열의 기준으로 둔다 (unhandled rejection 방지)
  tail = run.catch((): void => undefined);
  return run;
}
