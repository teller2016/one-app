// 메일 표시용 포맷 헬퍼

/** "이성○ <lee@x.com>" / "\"이성○\" <lee@x>" → 표시 이름. 이름이 없으면 주소 */
export function senderName(raw: string): string {
  const s = (raw ?? '').trim();
  if (!s) return '(발신자 없음)';
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return name || m[2].trim();
  }
  return s;
}

/**
 * 상대 시각 — "방금 / 3분 전 / 2시간 전" (0이면 빈 문자열).
 * 인증코드는 신선도가 곧 사용 가능 여부라, 절대 시각(`mailTime`)보다 이쪽이 읽기 쉽다.
 */
export function relativeTime(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '방금';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

/** 수신 시각 — 오늘이면 HH:MM, 올해면 M/D, 그 외 YYYY.M.D (0이면 빈 문자열) */
export function mailTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}
