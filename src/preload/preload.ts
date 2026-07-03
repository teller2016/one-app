// preload: 렌더러에 안전하게 노출할 API를 contextBridge 로 등록한다.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ScheduleRunPayload,
  SaveSettingsInput,
  SaveDeployProjectInput,
  DeployStatusEvent,
  SaveVpnSettingsInput,
  VpnStatus,
} from '../shared/types';

contextBridge.exposeInMainWorld('oneApp', {
  schedule: {
    // 매크로 실행 (앱 내부에서 puppeteer 직접 실행)
    run: (payload: ScheduleRunPayload) =>
      ipcRenderer.invoke('schedule:run', payload),
    // 실행 중지 (자동화 브라우저 닫기)
    cancel: () => ipcRenderer.invoke('schedule:cancel'),
    // 실행 로그(stdout/stderr/info) 구독. 해제 함수를 반환한다.
    onOutput: (cb: (chunk: { stream: string; data: string }) => void) => {
      const listener = (
        _e: unknown,
        chunk: { stream: string; data: string },
      ) => cb(chunk);
      ipcRenderer.on('schedule:output', listener);
      return () => ipcRenderer.removeListener('schedule:output', listener);
    },
    // 프로세스 종료 이벤트 구독. 해제 함수를 반환한다.
    onDone: (cb: (info: { code: number | null }) => void) => {
      const listener = (_e: unknown, info: { code: number | null }) => cb(info);
      ipcRenderer.on('schedule:done', listener);
      return () => ipcRenderer.removeListener('schedule:done', listener);
    },
  },
  settings: {
    // 현재 설정 조회 (비밀번호 값은 오지 않고 설정 여부만)
    get: () => ipcRenderer.invoke('settings:get'),
    // 설정 저장 (비밀번호는 암호화되어 저장)
    set: (input: SaveSettingsInput) => ipcRenderer.invoke('settings:set', input),
  },
  deploy: {
    // 프로젝트 목록 조회 (토큰/비밀번호 값은 오지 않음)
    getProjects: () => ipcRenderer.invoke('deploy:projects:get'),
    // 프로젝트 추가/수정 (토큰은 암호화되어 저장). 최신 목록 반환
    saveProject: (input: SaveDeployProjectInput) =>
      ipcRenderer.invoke('deploy:projects:save', input),
    // 프로젝트 삭제. 최신 목록 반환
    deleteProject: (id: string) =>
      ipcRenderer.invoke('deploy:projects:delete', id),
    // 배포 대상별 최근 빌드 상태 조회 (targetId → status)
    fetchStatuses: (projectId: string) =>
      ipcRenderer.invoke('deploy:status:fetch', projectId),
    // 배포 실행 — 이후 진행 상태는 onStatus 로 전달됨
    trigger: (projectId: string, targetId: string) =>
      ipcRenderer.invoke('deploy:trigger', projectId, targetId),
    // 빌드 상세(커밋 내역 등) 조회. buildNumber 없으면 최근 빌드
    getBuildDetail: (
      projectId: string,
      targetId: string,
      buildNumber?: number,
    ) =>
      ipcRenderer.invoke('deploy:build:detail', projectId, targetId, buildNumber),
    // 배포 상태 이벤트 구독. 해제 함수를 반환한다.
    onStatus: (cb: (evt: DeployStatusEvent) => void) => {
      const listener = (_e: unknown, evt: DeployStatusEvent) => cb(evt);
      ipcRenderer.on('deploy:status', listener);
      return () => ipcRenderer.removeListener('deploy:status', listener);
    },
  },
  vpn: {
    // VPN 설정 조회 (시크릿 값은 오지 않고 설정 여부만)
    getSettings: () => ipcRenderer.invoke('vpn:settings:get'),
    // VPN 설정 저장 (시크릿은 암호화되어 저장)
    saveSettings: (input: SaveVpnSettingsInput) =>
      ipcRenderer.invoke('vpn:settings:save', input),
    // .ovpn 설정 파일 선택 다이얼로그
    pickOvpn: () => ipcRenderer.invoke('vpn:pick-ovpn'),
    // 연결 — 진행/완료 상태는 onStatus 로도 전달됨. manualOtp 없으면 시크릿으로 자동 생성
    connect: (manualOtp?: string) => ipcRenderer.invoke('vpn:connect', manualOtp),
    // 연결 해제
    disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
    // 현재 상태 조회
    getStatus: () => ipcRenderer.invoke('vpn:status:get'),
    // 상태 이벤트 구독. 해제 함수를 반환한다.
    onStatus: (cb: (status: VpnStatus) => void) => {
      const listener = (_e: unknown, status: VpnStatus) => cb(status);
      ipcRenderer.on('vpn:status', listener);
      return () => ipcRenderer.removeListener('vpn:status', listener);
    },
  },
  attendance: {
    // 현재 출퇴근 시각 조회 (headless 브라우저로 그룹웨어 확인 — 수 초 소요)
    fetch: () => ipcRenderer.invoke('attendance:fetch'),
    // 출근/퇴근 찍기
    stamp: (action: 'come' | 'leave') =>
      ipcRenderer.invoke('attendance:stamp', action),
  },
  // 기본 브라우저로 링크 열기 (http/https 만 허용)
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
});
