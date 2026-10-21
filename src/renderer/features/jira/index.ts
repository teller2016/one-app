// jira 기능의 공개 API
export { JiraSection } from './components/JiraSection';
// 티켓 보고 화면 — 섹션 없이 패널만 쓰는 소비자용. ⚠️ 단독 배포판(standalone/lite)은 이 index 가
// JiraSection(터미널·작업 시작 채널 의존)까지 끌고 오므로 컴포넌트 파일을 직접 import 한다.
export { JiraReportPanel } from './components/JiraReportPanel';
// 상태 뱃지 색 — PR 목록의 티켓 상태 뱃지가 Jira 화면과 같은 색을 쓴다
export { isDone, statusBadgeVariant } from './lib/issue';
