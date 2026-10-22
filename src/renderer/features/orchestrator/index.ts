// 루트 세션(오케스트레이터) 공개 API — 앱 셸이 명령을, 터미널 LNB 가 고정 '루트' 칸을 위해 쓴다
export { RootCommand } from './components/RootCommand';
export { useOpenRoot, useRootSessionId } from './lib/rootSession';
