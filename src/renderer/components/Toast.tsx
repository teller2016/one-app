import type { ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Icon } from './Icon';
import { navigateSection } from '../lib/sectionNav';

type ToastVariant = 'ok' | 'fail' | 'info';

export type ToastAction = {
  label: string;
  /** 지정 시 클릭에서 해당 섹션으로 이동 (sectionNav 경유 — 앱 셸이 검증) */
  section?: string;
  onClick?: () => void;
};

export type ToastOptions = {
  variant?: ToastVariant;
  /** 굵은 제목 줄 — 알림성 토스트용 (message 위에 표시) */
  title?: string;
  /** 자동 소멸까지 ms — 기본 2000 (sticky 면 무시) */
  duration?: number;
  /** true 면 자동으로 사라지지 않고 ✕ 로 직접 닫는다 */
  sticky?: boolean;
  /** 우측 액션 버튼 (예: 배포 완료 → [이동]) */
  action?: ToastAction;
  /** 같은 키의 기존 토스트를 교체한다 — sticky 여도 쌓이지 않는다 (예: 세션당 입력대기 1장) */
  dedupeKey?: string;
};

type ToastItem = ToastOptions & {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean; // 퇴장 애니메이션 중 (끝나면 제거)
};

// 확인성 호출 하위호환: toast('저장', 'fail') — 새 형태는 toast('…', {sticky: true, …})
type ToastFn = (message: string, opts?: ToastVariant | ToastOptions) => void;

// Provider 밖에서 호출되면 조용히 무시 (no-op)
const ToastContext = createContext<ToastFn>(() => undefined);
const ToastDismissContext = createContext<(dedupeKey: string) => void>(
  () => undefined,
);

/**
 * 토스트 표시 함수를 반환 — `toast('저장되었습니다')` / 실패는 `toast('저장 실패', 'fail')`
 * 알림성은 옵션으로: `toast('배포가 완료됐습니다', {title: '배포 성공', sticky: true, action: {label: '이동', section: 'deploy'}})`
 */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * `dedupeKey` 로 떠 있는 토스트를 닫는 함수를 반환 — 알림의 용건이 끝났을 때 쓴다
 * (예: 입력대기 토스트가 가리키던 세션을 사용자가 화면에 띄웠다).
 * 그 키의 토스트가 없으면 아무 일도 하지 않는다.
 */
export function useToastDismiss() {
  return useContext(ToastDismissContext);
}

const LEAVE_MS = 180; // 퇴장 애니메이션 길이 — _base.scss 의 toast-out(--dur-2) 과 동기화
const MAX_TOASTS = 6; // 초과 시 가장 오래된 것부터 즉시 제거

const VARIANT_ICON: Record<ToastVariant, 'check' | 'alert-triangle' | 'info'> =
  {
    ok: 'check',
    fail: 'alert-triangle',
    info: 'info',
  };

/** 토스트 한 장 — 자기 타이머(hover 시 일시정지)와 액션·닫기를 스스로 처리한다 */
function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { id, sticky, duration } = item;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const start = useCallback(() => {
    if (sticky) return;
    stop();
    timer.current = setTimeout(() => onDismiss(id), duration ?? 2000);
  }, [sticky, duration, id, onDismiss, stop]);

  useEffect(() => {
    start();
    return stop;
  }, [start, stop]);

  const runAction = () => {
    item.action?.onClick?.();
    if (item.action?.section) navigateSection(item.action.section);
    onDismiss(id);
  };

  return (
    <div
      className={`toast toast--${item.variant}${item.leaving ? ' toast--leaving' : ''}`}
      role="status"
      // hover 동안 타이머 정지 — 액션 버튼을 누를 시간을 준다
      onMouseEnter={stop}
      onMouseLeave={start}
    >
      <span className="toast__icon">
        <Icon name={VARIANT_ICON[item.variant]} size={14} />
      </span>
      <div className="toast__body">
        {item.title && <div className="toast__title">{item.title}</div>}
        <div className="toast__msg">{item.message}</div>
      </div>
      {item.action && (
        <button type="button" className="toast__action" onClick={runAction}>
          {item.action.label}
        </button>
      )}
      {item.sticky && (
        <button
          type="button"
          className="toast__close"
          aria-label="닫기"
          onClick={() => onDismiss(id)}
        >
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  );
}

/**
 * 전역 토스트 — 우측 아래에 스택으로 쌓인다. App 최상단에서 한 번만 감싼다.
 * 스타일은 _base.scss 의 .toasts/.toast 사용.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    // 바로 지우지 않고 leaving 표시 → 퇴장 애니메이션 후 제거
    setItems((cur) =>
      cur.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(
      () => setItems((cur) => cur.filter((t) => t.id !== id)),
      LEAVE_MS,
    );
  }, []);

  /**
   * 같은 dedupeKey 의 토스트를 모두 닫는다 (없으면 no-op).
   * 닫을 것이 없을 때 **상태를 바꾸지 않는 것**이 중요하다 — 세션을 전환할 때마다
   * 불리므로 매번 새 배열을 반환하면 그때마다 앱 전체가 리렌더된다.
   */
  const dismissByKey = useCallback((dedupeKey: string) => {
    setItems((cur) =>
      cur.some((t) => t.dedupeKey === dedupeKey && !t.leaving)
        ? cur.map((t) =>
            t.dedupeKey === dedupeKey ? { ...t, leaving: true } : t,
          )
        : cur,
    );
    // 퇴장 애니메이션 후 제거 — 그 사이 같은 키로 새 토스트가 오면(leaving=false) 살아남는다
    setTimeout(() => {
      setItems((cur) => {
        const next = cur.filter((t) => t.dedupeKey !== dedupeKey || !t.leaving);
        return next.length === cur.length ? cur : next;
      });
    }, LEAVE_MS);
  }, []);

  const show = useCallback<ToastFn>((message, opts) => {
    const o: ToastOptions =
      typeof opts === 'string' ? { variant: opts } : (opts ?? {});
    setItems((cur) => {
      // 같은 확인성 토스트 연타(복사 등)는 쌓지 않고 교체 — 타이머·애니메이션이 새로 돈다.
      // dedupeKey 가 있으면 sticky·액션 여부와 무관하게 같은 키를 교체한다.
      const next = cur.filter((t) =>
        o.dedupeKey
          ? t.dedupeKey !== o.dedupeKey
          : t.sticky ||
            t.action ||
            t.leaving ||
            t.message !== message ||
            t.title !== o.title,
      );
      next.push({
        ...o,
        id: ++seq.current,
        message,
        variant: o.variant ?? 'ok',
        leaving: false,
      });
      return next.slice(-MAX_TOASTS);
    });
  }, []);

  return (
    <ToastContext.Provider value={show}>
      <ToastDismissContext.Provider value={dismissByKey}>
        {children}
        {items.length > 0 && (
          <div className="toasts">
            {items.map((t) => (
              <ToastCard key={t.id} item={t} onDismiss={dismiss} />
            ))}
          </div>
        )}
      </ToastDismissContext.Provider>
    </ToastContext.Provider>
  );
}
