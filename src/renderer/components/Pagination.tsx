import { Icon } from './Icon';

/** 페이지 번호 목록 한 칸 — 숫자 또는 생략 기호(…) */
type Slot = { kind: 'page'; page: number } | { kind: 'gap'; key: string };

/**
 * 표시할 페이지 번호 계산 — 첫 페이지·마지막 페이지·현재 ±span 만 남기고 사이는 … 로 접는다.
 * 예) 616페이지 중 7페이지: 1 … 6 [7] 8 … 616
 */
function slots(page: number, totalPages: number, span: number): Slot[] {
  const shown = new Set<number>([1, totalPages]);
  for (let p = page - span; p <= page + span; p += 1) {
    if (p >= 1 && p <= totalPages) shown.add(p);
  }
  const sorted = [...shown].sort((a, b) => a - b);

  const out: Slot[] = [];
  sorted.forEach((p, i) => {
    const prev = sorted[i - 1];
    // 번호가 2 이상 건너뛰면 그 자리에 … (건너뛴 게 1개면 그 번호를 그대로 보여준다)
    if (prev !== undefined && p - prev > 1) {
      if (p - prev === 2) out.push({ kind: 'page', page: p - 1 });
      else out.push({ kind: 'gap', key: `gap-${prev}` });
    }
    out.push({ kind: 'page', page: p });
  });
  return out;
}

/**
 * 공용 페이지네이션 — `[이전] 1 … 6 [7] 8 … 616 [다음]` + 좌측 범위 요약.
 *
 * 서버 페이징(총 건수를 아는 목록) 전용. 총 건수가 한 페이지에 들어가면 아무것도 렌더하지 않는다.
 * `page` 는 1부터 시작하며, 상태는 부모가 소유한다(제어 컴포넌트).
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
  disabled = false,
  span = 1,
  unitLabel = '건',
}: {
  /** 현재 페이지 (1-based) */
  page: number;
  /** 한 페이지 건수 */
  pageSize: number;
  /** 전체 건수 */
  total: number;
  onChange: (page: number) => void;
  /** 조회 중 등 일시 비활성 */
  disabled?: boolean;
  /** 현재 페이지 앞뒤로 함께 보여줄 번호 개수 */
  span?: number;
  /** 요약 문구의 단위 ("건"·"개" 등) */
  unitLabel?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const current = Math.min(Math.max(1, page), totalPages);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);
  const go = (p: number) => {
    if (p !== current && p >= 1 && p <= totalPages) onChange(p);
  };

  return (
    <nav className="pagination" aria-label="페이지 이동">
      <span className="pagination__summary">
        {from.toLocaleString()}–{to.toLocaleString()} / {total.toLocaleString()}
        {unitLabel}
      </span>

      <div className="pagination__pages">
        <button
          type="button"
          className="icon-btn"
          onClick={() => go(current - 1)}
          disabled={disabled || current === 1}
          title="이전 페이지"
          aria-label="이전 페이지"
        >
          <Icon name="chevron-left" size={14} />
        </button>

        {slots(current, totalPages, span).map((s) =>
          s.kind === 'gap' ? (
            <span key={s.key} className="pagination__gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={s.page}
              type="button"
              className={
                'pagination__page' +
                (s.page === current ? ' pagination__page--on' : '')
              }
              onClick={() => go(s.page)}
              disabled={disabled}
              aria-current={s.page === current ? 'page' : undefined}
              aria-label={`${s.page}페이지`}
            >
              {s.page}
            </button>
          ),
        )}

        <button
          type="button"
          className="icon-btn"
          onClick={() => go(current + 1)}
          disabled={disabled || current === totalPages}
          title="다음 페이지"
          aria-label="다음 페이지"
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </div>
    </nav>
  );
}
