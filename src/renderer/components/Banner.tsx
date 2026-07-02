import type { ReactNode } from 'react';

/** 경고/안내 배너 (노란색) */
export function Banner({ children }: { children: ReactNode }) {
  return <div className="banner">{children}</div>;
}
