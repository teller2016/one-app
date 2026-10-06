import { relativeTime } from '../../../../shared/date';

/** "5분 전" 형태 상대 시간 — PR 목록·상세·생성 모달 공용 (정본은 shared/date, 시각이 없으면 빈 문자열) */
export const rel = (ts?: number): string => (ts ? relativeTime(ts) : '');
