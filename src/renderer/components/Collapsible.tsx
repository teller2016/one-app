import type { ReactNode } from 'react';
import { useState } from 'react';
import { Icon } from './Icon';

type CollapsibleProps = {
  /** 그룹 제목 */
  title: string;
  /** 제목 왼쪽 아이콘 (Icon 컴포넌트 — 이모지 금지) */
  icon?: ReactNode;
  /** 지정하면 열림/닫힘 상태를 localStorage 에 기억한다 */
  storageKey?: string;
  /** 저장된 상태가 없을 때 기본 열림 여부 (기본 열림) */
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * 공통 열고닫기 그룹 — <details> 기반. 관련 설정·내용을 접을 수 있게 묶는다.
 * 스타일은 _base.scss 의 .collapsible 계열을 사용한다.
 */
export function Collapsible({
  title,
  icon,
  storageKey,
  defaultOpen = true,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    const saved = localStorage.getItem(storageKey);
    return saved === null ? defaultOpen : saved === '1';
  });

  return (
    <details
      className="collapsible"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        setOpen(next);
        if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0');
      }}
    >
      <summary className="collapsible__head">
        <span className="collapsible__chev">
          <Icon name="chevron-right" size={14} />
        </span>
        {icon}
        {title}
      </summary>
      <div className="collapsible__body">{children}</div>
    </details>
  );
}
