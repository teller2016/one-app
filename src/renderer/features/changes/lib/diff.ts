// unified diff → 사이드-바이-사이드 행 변환 + 커밋 시각 표시 헬퍼.
// 라이브러리 없이 줄 prefix 파싱 — 드로어의 unified 렌더와 같은 원칙.

export type SplitSide = { no: number; text: string };

/**
 * 분할 뷰 한 행 — hunk 헤더 또는 좌(이전)/우(이후) 쌍.
 * pre/suf 는 짝지어진 수정 행에서 좌우가 공유하는 접두/접미 글자 수 —
 * 그 사이 구간만 워드 하이라이트로 진하게 칠한다 (Superset 무드).
 */
export type SplitRow =
  | { type: 'hunk'; text: string }
  | {
      type: 'line';
      left?: SplitSide;
      right?: SplitSide;
      changed: boolean;
      pre?: number;
      suf?: number;
    };

const SEG_MAX = 4000; // 워드 하이라이트 계산 상한 (좌+우 합) — 초장문 줄은 행 틴트만

/**
 * unified diff 본문을 분할 뷰 행으로 변환.
 * 한 hunk 안의 연속된 -/+ 묶음을 서로 짝지어(i번째 삭제 ↔ i번째 추가) 나란히 놓는다.
 * 파일 헤더(diff/index/---/+++ 등)와 '\ No newline' 은 표시하지 않는다.
 */
export function parseUnifiedToSplit(diff: string): SplitRow[] {
  const rows: SplitRow[] = [];
  let l = 0; // 좌(이전) 다음 줄 번호
  let r = 0; // 우(이후) 다음 줄 번호
  let dels: SplitSide[] = [];
  let adds: SplitSide[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const left = dels[i];
      const right = adds[i];
      let pre: number | undefined;
      let suf: number | undefined;
      if (
        left &&
        right &&
        left.text !== right.text &&
        left.text.length + right.text.length < SEG_MAX
      ) {
        const a = left.text;
        const b = right.text;
        const max = Math.min(a.length, b.length);
        let p = 0;
        while (p < max && a[p] === b[p]) p++;
        let s = 0;
        while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
        pre = p;
        suf = s;
      }
      rows.push({ type: 'line', left, right, changed: true, pre, suf });
    }
    dels = [];
    adds = [];
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      flush();
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        l = Number(m[1]);
        r = Number(m[2]);
      }
      rows.push({ type: 'hunk', text: line });
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      dels.push({ no: l++, text: line.slice(1) });
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      adds.push({ no: r++, text: line.slice(1) });
      continue;
    }
    if (line.startsWith(' ')) {
      flush();
      const text = line.slice(1);
      rows.push({
        type: 'line',
        left: { no: l++, text },
        right: { no: r++, text },
        changed: false,
      });
      continue;
    }
    // 그 외(diff/index/---/+++/rename/Binary/'\ No newline'/빈 줄)는 헤더·메타 — 생략
  }
  flush();
  return rows;
}

/** 커밋 시각 상대 표시 — "n분 전"류. 일주일 넘으면 날짜로 */
export function relTime(epochSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - epochSec;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  const d = new Date(epochSec * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
