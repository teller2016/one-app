import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useBackClose } from '../lib/useBackClose';
import { Banner } from './Banner';
import { Button } from './Button';
import { Input } from './Input';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string; // 기본 '확인'
  cancelLabel?: string; // 기본 '취소'
  danger?: boolean; // 파괴적 동작(삭제·중지) — danger 버튼으로
  warning?: string; // 메시지 아래 경고 띠 (Banner warning)
  /** 이중 확인 — 이 문자열을 그대로 입력해야 확인 버튼이 눌린다 (예: 머지 대상 브랜치명) */
  requireText?: string;
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
 * Escape = 취소, Enter = 포커스된 버튼(기본은 확인). 스타일은 _base.scss 의 .confirm 사용.
 * 일반 Modal 과 달리 dim(오버레이) 클릭으로는 닫히지 않는다 — 확인/취소는 명시적 선택만.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [typed, setTyped] = useState(''); // requireText 입력값
  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
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

  // requireText 가 있으면 입력이 일치할 때만 확인할 수 있다
  const ready = !pending?.requireText || typed.trim() === pending.requireText;

  // 폰 뒤로가기 = 취소 (Escape 와 같은 의미) — 떠 있는 동안만 히스토리 항목을 쥔다
  useBackClose(useCallback(() => close(false), [close]), !!pending);

  // 키보드 — capture 로 먼저 받아 아래 깔린 Modal 의 Escape 닫힘을 막는다
  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Enter') {
        if (e.isComposing) return; // 한글 조합 확정용 Enter 는 IME 몫
        e.stopPropagation();
        // 다이얼로그 안 버튼에 포커스가 있으면 그 버튼의 기본 동작(click)에 맡긴다 —
        // Tab 으로 [취소]에 옮겨 놓고 Enter 를 눌렀는데 '확인'이 되면 안 된다
        const active = document.activeElement;
        if (active instanceof HTMLButtonElement && dialogRef.current?.contains(active)) return;
        if (ready) close(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pending, close, ready]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal-overlay modal-overlay--center confirm-overlay">
          <div
            ref={dialogRef}
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h3 className="confirm__title" id="confirm-title">
              {pending.title}
            </h3>
            {pending.message && (
              <p className="confirm__msg">{pending.message}</p>
            )}
            {(pending.warning || pending.requireText) && (
              <div className="confirm__check">
                {pending.warning && <Banner variant="warning">{pending.warning}</Banner>}
                {pending.requireText && (
                  <>
                    <label className="confirm__label" htmlFor="confirm-text">
                      확인을 위해 <code>{pending.requireText}</code> 입력
                    </label>
                    <Input
                      id="confirm-text"
                      type="text"
                      autoFocus
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={pending.requireText}
                    />
                  </>
                )}
              </div>
            )}
            <div className="confirm__actions">
              <Button onClick={() => close(false)}>
                {pending.cancelLabel ?? '취소'}
              </Button>
              <Button
                variant={pending.danger ? 'danger' : 'primary'}
                // 입력칸이 있으면 포커스는 입력칸에 (버튼이 나중에 마운트돼 가져가지 않게)
                autoFocus={!pending.requireText}
                disabled={!ready}
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
