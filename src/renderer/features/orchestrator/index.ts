// 루트 세션(오케스트레이터) 공개 API — 앱 셸이 명령·승인 창을, 터미널이 고정 '루트' 칸·워커 탭 표시·탭 순서 보고를 위해 쓴다
export { RootCommand } from './components/RootCommand';
export { RootConfirmHost } from './components/RootConfirmHost';
export { useOpenRoot, useRootSessionId } from './lib/rootSession';
export { reportTabOrders, useRootTaskSessionIds } from './lib/rootTasks';
