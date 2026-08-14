import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';

const MARGIN = 8; // 뷰포트 가장자리 최소 여백
const GAP = 6; // 트리거와 팝오버 사이 간격 (예전 `top: calc(100% + 6px)` 과 동일)

/**
 * 팝오버(피커 옵션 리스트·캘린더·사이드바 위젯) 배치 — 트리거 기준 `fixed` 좌표에 놓는다.
 * `body` 로 portal 된 요소가 주 대상이지만, 흐름에서 빠지는 `fixed` 라면 제자리 렌더도 된다.
 * 절대배치로 두면 모달 본문(`.modal__body`, overflow-y:auto)의 스크롤 높이에 포함돼
 * 스크롤바가 생기고 잘렸다.
 *
 * `side: 'bottom'`(기본)은 트리거 아래에 놓고 공간이 모자라면 위로 flip,
 * `side: 'right'` 는 트리거 오른쪽에 놓고 모자라면 왼쪽으로 flip 한다(세로는 중앙 정렬).
 * 어느 쪽이든 뷰포트 안으로 클램프한다.
 * `fixed` 는 조상 스크롤을 따라오지 않으므로 scroll(capture)·resize 에서 재배치한다.
 */
export function usePopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  {
    matchWidth = false,
    fitHeight = false,
    side = 'bottom',
  }: {
    /** 팝오버 폭을 트리거 폭에 맞춘다 (옵션 리스트 — 예전 `width: 100%` 대체) */
    matchWidth?: boolean;
    /** 남은 공간이 좁으면 max-height 로 줄인다 (내부 스크롤이 있는 리스트만) */
    fitHeight?: boolean;
    /** 트리거의 어느 쪽에 붙일지 — 'right' 는 접힌 사이드바 위젯처럼 옆으로 펼칠 때 */
    side?: 'bottom' | 'right';
  } = {},
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  // 자연 높이(인라인 max-height 를 걸기 전 값) — 줄여 놓은 높이로 다시 재면
  // 위/아래 판단이 스스로 흔들린다(축소 → 아래도 충분 → 확대 → …)
  const naturalH = useRef(0);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;
    const r = anchor.getBoundingClientRect();
    if (!naturalH.current) naturalH.current = pop.offsetHeight;
    const h = naturalH.current;
    const width = matchWidth ? r.width : pop.offsetWidth;
    const clampX = (x: number) =>
      Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
    const clampY = (y: number) =>
      Math.max(MARGIN, Math.min(y, window.innerHeight - h - MARGIN));

    // 옆으로 펼치는 배치 — 세로는 트리거 중앙에 맞추고 뷰포트 안으로 밀어 넣는다
    // (접힌 사이드바 하단 위젯은 이 클램프로 자연히 화면 아래쪽에 붙는다)
    if (side === 'right') {
      const fitsRight = r.right + GAP + width + MARGIN <= window.innerWidth;
      setStyle({
        position: 'fixed',
        top: clampY(r.top + r.height / 2 - h / 2),
        left: fitsRight ? r.right + GAP : clampX(r.left - GAP - width),
        // 진입 모션(pop-in)이 트리거 쪽에서 자라나게 — flip 되면 반대편이 기준
        transformOrigin: fitsRight ? 'left center' : 'right center',
        ...(matchWidth ? { width: r.width } : null),
      });
      return;
    }

    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flip = h > below && above > below; // 아래가 모자라고 위가 더 넓으면 위로
    const room = Math.max(flip ? above : below, 120); // 아주 좁을 때도 최소 높이는 확보
    const maxHeight = fitHeight && h > room ? room : undefined;
    setStyle({
      position: 'fixed',
      top: flip
        ? Math.max(MARGIN, r.top - GAP - Math.min(h, room))
        : r.bottom + GAP,
      left: clampX(r.left),
      // 위로 flip 되면 아래쪽 모서리를 기준으로 자라나야 트리거에서 나온 것처럼 보인다
      transformOrigin: flip ? 'bottom center' : 'top center',
      ...(matchWidth ? { width: r.width } : null),
      ...(maxHeight ? { maxHeight } : null),
    });
  }, [anchorRef, popRef, matchWidth, fitHeight, side]);

  // 팝오버가 그려진 직후(페인트 전) 배치 — 엉뚱한 위치가 한 프레임 보이지 않게
  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      naturalH.current = 0;
      return;
    }
    place();
  }, [open, place]);

  // 내용이 자라면 다시 배치한다 — 옆 배치는 세로 중앙 정렬이라 높이가 바뀌면 위치가 어긋나고,
  // 열린 뒤 펼쳐지는 폼(VPN 설정)이 화면 밖으로 넘어간다.
  // ⚠️ bottom 배치에는 걸지 않는다 — fitHeight 가 max-height 를 걸어 줄인 높이를 되재면
  //    위/아래 판단이 스스로 진동한다(축소 → 아래도 충분 → 확대 → …).
  useEffect(() => {
    const pop = popRef.current;
    if (!open || side !== 'right' || !pop) return;
    const ro = new ResizeObserver(() => {
      naturalH.current = pop.offsetHeight;
      place();
    });
    ro.observe(pop);
    return () => ro.disconnect();
  }, [open, side, place, popRef]);

  useEffect(() => {
    if (!open) return;
    // capture 로 받아 모달 본문 같은 내부 스크롤러까지 잡는다(팝오버 자신의 스크롤은 제외)
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      place();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place, popRef]);

  // 측정 전에는 숨긴다 (top/left 0 에 한 프레임 스치는 것 방지)
  return style ?? { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}
