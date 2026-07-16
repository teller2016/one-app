// 주간보고 차트 색·폰트의 단일 공급원 — _base.scss 의 CSS 토큰을 런타임에 읽는다.
//
// ⚠️ readChartTheme() 를 모듈 톱레벨에서 평가하지 말 것:
//    Vite HMR/스타일 주입 타이밍에 토큰이 아직 주입되지 않아 빈 값이 될 수 있다.
//    반드시 차트를 생성하는 useEffect(또는 렌더) 안에서 호출한다.
//    (호출 비용은 무시 가능한 수준 — 사원 전환마다 다시 읽어도 문제없다)

/** 토큰을 읽지 못했을 때의 폴백 — _base.scss 값과 동일하게 유지할 것 */
const FALLBACK: Record<string, string> = {
  '--text': '#1d1d1f',
  '--text-2': '#515154',
  '--border': '#e0e0e0',
  '--surface-1': '#ffffff',
  '--fs-caption': '11px',
  '--fs-metric': '24px',
  // 차트 카테고리컬 팔레트 (T/OT 쌍 — 애플 시스템 컬러, O쌍은 ptag 글자용 대비 검증됨)
  '--chart-1t': '#007aff',
  '--chart-1o': '#0064d1',
  '--chart-2t': '#34c759',
  '--chart-2o': '#207b37',
  '--chart-3t': '#ff9500',
  '--chart-3o': '#9e5c00',
  '--chart-4t': '#af52de',
  '--chart-4o': '#9345ba',
  '--chart-5t': '#30b0c7',
  '--chart-5o': '#207483',
  '--chart-6t': '#ff2d55',
  '--chart-6o': '#c72342',
  '--chart-7t': '#5856d6',
  '--chart-7o': '#5856d6',
  '--chart-8t': '#a2845e',
  '--chart-8o': '#7e6749',
  '--chart-9t': '#f5c400',
  '--chart-9o': '#896e00',
  '--chart-10t': '#8e8e93',
  '--chart-10o': '#6c6c70',
};

/** 팔레트 쌍 개수 (--chart-1t ~ --chart-10o) */
const PALETTE_SIZE = 10;

export type ChartTheme = {
  /**
   * 팔레트 색 — index 는 프로젝트 순번(순환), type 0=T(기본)·1=OT(보조).
   * 상세 일정 ptag 와 막대/도넛 차트가 공용으로 사용한다.
   */
  getColor: (index?: number, type?: 0 | 1) => string;
  /** 축 tick 글자색 (--text-2) */
  tickColor: string;
  /** 그리드 선 색 (--border) */
  gridColor: string;
  /** 범례 글자색 (--text-2) */
  legendColor: string;
  /** 축·범례 글자 크기 (--fs-caption) */
  captionSize: number;
  /** 본문 폰트 패밀리 (body 상속값) */
  fontFamily: string;
  /** 도넛 중앙 큰 숫자 색 (--text) */
  centerTextColor: string;
  /** 도넛 중앙 큰 숫자 폰트 — '700 24px <본문 폰트>' */
  centerTextFont: string;
  /** 도넛 중앙 보조 라벨 색 (--text-2) */
  centerSubColor: string;
  /** 도넛 중앙 보조 라벨 폰트 — '400 11px <본문 폰트>' */
  centerSubFont: string;
  /** 스택/도넛 세그먼트 사이 1px 경계 — 색각 보정 (DESIGN.md 1장) */
  segmentBorder: { borderColor: string; borderWidth: number };
};

/** 토큰 하나 읽기 — 빈 값이면 폴백 상수 사용 (.trim() 필수) */
const readVar = (styles: CSSStyleDeclaration, name: string): string => {
  const value = styles.getPropertyValue(name).trim();
  return value || FALLBACK[name] || '';
};

/** '11px' 류 크기 토큰 → 숫자 (chart.js font.size 용) */
const readSize = (styles: CSSStyleDeclaration, name: string): number => {
  const parsed = parseInt(readVar(styles, name), 10);
  return Number.isNaN(parsed) ? parseInt(FALLBACK[name], 10) : parsed;
};

/** 호출 시점의 CSS 토큰으로 차트 테마를 구성한다 (useEffect 안에서 호출할 것) */
export function readChartTheme(): ChartTheme {
  const styles = getComputedStyle(document.documentElement);

  const palette = Array.from({ length: PALETTE_SIZE }, (_, i) => ({
    t: readVar(styles, `--chart-${i + 1}t`),
    o: readVar(styles, `--chart-${i + 1}o`),
  }));

  const getColor = (index = 0, type: 0 | 1 = 0): string => {
    const i = index < 0 ? 0 : index;
    const pair = palette[i % palette.length];
    return type === 0 ? pair.t : pair.o;
  };

  const fontFamily =
    getComputedStyle(document.body).fontFamily.trim() || 'sans-serif';
  const captionSize = readSize(styles, '--fs-caption');
  const metricSize = readSize(styles, '--fs-metric');
  const text = readVar(styles, '--text');
  const text2 = readVar(styles, '--text-2');

  return {
    getColor,
    tickColor: text2,
    gridColor: readVar(styles, '--border'),
    legendColor: text2,
    captionSize,
    fontFamily,
    centerTextColor: text,
    centerTextFont: `700 ${metricSize}px ${fontFamily}`,
    centerSubColor: text2,
    centerSubFont: `400 ${captionSize}px ${fontFamily}`,
    segmentBorder: {
      borderColor: readVar(styles, '--surface-1'),
      borderWidth: 1,
    },
  };
}
