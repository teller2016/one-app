// deploy 기능 공용 헬퍼 — 상태 키·진행 판별·시간 포맷
import type { DeployStatus } from '../../../../shared/types';

/** 상태/패널 맵의 키 (projectId:targetId) */
export const statusKey = (projectId: string, targetId: string) =>
  `${projectId}:${targetId}`;

export const isBusy = (s?: DeployStatus) =>
  s?.state === 'queued' || s?.state === 'building';

/** 젠킨스 잡 페이지 URL — "폴더/잡" 경로를 /job/폴더/job/잡 으로 변환 */
export const jenkinsJobUrl = (baseUrl: string, jobPath: string) =>
  `${baseUrl.replace(/\/+$/, '')}/job/${jobPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/job/')}/`;

export const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('ko-KR') : '';

/** 소요 시간 — "22분 47초" / "45초" / "1시간 3분" */
export const formatDuration = (ms: number) => {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return s > 0 ? `${m}분 ${s}초` : `${m}분`;
  return `${s}초`;
};

/** "5분 전" 형태의 상대 시간 (일주일 넘으면 날짜로) */
export const formatRelative = (ts: number) => {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
};
