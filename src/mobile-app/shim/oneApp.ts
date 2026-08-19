// 폰에서 `window.oneApp` 을 만든다 — preload 가 없는 브라우저에서 데스크톱 기능 화면
// (`src/renderer/features/*`)을 **무수정으로** 재사용하기 위한 대역이다.
//
// preload 의 노출 함수는 예외 없이 3패턴(invoke 래퍼 / send / (cb)=>해제함수)이라,
// `채널 표` 하나로 같은 모양의 객체를 만들 수 있다. 여기에는 폰에서 의미 있는 것만 싣는다 —
// 없는 네임스페이스를 부르면 즉시 터지므로, 탭에 올리는 화면이 쓰는 것만 채운다.
import { call, on } from './rpc';

/** 메서드 선언 — 채널을 부르거나(invoke), 이벤트를 구독한다 */
type Spec = Record<string, Record<string, { ch: string } | { ev: string }>>;

const SPEC: Spec = {
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
    activity: { ch: 'jira:activity' },
  },
  prs: {
    fetch: { ch: 'prs:fetch' },
    getConfig: { ch: 'prs:config:get' },
    setConfig: { ch: 'prs:config:set' },
    getBranches: { ch: 'prs:branches' },
    getBranchCommits: { ch: 'prs:branch-commits' },
    create: { ch: 'prs:create' },
    getMergeInfo: { ch: 'prs:merge-info' },
    getMergeables: { ch: 'prs:mergeables' },
    merge: { ch: 'prs:merge' },
  },
  deploy: {
    getProjects: { ch: 'deploy:projects:get' },
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

export function installOneAppShim(): void {
  const api: Record<string, Record<string, unknown>> = {};
  for (const [ns, methods] of Object.entries(SPEC)) {
    api[ns] = {};
    for (const [name, def] of Object.entries(methods)) {
      api[ns][name] =
        'ch' in def
          ? (...args: unknown[]) => call(def.ch, trimTrailingUndefined(args))
          : (cb: (...a: unknown[]) => void) => on(def.ev, cb);
    }
  }

  // 링크는 **폰 브라우저**에서 열려야 한다 — RPC 로 보내면 맥에서 열려 폰은 아무 반응이 없다.
  // (렌더러 17곳이 이 함수를 쓴다)
  api.openExternal = ((url: string) => {
    window.open(url, '_blank', 'noopener');
    return Promise.resolve({ ok: true });
  }) as unknown as Record<string, unknown>;

  // 데스크톱 전용 신호 — 폰에서는 조용한 no-op (렌더러가 옵셔널로 호출한다)
  const noopSubscribe = (): (() => void) => () => undefined;
  api.onNavigate = noopSubscribe as unknown as Record<string, unknown>;
  api.onHistoryNav = noopSubscribe as unknown as Record<string, unknown>;

  (window as unknown as { oneApp: unknown }).oneApp = api;
}
