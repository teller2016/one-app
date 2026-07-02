// deploy 기능 공용 헬퍼 — 상태 키·진행 판별·시간 포맷
import type { DeployStatus } from '../../../../shared/types';

/** 상태/패널 맵의 키 (projectId:targetId) */
export const statusKey = (projectId: string, targetId: string) =>
  `${projectId}:${targetId}`;

export const isBusy = (s?: DeployStatus) =>
  s?.state === 'queued' || s?.state === 'building';

export const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('ko-KR') : '';

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
