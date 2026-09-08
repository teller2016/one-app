import { jiraIssueUrl } from '../../shared/jira-url';

/**
 * Jira 티켓 칩 — 이슈 키(BBJ-1234)를 필로 보여주고, Jira 주소가 설정돼 있으면 클릭해
 * 브라우저에서 그 이슈를 연다. 배포 확인 모달·PR 상세 패널이 함께 쓴다.
 * 클릭을 받는 행·카드 안에 놓여도 부모의 선택이 따라 일어나지 않게 전파를 끊는다.
 */
export function IssueChip({ issueKey, jiraUrl }: { issueKey: string; jiraUrl?: string }) {
  if (!jiraUrl) return <span className="issue-chip">{issueKey}</span>;
  return (
    <button
      type="button"
      className="issue-chip issue-chip--link"
      aria-label={`Jira 이슈 열기 — ${issueKey}`}
      title={`Jira 이슈 열기 — ${issueKey}`}
      onClick={(e) => {
        e.stopPropagation();
        void window.oneApp.openExternal(jiraIssueUrl(jiraUrl, issueKey));
      }}
    >
      {issueKey}
    </button>
  );
}
