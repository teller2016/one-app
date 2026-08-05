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
 * 팝오버(피커 옵션 리스트·캘린더) 배치 — `body` 로 portal 된 요소를 트리거 기준
 * `fixed` 좌표에 놓는다. 절대배치로 두면 모달 본문(`.modal__body`, overflow-y:auto)의
 * 스크롤 높이에 포함돼 스크롤바가 생기고 잘렸다.
 *
 * 아래 공간이 모자라면 위로 flip 하고, 좌우는 뷰포트 안으로 클램프한다.
 * `fixed` 는 조상 스크롤을 따라오지 않으므로 scroll(capture)·resize 에서 재배치한다.
 */
export function usePopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLElement | null>,
  {
    matchWidth = false,
    fitHeight = false,
  }: {
    /** 팝오버 폭을 트리거 폭에 맞춘다 (옵션 리스트 — 예전 `width: 100%` 대체) */
    matchWidth?: boolean;
    /** 남은 공간이 좁으면 max-height 로 줄인다 (내부 스크롤이 있는 리스트만) */
    fitHeight?: boolean;
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
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flip = h > below && above > below; // 아래가 모자라고 위가 더 넓으면 위로
    const room = Math.max(flip ? above : below, 120); // 아주 좁을 때도 최소 높이는 확보
    const maxHeight = fitHeight && h > room ? room : undefined;
    const width = matchWidth ? r.width : pop.offsetWidth;
    setStyle({
      position: 'fixed',
      top: flip
        ? Math.max(MARGIN, r.top - GAP - Math.min(h, room))
        : r.bottom + GAP,
      left: Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN)),
      ...(matchWidth ? { width: r.width } : null),
      ...(maxHeight ? { maxHeight } : null),
    });
  }, [anchorRef, popRef, matchWidth, fitHeight]);

  // 팝오버가 그려진 직후(페인트 전) 배치 — 엉뚱한 위치가 한 프레임 보이지 않게
  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      naturalH.current = 0;
      return;
    }
    place();
  }, [open, place]);

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
