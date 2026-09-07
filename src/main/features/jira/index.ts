// Jira 기능 공개 API — 다른 기능(nightwatch 등)은 내부 파일(`./jira`)이 아니라 여기서 import 한다.
// ⚠️ main.ts 의 `registerJiraIpc`(./ipc) 와 단독 배포판의 `registerJiraReportIpc`(./report) 는
// 진입점이 직접 가져가는 파일이라 여기 싣지 않는다.
export { fetchMyIssues, jiraAuth } from './jira';
