import { Component, Fragment } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Icon } from './Icon';
import type { ErrorInfo, ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** 무엇이 죽었는지 — 안내 문구에 그대로 들어간다 ("터미널", "근태") */
  label: string;
  /** 사이드바 위젯처럼 좁은 자리용 한 줄 표시 */
  compact?: boolean;
};

type State = { error: Error | null; attempt: number };

/**
 * 렌더 예외 격리 — 한 섹션·위젯에서 터진 예외가 앱 전체를 백지로 만들지 않게 한다.
 * (Electron 창은 새로고침 경로가 눈에 보이지 않아, 백지가 되면 사실상 재시작뿐이다.)
 *
 * ⚠️ 자식을 `attempt` 로 keying 하는 게 핵심이다 — state 의 error 만 비우면 React 는
 * 같은 엘리먼트 트리를 재사용해 오류 직전 상태가 그대로 살아 있고, 곧바로 다시 죽는다.
 * key 가 바뀌면 자식이 언마운트→마운트되어 초기 상태부터 다시 시작한다.
 *
 * 잡히는 것은 **렌더 중 예외**뿐이다 — 이벤트 핸들러·비동기 IPC 실패는 각 기능이
 * 지금처럼 토스트·에러 상태로 처리해야 한다.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // DevTools(⌘⌥I) 에서 추적할 수 있게 남긴다 — 화면에는 message 만 보인다
    console.error(
      `[error-boundary] ${this.props.label}:`,
      error,
      info.componentStack
    );
  }

  private retry = () => {
    // 반환 타입을 명시한다 — strictNullChecks 가 꺼져 있어 `null` 리터럴이 any 로 추론된다
    this.setState((s): State => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const { error, attempt } = this.state;
    const { children, label, compact } = this.props;

    if (!error) return <Fragment key={attempt}>{children}</Fragment>;

    if (compact) {
      return (
        <div className="err-box err-box--compact">
          <span className="err-box__msg">
            <Icon name="alert-triangle" size={14} />
            {label} 표시 오류
          </span>
          <Button size="sm" onClick={this.retry}>
            다시 시도
          </Button>
        </div>
      );
    }

    return (
      <div className="err-box">
        <EmptyState
          icon="alert-triangle"
          message={`${label} 화면을 표시하지 못했습니다.`}
          hint={error.message}
        />
        <Button onClick={this.retry}>다시 시도</Button>
      </div>
    );
  }
}
