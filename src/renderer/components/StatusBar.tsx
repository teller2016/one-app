import { createContext, useContext, type ReactNode, type Ref } from 'react';

/**
 * 창 하단 상태바 — VPN·메일·폰 미러링·MO·근태 같은 상주 위젯의 자리.
 * (2026-09-30 리디자인: 사이드바 머리·꼬리에 있던 위젯을 여기로 옮겼다)
 *
 * 항목 자체는 한 줄 요약(아이콘·상태점·짧은 문구)만 보이고, 조작은 눌렀을 때 뜨는
 * 팝오버(`StatusWidget`)나 모달이 맡는다.
 */
const InStatusBar = createContext(false);

/** 상태바 안에 그려지고 있는지 — 위젯이 한 줄 요약 + 팝오버 모드로 바뀔지 판단할 때 쓴다 */
export const useInStatusBar = () => useContext(InStatusBar);

export function StatusBar({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <footer className="statusbar">
      <InStatusBar.Provider value={true}>
        <div className="statusbar__group">{left}</div>
        <div className="statusbar__spacer" />
        <div className="statusbar__group">{right}</div>
      </InStatusBar.Provider>
    </footer>
  );
}

/**
 * 상태바 항목 버튼 — `[아이콘][상태점][문구][카운트]`.
 * 팝오버를 여는 위젯(`StatusWidget`)과 모달을 바로 여는 항목(메일·MO)이 함께 쓴다.
 */
export function StatusBarItem({
  ref,
  icon,
  dot,
  label,
  count,
  title,
  active = false,
  disabled = false,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  icon: ReactNode;
  /** 상태를 나르는 점·표식 (StatusDot 등) */
  dot?: ReactNode;
  /** 한 줄 요약 — 짧게 (예: `VPN 10.8.0.6`, `출근 09:02`) */
  label?: ReactNode;
  /** 오른쪽 카운트 뱃지 (안읽은 메일 등) — 0·undefined 면 숨김 */
  count?: string | number;
  /** 요약에 다 담기지 않는 상태 문구 — 툴팁·스크린리더용 */
  title: string;
  /** 팝오버가 열려 있음 */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      ref={ref}
      className={'statusbar__item' + (active ? ' statusbar__item--active' : '')}
      title={title}
      aria-label={title}
      aria-expanded={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="statusbar__icon">{icon}</span>
      {dot}
      {label != null && <span className="statusbar__label">{label}</span>}
      {count != null && count !== 0 && count !== '0' && (
        <span className="statusbar__count">{count}</span>
      )}
    </button>
  );
}
