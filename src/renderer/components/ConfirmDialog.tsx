import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { Button } from './Button';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string; // 기본 '확인'
  cancelLabel?: string; // 기본 '취소'
  danger?: boolean; // 파괴적 동작(삭제·중지) — danger 버튼으로
};

type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void };

// Provider 밖에서 호출되면 항상 취소로 처리 (no-op)
const ConfirmContext = createContext<
  (opts: ConfirmOptions) => Promise<boolean>
>(() => Promise.resolve(false));

/**
 * 확인 다이얼로그 함수를 반환 — window.confirm 대체 (promise 기반).
 * `if (!(await confirm({ title: '프로젝트 삭제', danger: true }))) return;`
 */
export function useConfirm() {
  return useContext(ConfirmContext);
}

/**
 * 전역 확인 다이얼로그 — App 최상단에서 한 번만 감싼다.
 * Escape/오버레이 클릭 = 취소, Enter = 확인. 스타일은 _base.scss 의 .confirm 사용.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // 드물게 이미 떠 있는 상태에서 또 요청되면 이전 요청은 취소로 정리
        setPending((prev) => {
          prev?.resolve(false);
          return { ...opts, resolve };
        });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok);
      setPending(null);
    },
    [pending],
  );

  // 키보드 — capture 로 먼저 받아 아래 깔린 Modal 의 Escape 닫힘을 막는다
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        close(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="modal-overlay modal-overlay--center confirm-overlay"
          onClick={() => close(false)}
        >
          <div
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="confirm__title" id="confirm-title">
              {pending.title}
            </h3>
            {pending.message && (
              <p className="confirm__msg">{pending.message}</p>
            )}
            <div className="confirm__actions">
              <Button onClick={() => close(false)}>
                {pending.cancelLabel ?? '취소'}
              </Button>
              <Button
                variant={pending.danger ? 'danger' : 'primary'}
                autoFocus
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? '확인'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
