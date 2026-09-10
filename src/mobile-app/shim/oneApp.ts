// 폰에서 `window.oneApp` 을 만든다 — preload 가 없는 브라우저에서 데스크톱 기능 화면
// (`src/renderer/features/*`)을 **무수정으로** 재사용하기 위한 대역이다.
//
// preload 의 노출 함수는 예외 없이 3패턴(invoke 래퍼 / send / (cb)=>해제함수)이라,
// `채널 표` 하나로 같은 모양의 객체를 만들 수 있다. 여기에는 폰에서 의미 있는 것만 싣는다 —
// 없는 네임스페이스를 부르면 즉시 터지므로, 탭에 올리는 화면이 쓰는 것만 채운다.
//
// ⚠️ 이 표는 **수동**이다 — PC 가 preload 에 메서드를 더하면 여기도 더해야 한다. 빠지면 폰에서
//    그 버튼을 누르는 순간 `undefined is not a function` 으로 탭 전체가 오류 카드가 된다
//    (2026-09-10 감사: Jira [보고]·[+ 티켓]·PR [새 PR]·메일 [인증코드] 네 곳이 8월 셸 이후
//    PC 가 추가한 메서드를 부르다 이렇게 죽어 있었다). `oneApp.test.ts` 가 폰 셸에서 도달하는
//    렌더러 소스의 호출 ↔ 이 표 ↔ main 의 `handleShared`/`broadcast` 를 대조한다.
import { call, on } from './rpc';

/** 잎 — 채널을 부르거나(invoke), 이벤트를 구독한다 */
type SpecLeaf = { ch: string } | { ev: string };
/** 표 노드 — 잎 또는 하위 네임스페이스(preload 의 `jira.added.*`·`jira.report.*` 같은 중첩) */
export type SpecNode = SpecLeaf | { [name: string]: SpecNode };
type Spec = Record<string, SpecNode>;

const isCall = (n: SpecNode): n is { ch: string } =>
  typeof (n as { ch?: unknown }).ch === 'string';
const isEvent = (n: SpecNode): n is { ev: string } =>
  typeof (n as { ev?: unknown }).ev === 'string';

export const SPEC: Spec = {
  attendance: {
    fetch: { ch: 'attendance:fetch' },
    stamp: { ch: 'attendance:stamp' },
    onChanged: { ev: 'attendance:changed' },
    onStamping: { ev: 'attendance:stamping' },
  },
  jira: {
    list: { ch: 'jira:list' },
    getDetail: { ch: 'jira:detail' },
    getTransitions: { ch: 'jira:transitions' },
    transition: { ch: 'jira:transition' },
    resolve: { ch: 'jira:resolve' },
    startProgress: { ch: 'jira:start-progress' },
    activity: { ch: 'jira:activity' },
    // 직접 추가한 티켓 — 채널은 처음부터 handleShared 였는데 이 표에만 빠져 있어
    // 폰에서 [+ 티켓]·빼기가 조용히 죽었다(비동기 TypeError 라 화면에 아무 표시가 없었다)
    added: {
      list: { ch: 'jira:added:list' },
      validate: { ch: 'jira:added:validate' },
      add: { ch: 'jira:added:add' },
      remove: { ch: 'jira:added:remove' },
    },
    // 티켓 보고 — 폰의 Jira 탭이 데스크톱과 같은 보고 패널을 마운트한다 (main 은 2026-09-10 개방)
    report: {
      projects: { ch: 'jira:report:projects' },
      labels: { ch: 'jira:report:labels' },
      search: { ch: 'jira:report:search' },
      getPrefs: { ch: 'jira:report:prefs:get' },
      savePrefs: { ch: 'jira:report:prefs:set' },
    },
  },
  prs: {
    fetch: { ch: 'prs:fetch' },
    getConfig: { ch: 'prs:config:get' },
    setConfig: { ch: 'prs:config:set' },
    getBranches: { ch: 'prs:branches' },
    // 새 PR 모달(2026-08-31 개편)이 여는 즉시 부른다 — 빠져 있으면 useEffect 에서 throw 해 PR 탭이 통째로 죽는다
    getBaseBranches: { ch: 'prs:base-branches' },
    getAllBranches: { ch: 'prs:all-branches' },
    getBranchCommits: { ch: 'prs:branch-commits' },
    create: { ch: 'prs:create' },
    getMergeInfo: { ch: 'prs:merge-info' },
    getMergeables: { ch: 'prs:mergeables' },
    merge: { ch: 'prs:merge' },
  },
  deploy: {
    getProjects: { ch: 'deploy:projects:get' },
    // ⚠️ 아래 둘은 main 이 MO 에 열지 않은 채널이다(`deploy/ipc.ts` — 젠킨스 인증 시크릿을
    // 담는 쓰기 채널). 선언은 남겨 둔다 — 빼면 `undefined is not a function` 이 나지만,
    // 남겨 두면 브리지가 '폰에서 쓸 수 없는 기능입니다' 로 거절해 화면이 그 문구를 보여준다.
    // (oneApp.test.ts 의 CLOSED_ON_PURPOSE 에 같은 채널이 적혀 있다)
    saveProject: { ch: 'deploy:projects:save' },
    deleteProject: { ch: 'deploy:projects:delete' },
    fetchStatuses: { ch: 'deploy:status:fetch' },
    fetchActivity: { ch: 'deploy:activity:fetch' },
    trigger: { ch: 'deploy:trigger' },
    getBuildDetail: { ch: 'deploy:build:detail' },
    getHistory: { ch: 'deploy:history:fetch' },
    getLog: { ch: 'deploy:log:fetch' },
    stopBuild: { ch: 'deploy:stop' },
    getPreview: { ch: 'deploy:preview' },
    onStatus: { ev: 'deploy:status' },
  },
  mail: {
    getUnreadCount: { ch: 'mail:unread-count' },
    getInbox: { ch: 'mail:inbox' },
    getBody: { ch: 'mail:body' },
    // openWeb 은 맥 브라우저를 여는 채널이라 폰에 열지 않는다 (MailModal 은 openExternal 로 연다)
    // 팀 공용 계정 인증코드 — 리더 모달의 [인증코드] 탭. 조회 둘만(등록·삭제는 환경설정 = 데스크톱)
    authCodeAccounts: { ch: 'mail:authcode:accounts' },
    getAuthCode: { ch: 'mail:authcode:fetch' },
  },
  settings: {
    get: { ch: 'settings:get' },
  },
  projects: {
    list: { ch: 'projects:get' },
    onChanged: { ev: 'projects:changed' },
  },
  changes: {
    status: { ch: 'changes:status' },
    diff: { ch: 'changes:diff' },
    log: { ch: 'changes:log' },
    commitFiles: { ch: 'changes:commit-files' },
    commit: { ch: 'changes:commit' },
    push: { ch: 'changes:push' },
  },
};

/** 표 밖에서 직접 붙이는 최상위 멤버 — `installOneAppShim` 과 `oneApp.test.ts` 가 함께 본다 */
export const SHIM_EXTRAS = ['openExternal', 'onNavigate', 'onHistoryNav'] as const;

/**
 * 뒤쪽 `undefined` 를 잘라낸다.
 * ⚠️ 필수: JSON 직렬화는 `undefined` 를 `null` 로 바꾼다. 그런데 렌더러 쪽 기본 파라미터
 * (`getInbox(query = {})` 처럼)는 `null` 을 막지 못해 `null.folder` 로 터진다.
 * 인자를 아예 보내지 않으면 main 쪽 기본값이 정상 적용된다.
 */
function trimTrailingUndefined(args: unknown[]): unknown[] {
  let end = args.length;
  while (end > 0 && args[end - 1] === undefined) end--;
  return args.slice(0, end);
}

/** 표 노드 → 실제 함수/네임스페이스 객체 (중첩은 재귀) */
function build(node: SpecNode): unknown {
  if (isCall(node)) {
    const channel = node.ch;
    return (...args: unknown[]) => call(channel, trimTrailingUndefined(args));
  }
  if (isEvent(node)) {
    const channel = node.ev;
    return (cb: (...a: unknown[]) => void) => on(channel, cb);
  }
  const out: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(node)) out[name] = build(child);
  return out;
}

export function installOneAppShim(): void {
  const api = build(SPEC) as Record<string, unknown>;

  // 링크는 **폰 브라우저**에서 열려야 한다 — RPC 로 보내면 맥에서 열려 폰은 아무 반응이 없다.
  // (렌더러 17곳이 이 함수를 쓴다)
  api.openExternal = (url: string) => {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve({ ok: true });
  };

  // 데스크톱 전용 신호 — 폰에서는 조용한 no-op (렌더러가 옵셔널로 호출한다)
  const noopSubscribe = (): (() => void) => () => undefined;
  api.onNavigate = noopSubscribe;
  api.onHistoryNav = noopSubscribe;

  (window as unknown as { oneApp: unknown }).oneApp = api;
}
