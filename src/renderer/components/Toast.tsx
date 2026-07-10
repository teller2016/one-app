import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Icon } from './Icon';

type ToastVariant = 'ok' | 'fail';
type ToastState = { message: string; variant: ToastVariant };

// Provider 밖에서 호출되면 조용히 무시 (no-op)
const ToastContext = createContext<
  (message: string, variant?: ToastVariant) => void
>(() => undefined);

/** 토스트 표시 함수를 반환 — `toast('저장되었습니다')` / 실패는 `toast('저장 실패', 'fail')` */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * 전역 토스트 — 하단 중앙에 2초간 표시 후 사라진다.
 * App 최상단에서 한 번만 감싼다. 스타일은 _base.scss 의 .toast 사용.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, variant: ToastVariant = 'ok') => {
    setState({ message, variant });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), 2000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {state && (
        <div
          className={`toast${state.variant === 'fail' ? ' toast--fail' : ''}`}
          role="status"
        >
          <span className="toast__icon">
            <Icon
              name={state.variant === 'fail' ? 'alert-triangle' : 'check'}
              size={14}
            />
          </span>
          {state.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
