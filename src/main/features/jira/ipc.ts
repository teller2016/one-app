import { ipcMain } from 'electron';
import type { JiraWorkPrepareInput } from '../../../shared/types';
import { handleShared } from '../../lib/moIpc';
import { fetchMyActivity } from './activity';
import {
  addTicketToList,
  fetchIssueDetail,
  fetchMyIssues,
  getTransitions,
  listAdded,
  removeTicketFromList,
  resolveIssue,
  startProgressIssue,
  transitionIssue,
  validateAddedTicket,
} from './jira';
import { registerJiraReportIpc } from './report';
import { listWorkAccounts, prepareJiraWork } from './work';

/**
 * Jira(내 이슈) 관련 IPC 핸들러 등록.
 * 전부 `handleShared` — 데스크톱과 MO(폰)가 같은 핸들러를 쓴다 (순수 REST 호출이라 폰에서도 안전).
 */
export function registerJiraIpc() {
  // 티켓 보고(프로젝트·기간 조회·복사) — 단독 배포판이 같은 함수를 직접 부르므로 따로 둔다
  registerJiraReportIpc();

  // force=true 는 수동 새로고침·전환 직후 — TTL 캐시를 우회한다
  handleShared('jira:list', (force?: boolean) => fetchMyIssues(force === true));
  // 이슈 상세 — 본문·댓글 HTML (앱 내 패널 표시용)
  handleShared('jira:detail', (key: string) => fetchIssueDetail(key));
  handleShared('jira:transitions', (key: string) => getTransitions(key));
  handleShared('jira:transition', (key: string, id: string) =>
    transitionIssue(key, id),
  );
  // PR 머지 직후 원클릭 해결 처리 — 해결/완료 계열 전환 자동 선택
  handleShared('jira:resolve', (key: string) => resolveIssue(key));
  // 작업 시작 직후 원클릭 진행 처리 — 진행 계열 전환 자동 선택
  handleShared('jira:start-progress', (key: string) => startProgressIssue(key));

  // 주간 활동 — 기간(YYYY-MM-DD) 안에 내가 작업한 티켓 + 관여도 + 내 변경 이력.
  // ⚠️ 날짜가 JQL 문자열에 들어가므로 형식 검증은 `activity.ts` 진입부에서 한다.
  handleShared('jira:activity', (start: string, end: string, force?: boolean) =>
    fetchMyActivity(String(start), String(end), force === true),
  );

  // 직접 추가한 티켓 — 담당이 아닌데 내가 작업해야 하는 이슈를 목록에 끌어온다.
  // 키 문자열만 오가고 파일 경로가 없어 폰(MO)에 열어도 안전하다.
  handleShared('jira:added:list', () => listAdded());
  handleShared('jira:added:validate', (input: string) => validateAddedTicket(input));
  handleShared('jira:added:add', (input: string) => addTicketToList(input));
  handleShared('jira:added:remove', (key: string) => removeTicketFromList(key));

  // 작업 시작 준비 — 티켓 맥락을 디스크에 만들고 femc 실행 명령을 돌려준다.
  // ⚠️ `handleShared` 가 아니다 — 파일을 쓰고 로컬 경로를 돌려주는 데스크톱 전용 흐름이다.
  ipcMain.handle('jira:prepare-work', (_e, input: JiraWorkPrepareInput) =>
    prepareJiraWork(input),
  );
  // 세션을 띄울 Claude 계정 후보 (셸이 묻던 Personal/Team 선택을 모달이 대신한다)
  ipcMain.handle('jira:work-accounts', () => listWorkAccounts());
}
