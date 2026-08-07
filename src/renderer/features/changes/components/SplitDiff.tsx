// 사이드-바이-사이드 diff — 좌(이전)/우(이후) 2열 + 줄 번호 (전체화면 뷰어 전용).
// 긴 줄은 각 열 안에서 줄바꿈한다(Superset 동일) — 좌우 독립 가로 스크롤은 시선이 깨진다.
// 색은 글자색이 아니라 배경 틴트로 — 행 전체는 soft, 실제 달라진 구간(pre/suf 사이)은
// strong 으로 겹쳐 Superset 워드 하이라이트 무드를 낸다.
//
// ⚠️ 성능: 부모(useChanges)가 diff 내용이 같으면 같은 객체를 유지하므로 memo 로 폴링
// 재렌더가 0이 되고, 초대형 diff 는 CHUNK 행씩 끊어 그린다(한 번에 그리면 수만 DOM 노드).
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/Button';
import { parseUnifiedToSplit, type SplitRow } from '../lib/diff';

const CHUNK = 800; // 한 번에 그리는 행 수 — 일반 diff 는 한 청크로 끝난다

// 전체 파일 context(-U 큰 값)의 유일한 hunk 헤더 — 파일 처음부터 시작하므로 노이즈
const FULL_FILE_HUNK = /^@@ -[01](?:,\d+)? \+[01](?:,\d+)? @@/;

/** 달라진 구간만 <mark> 로 감싼 텍스트 — pre/suf 밖은 공통 부분 */
function segText(text: string, pre: number, suf: number, cls: string): ReactNode {
  const end = text.length - suf;
  if (pre >= end) return text; // 이 쪽엔 달라진 구간이 없다 (순수 삽입의 반대편)
  return (
    <>
      {text.slice(0, pre)}
      <mark className={cls}>{text.slice(pre, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * 행 하나 — rows 배열이 diff 별로 불변이라 memo 가 스크롤·부모 렌더에서 그대로 재사용된다.
 * 좌/우는 각각 [번호][본문] 한 덩어리(`__side`)다 — 2열 grid 여야 가운데 경계가 한 지점으로
 * 정해져 드래그로 비율을 조절할 수 있다(번호까지 4열이면 경계가 두 군데로 갈라진다).
 */
const Row = memo(function Row({ row }: { row: SplitRow }) {
  if (row.type === 'hunk') {
    return <div className="sdiff__hunk">{row.text}</div>;
  }
  const { left, right, changed, pre, suf } = row;
  const hl = changed && pre !== undefined && suf !== undefined;
  const side = (s: typeof left, kind: 'del' | 'add') => (
    <span
      className={
        'sdiff__side' + (changed ? (s ? ` sdiff__side--${kind}` : ' sdiff__side--void') : '')
      }
    >
      <span className="sdiff__no">{s?.no ?? ''}</span>
      <span className="sdiff__cell">
        {s ? (hl ? segText(s.text, pre, suf, `sdiff__seg sdiff__seg--${kind}`) : s.text) : ''}
      </span>
    </span>
  );
  return (
    <div className="sdiff__row">
      {side(left, 'del')}
      {side(right, 'add')}
    </div>
  );
});

export const SplitDiff = memo(function SplitDiff({
  diff,
  leftRatio = 50,
}: {
  diff: string;
  /** 좌(변경 전) 열 비율 % — 가운데 손잡이가 바꾼다 */
  leftRatio?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false); // 자동 스크롤은 마운트당 1회 — 갱신마다 튀지 않게

  const { rows, firstChanged } = useMemo(() => {
    let parsed = parseUnifiedToSplit(diff);
    // 전체 파일 모드: hunk 가 1개뿐이고 파일 처음부터면 헤더를 뺀다 — '변경 전/후 파일' 뷰
    if (
      parsed[0]?.type === 'hunk' &&
      FULL_FILE_HUNK.test(parsed[0].text) &&
      parsed.filter((r) => r.type === 'hunk').length === 1
    ) {
      parsed = parsed.slice(1);
    }
    return {
      rows: parsed,
      firstChanged: parsed.findIndex((r) => r.type === 'line' && r.changed),
    };
  }, [diff]);

  // 파일이 바뀌면 사용처가 key 로 리마운트해 초기화된다 (같은 파일 갱신은 유지).
  // 전체 파일 모드에선 첫 변경이 청크 밖에 숨지 않게 초기 상한을 그 너머까지 늘린다.
  const [limit, setLimit] = useState(() =>
    Math.max(CHUNK, firstChanged >= 0 ? firstChanged + CHUNK : 0)
  );

  // 첫 변경 위치로 자동 스크롤 — 전체 파일 뷰는 변경이 한참 아래일 수 있다
  useEffect(() => {
    if (scrolledRef.current || firstChanged < 0) return;
    scrolledRef.current = true;
    rootRef.current
      ?.querySelector('.sdiff__side--del, .sdiff__side--add, .sdiff__side--void')
      ?.scrollIntoView({ block: 'center' });
  }, [firstChanged]);

  if (rows.length === 0) {
    return <p className="sdiff__empty">표시할 변경 내용이 없습니다.</p>;
  }
  const visible = rows.length > limit ? rows.slice(0, limit) : rows;
  return (
    <div
      className="sdiff"
      ref={rootRef}
      style={{ '--sdiff-l': `${leftRatio}%` } as CSSProperties}
    >
      {visible.map((row, i) => (
        <Row key={i} row={row} />
      ))}
      {rows.length > limit && (
        <div className="sdiff__more">
          <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + CHUNK * 4)}>
            {rows.length - limit}행 더 보기
          </Button>
        </div>
      )}
    </div>
  );
});
