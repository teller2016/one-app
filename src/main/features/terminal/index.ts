// 터미널 기능의 공개 API — 다른 기능(루트 세션 오케스트레이터 등)은 이 파일로만 가져다 쓴다.
// 기능 내부 파일을 직접 import 하지 않는다(CLAUDE.md '기능 간 참조' 규칙).
export { completeLines, fileSize, findClaude, findClaudeMany, readRange, type ClaudeProcess } from './claudeFiles';
export { CHAT_SUBMIT_DELAY_MS, sendChatText } from './chat';
export { femcStackFor } from './femcStack';
export { withLaunchAccount } from './launch';
export { withClaudeAccount } from './launchCommand';
export { getClaudeAccount } from './store';
export { placeOf, terminalOverview } from './overview';
export { sessionCommands } from './processes';
export {
  createSession,
  killSession,
  listSessions,
  onTerminalExit,
  sessionRootPid,
  sessionScreen,
  whenSessionsRestored,
  writeSession,
} from './pty';
export { parseScreenPrompt, parseScreenStatus } from './screenPrompt';
export { parseTranscript } from './transcript';
export { dockShellId, revealSession } from './windows';
