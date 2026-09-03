// contextBridge — 렌더러는 window.oneApp 으로만 메인과 통신한다.
// (파일 이름이 빌드 산출물 preload.js 가 되므로 바꾸지 말 것)
//
// 본체 `src/preload/preload.ts` 의 **부분집합**이다. 본체와 공용인 브리지(환경설정·결재·티켓 보고)는
// 본체 `preload/bridges/*` 슬라이스를 **그대로 조립**한다 — 채널 문자열이 그쪽 한 곳에만 있어
// 본체가 채널 이름을 바꿔도 여기가 뒤처질 수 없다(예전엔 손으로 복제해 런타임에만 터졌다).
// 본체 결재·보고 화면이 새 채널을 쓰게 되면 **그쪽 슬라이스에 추가**하면 여기도 함께 늘어난다.
import { contextBridge, ipcRenderer } from 'electron';
import { approvalBridge } from '@one/preload/bridges/approval';
import { jiraReportBridge } from '@one/preload/bridges/jiraReport';
import { settingsBridge } from '@one/preload/bridges/settings';
import type { UpdateProgress } from '../shared/update';

contextBridge.exposeInMainWorld('oneApp', {
  settings: settingsBridge(ipcRenderer),
  approval: approvalBridge(ipcRenderer),
  jira: {
    // 티켓 보고만 — 내 이슈·주간·작업 시작은 이 앱에 없다
    report: jiraReportBridge(ipcRenderer),
  },
  /** 새 버전 확인·자동 설치 — 이 앱만의 채널(본체엔 없다). 실패는 값으로 온다(예외 X) */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    /** 마지막 확인 결과의 zip 을 받아 교체한다 — ok 면 앱이 곧 종료·재시작한다 */
    install: () => ipcRenderer.invoke('update:install'),
    /** 자동 교체가 안 될 때 받아 풀어둔 폴더 열기 (반자동 폴백) */
    openFolder: (folder: string) => ipcRenderer.invoke('update:open-folder', folder),
    /** 설치 진행 구독 — 해제 함수를 반환한다 */
    onProgress: (cb: (progress: UpdateProgress) => void) => {
      const listener = (_e: unknown, progress: UpdateProgress) => cb(progress);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
  },
  /** 기본 브라우저로 링크 열기 — 본체 main.ts 와 같은 계약 */
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
});
