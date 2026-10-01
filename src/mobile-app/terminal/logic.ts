// MO 터미널의 순수 로직 — DOM·xterm·WS 없이 단위 테스트한다(logic.test.ts).
// 옛 `src/mobile/mobile.ts` 에서 판정만 떼어 왔다 — 함정 주석은 그 자리의 것을 그대로 옮겼다.
import type { TerminalSessionInfo } from '../../shared/types';

/** 키 바의 키 → 터미널로 보낼 시퀀스 */
export const KEY_SEQ = {
  esc: '\x1b',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
  home: '\x1b[H',
  end: '\x1b[F',
  pgup: '\x1b[5~',
  pgdn: '\x1b[6~',
  'ctrl-c': '\x03',
  pipe: '|',
  tilde: '~',
  slash: '/',
  dash: '-',
} as const;
export type KeyName = keyof typeof KEY_SEQ;

/** 한 번 적용하는 수정 키 — 다음 입력 한 번에만 걸리고 풀린다 */
export type Modifiers = { ctrl: boolean; alt: boolean };

/**
 * 수정 키를 입력에 적용한다.
 * - ctrl: 다음 **한 글자**가 @~_ 범위(대소문자 무관)면 제어문자로(c → ^C). 그 밖이면 그대로.
 *   (옛 규칙 그대로 — 붙여넣기처럼 여러 글자면 걸지 않는다)
 * - alt: ESC 접두(메타 키 관례 — 터미널 앱이 Alt+키로 읽는다). ctrl 과 함께면 ESC + 제어문자.
 * 반환 `used` 가 true 면 수정 키를 소비했다(UI 토글을 끈다).
 */
export function applyModifiers(data: string, mods: Modifiers): { data: string; used: boolean } {
  if (!mods.ctrl && !mods.alt) return { data, used: false };
  let out = data;
  let used = false;
  if (mods.ctrl && data.length === 1) {
    used = true;
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code < 96) out = String.fromCharCode(code - 64);
  }
  if (mods.alt) {
    used = true;
    out = `\x1b${out}`;
  }
  return { data: out, used };
}

/**
 * xterm 이 **터미널 능력 질의(DA)에 자동 응답**하는 시퀀스 — DA1 `ESC[?1;2c` · DA2 `ESC[>0;276;0c`.
 *
 * ⚠️ attach 할 때 tmux 가 클라이언트 능력을 물어보는데, 폰은 WS 왕복이 있어 응답이 늦게
 * 돌아온다. 그러면 tmux 가 그 응답을 자기 것으로 못 알아보고 **pane 으로 흘려보내** 셸이나
 * claude 의 입력이 된다 — 세션을 열 때마다 화면에 `^[[?1;2c^[[>0;276;0c` 가 찍혔다
 * (2026-08-08 사용자 지적). 데스크톱은 IPC 라 왕복이 빨라 tmux 가 제때 받아 문제가 없다.
 * 사용자가 키보드로 칠 수 없는 입력이므로 걸러도 잃는 것이 없다. 키바의 esc(`\x1b` 한 글자)는
 * 이 패턴에 걸리지 않는다.
 */
// (ESC 를 정규식 리터럴에 직접 쓰면 no-control-regex 에 걸려 문자열로 조립한다)
const DA_REPLY_RE = new RegExp(`${String.fromCharCode(27)}\\[[?>][0-9;]*c`, 'g');
export const stripDaReplies = (data: string) => data.replace(DA_REPLY_RE, '');

/** 지금 보여줄 세션 — 작업 영역(scope)이 잡혀 있으면 그 위치에서 시작한 것만 */
export function visibleSessions(
  sessions: TerminalSessionInfo[],
  scopePath: string | null,
): TerminalSessionInfo[] {
  return scopePath ? sessions.filter((s) => s.cwd === scopePath) : sessions;
}

/**
 * 자동 attach 대상 — 알림으로 들어온 세션 → 마지막에 보던 세션 → 지금 영역의 첫 세션.
 * 마지막 세션은 작업 영역과 무관하게 이어본다(폰은 '이어서 쓰는' 화면이다).
 * ⚠️ 부르는 쪽이 `attachedId`·`pendingAttachId` 가 비었을 때만 부른다 — attach 응답 전에 두 번째
 * sessions 가 오면 알림과 다른 세션이 열렸다(2026-09-29 전체 검토).
 */
export function pickAutoAttach(
  sessions: TerminalSessionInfo[],
  opts: { wanted: string | null; last: string | null; scopePath: string | null },
): string | null {
  const byId = (id: string | null) => (id ? sessions.find((s) => s.id === id) : undefined);
  const next =
    byId(opts.wanted) ?? byId(opts.last) ?? visibleSessions(sessions, opts.scopePath)[0];
  return next?.id ?? null;
}

/**
 * 입력 대기 세션 — **안정화된 집합**.
 *
 * ⚠️ 상태를 그대로 반영하면 깜빡인다(2026-08-08 사용자 지적) — claude 는 입력 대기 화면에서도
 * 주기적으로 다시 그리고, 그 출력이 오는 순간 waiting→busy 로 내려갔다가 2.5초 침묵 뒤 다시
 * waiting 이 된다(`pty.ts` noteOutput/statusTick). 상태 판정은 데스크톱 알림·뱃지가 함께 쓰므로
 * 건드리지 않고 **집합만** 안정화한다: 대기가 생기면 즉시 넣고, 사라지면 유예 뒤 그때도 없으면 뺀다.
 * 알림도 **새로 들어온 순간**에만 보내므로 진동 구간마다 다시 울리지 않는다.
 *
 * 타이머는 주입한다(테스트가 가짜 시계를 쓴다).
 */
export class StableWaiting {
  readonly ids = new Set<string>();
  private leaveTimers = new Map<string, unknown>();
  private sessions: TerminalSessionInfo[] = [];

  constructor(
    private readonly graceMs: number,
    /** 유예가 끝나 집합이 줄었다 */
    private readonly onShrink: () => void,
    private readonly timers: {
      set: (fn: () => void, ms: number) => unknown;
      clear: (h: unknown) => void;
    } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  ) {}

  /** 새 세션 목록 반영 — 이번에 **새로 대기가 된** 세션 id 를 돌려준다 */
  update(sessions: TerminalSessionInfo[]): string[] {
    this.sessions = sessions;
    const now = new Set(sessions.filter((s) => s.status === 'waiting').map((s) => s.id));
    const added: string[] = [];
    for (const id of now) {
      const t = this.leaveTimers.get(id);
      if (t !== undefined) {
        this.timers.clear(t); // 진동이었다 — 빼려던 것을 취소
        this.leaveTimers.delete(id);
      }
      if (!this.ids.has(id)) {
        this.ids.add(id);
        added.push(id);
      }
    }
    for (const id of [...this.ids]) {
      if (now.has(id) || this.leaveTimers.has(id)) continue;
      if (!sessions.some((s) => s.id === id)) {
        this.ids.delete(id); // 세션 자체가 사라졌다(종료) — 유예할 이유가 없다
        continue;
      }
      this.leaveTimers.set(
        id,
        this.timers.set(() => {
          this.leaveTimers.delete(id);
          if (this.sessions.some((s) => s.id === id && s.status === 'waiting')) return; // 그새 다시 대기
          this.ids.delete(id);
          this.onShrink();
        }, this.graceMs),
      );
    }
    return added;
  }
}

/** 키보드가 열렸다고 볼 높이 감소 — 주소창 표시/숨김(≈50px)과 구분되는 문턱 */
export const KEYBOARD_MIN_DELTA = 120;

