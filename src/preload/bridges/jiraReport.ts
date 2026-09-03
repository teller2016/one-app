// Jira 티켓 보고 브리지 — 본체 `jira.report` 와 단독 배포판 `jira.report` 가 같은 조립을 쓴다.
// (내 이슈·주간 활동·작업 시작 등 나머지 jira 채널은 본체 전용이라 본체 preload 에 그대로 있다)
// 채널 이름은 여기 한 곳에만 둔다 — 이유는 settings.ts 머리말.
import type { IpcRenderer } from 'electron';
import type {
  JiraProjectsResult,
  JiraReportPrefs,
  JiraReportQuery,
  JiraReportResult,
} from '../../shared/types';

export interface JiraReportBridge {
  /** 프로젝트 선택지 (force=true 는 새로고침 — 10분 캐시 우회) */
  projects: (force?: boolean) => Promise<JiraProjectsResult>;
  search: (query: JiraReportQuery) => Promise<JiraReportResult>;
  /** 마지막 선택(템플릿·프로젝트·기간 기준) — userData 에 남긴다 */
  getPrefs: () => Promise<JiraReportPrefs>;
  savePrefs: (prefs: Partial<JiraReportPrefs>) => Promise<JiraReportPrefs>;
}

export const jiraReportBridge = (ipcRenderer: IpcRenderer): JiraReportBridge => ({
  projects: (force) => ipcRenderer.invoke('jira:report:projects', force),
  search: (query) => ipcRenderer.invoke('jira:report:search', query),
  getPrefs: () => ipcRenderer.invoke('jira:report:prefs:get'),
  savePrefs: (prefs) => ipcRenderer.invoke('jira:report:prefs:set', prefs),
});
