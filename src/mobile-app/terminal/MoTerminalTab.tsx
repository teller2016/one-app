// MO 터미널 탭 — 리디자인 목업(캔버스 MO(폰) — MoTerminal·MoTerminalKeyboard·MoTerminalMenu·
// MoWorkspaceSheet·MoNewSession·MoStates)을 그대로 옮긴 화면. 로직은 전부 controller.ts 에 있고
// 여기는 상태를 그린다. 셸이 탭을 바꿔도 **언마운트하지 않는다**(keep-alive — `active` 로 숨김).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Icon, type IconName } from '../../renderer/components/Icon';
import { useConfirm } from '../../renderer/components/ConfirmDialog';
import { useToast } from '../../renderer/components/Toast';
import { useCopy } from '../../renderer/lib/useCopy';
import { useBackClose } from '../../renderer/lib/useBackClose';
// ⚠️ 기능 배럴(features/terminal/index.ts)이 아니라 순수 헬퍼 파일을 직접 가져온다 — 배럴은
// TerminalSection(→ 데스크톱 xterm 5종)을 끌고 와 폰 번들이 커진다(그 배럴 주석 참고)
import { initials, tileColor } from '../../renderer/features/terminal/lib/workspace';
import type { TerminalPreset, TerminalSessionInfo } from '../../shared/types';
import { presetsForWorkspace } from '../../shared/types';
import type { TermWorkspaceNode } from '../../shared/terminal-protocol';
import { controller, FONT_MAX, FONT_MIN, type MoScope } from './controller';
import type { KeyName } from './logic';
import { MoChatView } from './MoChatView';

type GoTab = 'terminal' | 'changes' | 'jira' | 'prs' | 'more';
type Sheet = 'menu' | 'workspace' | 'new' | null;

const useTermState = () => useSyncExternalStore(controller.subscribe, controller.getState);

const lastSeg = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

/** 워크스페이스 이니셜 타일 — 데스크톱 타일과 같은 파스텔 팔레트(--tile-N)·이니셜 규칙 */
function Tile({ name, color, dim }: { name: string; color?: number; dim?: boolean }) {
  return (
    <span
      className={`moterm__tile moterm__tile--c${tileColor({ name, color })}${dim ? ' moterm__tile--dim' : ''}`}
      aria-hidden="true"
    >
      {initials(name, 2)}
    </span>
  );
}

/** 바텀시트 공용 틀 — 스크림 + 손잡이 + 제목/닫기. 뒤로가기로도 닫힌다(useBackClose) */
function Sheet({
  title,
  onClose,
  tall,
  head,
  children,
}: {
  title?: string;
  onClose: () => void;
  tall?: boolean;
  /** 제목 대신 넣을 머리 (세션 메뉴는 세션 요약을 머리로 쓴다) */
  head?: React.ReactNode;
  children: React.ReactNode;
}) {
  useBackClose(onClose);
  return (
    <div className="moterm__sheet-layer">
      <button type="button" className="moterm__scrim" aria-label="닫기" onClick={onClose} />
      <section className={`moterm__sheet${tall ? ' moterm__sheet--tall' : ''}`} aria-label={title}>
        <span className="moterm__grip" aria-hidden="true" />
        <div className="moterm__sheet-head">
          {head ?? <h2 className="moterm__sheet-title">{title}</h2>}
          <button type="button" className="moterm__icon-btn" aria-label="닫기" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function statusOf(s: TerminalSessionInfo): 'wait' | 'busy' | null {
  if (s.status === 'waiting') return 'wait';
  if (s.working || s.status === 'busy') return 'busy';
  return null;
}

const STATUS_LABEL = { wait: '입력 대기', busy: '작업 중' } as const;

/**
 * 키 바·키보드 버튼 — **누르는 순간(pointerdown)** 보낸다. pointerdown 을 막아야 xterm 포커스(=소프트 키보드)가
 * 유지되는데, WebKit 은 그때 click 을 보내지 않는 경우가 있어(2026-10-01 Playwright iPhone 실측) click 에 기대면
 * 키가 먹통이 된다. 키보드(Enter·Space)로 누른 경우만 click(detail 0)으로 받는다.
 */
const press = (fn: () => void) => ({
  onPointerDown: (e: ReactPointerEvent) => {
    e.preventDefault();
    fn();
  },
  onClick: (e: ReactMouseEvent) => {
    if (e.detail === 0) fn();
  },
});

export function MoTerminalTab({ active, onGoTab }: { active: boolean; onGoTab: (id: GoTab) => void }) {
  const st = useTermState();
  const hostRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const copy = useCopy();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    controller.start();
    if (hostRef.current) controller.mount(hostRef.current);
  }, []);
  useEffect(() => controller.setActive(active), [active]);
  useEffect(() => controller.onNotice((t) => toast(t)), [toast]);
  // 알림을 눌러 들어오면 터미널 탭으로 — 셸이 다른 탭을 보고 있을 수 있다
  const goTabRef = useRef(onGoTab);
  goTabRef.current = onGoTab;
  useEffect(() => controller.onFocusRequest(() => goTabRef.current('terminal')), []);
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => searchRef.current?.focus());
  }, [searchOpen]);

  const chips = controller.chipSessions(); // st 가 바뀔 때마다 렌더되므로 매번 계산(작은 배열)
  const attached = st.attachedId ? st.sessions.find((s) => s.id === st.attachedId) : undefined;
  const closeSheet = useCallback(() => setSheet(null), []);

  // 상단 작업 영역 표시 — 고른 영역, 없으면 보고 있는 세션이 속한 워크트리(→ 그 위치), 없으면 '전체 세션'
  const head = useMemo(() => {
    if (st.scope) return { name: st.scope.wsName, color: st.scope.wsColor, sub: st.scope.branch ?? st.scope.name };
    if (!attached) return null;
    for (const ws of st.workspaces) {
      const wt = ws.worktrees.find((w) => w.path === attached.cwd);
      if (wt) return { name: ws.name, color: ws.color, sub: wt.branch ?? wt.name };
    }
    return { name: attached.projectName ?? lastSeg(attached.cwd), color: undefined, sub: lastSeg(attached.cwd) };
  }, [st.scope, st.workspaces, attached]);

  const killAttached = async () => {
    if (!attached) return;
    setSheet(null);
    // 되돌릴 수 없으므로 한 번 더 묻는다(폰은 오터치가 잦다) — 서버가 kill 후 sessions·exit 를 보낸다
    const ok = await confirm({
      title: `'${attached.title}' 세션을 종료할까요?`,
      message: '실행 중인 작업이 함께 끝납니다.',
      confirmLabel: '종료',
      danger: true,
    });
    if (ok) controller.kill(attached.id);
  };

  const doCopy = async () => {
    const text = controller.selectionText();
    if (!text) {
      toast('선택한 줄이 없습니다');
      return;
    }
    if (await copy(text, { success: `${st.selectedLines}줄을 복사했습니다` })) controller.setSelecting(false);
  };

  const key = (k: KeyName, label: string, aria: string) => (
    <button
      type="button"
      className="moterm__key"
      aria-label={aria}
      // 키보드가 떠 있을 때 xterm 포커스(=키보드)를 유지한 채 보낸다
      {...press(() => controller.sendKey(k))}
    >
      {label}
    </button>
  );
  const mod = (m: 'ctrl' | 'alt') => (
    <button
      type="button"
      className={`moterm__key${st.mods[m] ? ' moterm__key--on' : ''}`}
      aria-label={`${m === 'ctrl' ? 'Ctrl' : 'Alt'} (한 번)${st.mods[m] ? ' — 켜짐' : ''}`}
      aria-pressed={st.mods[m]}
      {...press(() => controller.toggleMod(m))}
    >
      {m}
    </button>
  );

  const noSessions = st.connected && !chips.length;
  // 채팅 보기 — 보는 세션이 있고 채팅을 골랐을 때. xterm 은 숨기기만 한다(attach·스크롤백 유지)
  const chatView = !!attached && st.view === 'chat';
  const chatItems = st.chat.id === attached?.id ? st.chat : null;
  const showTerminal = useCallback(() => controller.setView('term'), []);
  const sendChat = useCallback((text: string) => controller.sendChat(text), []);
  const sendChatKey = useCallback((data: string) => controller.sendChatKey(data), []);

  return (
    <div className={`moterm${active ? '' : ' moterm--hidden'}`} aria-hidden={!active}>
      {/* 상단 — 작업 영역 · 검색 · 세션 메뉴 · 연결 점 */}
      <header className="moterm__top">
        <button
          type="button"
          className="moterm__scope"
          aria-label="작업 영역 고르기"
          disabled={!st.connected}
          onClick={() => {
            controller.refreshWorkspaces();
            setSheet('workspace');
          }}
        >
          {head ? (
            <Tile name={head.name} color={head.color} dim={!st.connected} />
          ) : (
            <span className="moterm__tile moterm__tile--all" aria-hidden="true">
              <Icon name="terminal" size={14} />
            </span>
          )}
          <span className="moterm__scope-text">
            <span className="moterm__scope-name">{head?.name ?? '전체 세션'}</span>
            {head?.sub && <span className="moterm__scope-sub">{head.sub}</span>}
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
        {attached && (
          <div className="moterm__view" role="group" aria-label="보기 방식">
            <button
              type="button"
              className={`moterm__view-btn${chatView ? ' moterm__view-btn--on' : ''}`}
              aria-pressed={chatView}
              onClick={() => {
                if (chatView) return;
                controller.clearSearch();
                setSearchOpen(false);
                controller.setView('chat');
              }}
            >
              채팅
            </button>
            <button
              type="button"
              className={`moterm__view-btn${chatView ? '' : ' moterm__view-btn--on'}`}
              aria-pressed={!chatView}
              onClick={() => chatView && controller.setView('term')}
            >
              터미널
            </button>
          </div>
        )}
        {/* 검색은 xterm 스크롤백 대상 — 채팅 보기에선 뺀다 */}
        {!chatView && (
          <button
            type="button"
            className={`moterm__icon-btn${searchOpen ? ' moterm__icon-btn--on' : ''}`}
            aria-label="스크롤백 검색"
            aria-pressed={searchOpen}
            disabled={!attached}
            onClick={() => {
              if (searchOpen) controller.clearSearch();
              setSearchOpen((v) => !v);
            }}
          >
            <Icon name="search" size={18} />
          </button>
        )}
        <button
          type="button"
          className="moterm__icon-btn"
          aria-label="세션 메뉴"
          onClick={() => setSheet('menu')}
        >
          <Icon name="more-horizontal" size={18} />
        </button>
        <span
          className={`moterm__conn${st.connected ? ' moterm__conn--on' : ''}`}
          role="img"
          aria-label={st.statusText}
        />
      </header>

      {!st.connected && (
        <div className="moterm__band" role="status">
          <Icon name="refresh" size={14} />
          <span>{st.statusText}</span>
        </div>
      )}

      {st.notifyBar && (
        <div className="moterm__notify">
          <Icon name="bell" size={14} />
          <span className="moterm__notify-text">자리를 비운 동안 입력 대기를 폰 알림으로 받기</span>
          <button type="button" className="moterm__btn moterm__btn--primary" onClick={() => controller.requestNotify()}>
            허용
          </button>
          <button type="button" className="moterm__btn moterm__btn--ghost" onClick={() => controller.dismissNotifyBar()}>
            나중에
          </button>
        </div>
      )}

      {/* 세션 칩 — 드롭다운 대신 한 줄 가로 스크롤. 대기 = 주황 점 · 작업 중 = 초록 링 */}
      <div className={`moterm__chips${st.connected ? '' : ' moterm__chips--off'}`} role="tablist" aria-label="세션">
        {chips.map((s) => {
          const status = statusOf(s);
          const on = s.id === st.attachedId;
          const outside = st.scope && s.cwd !== st.scope.path;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={`${s.title}${status ? ` — ${STATUS_LABEL[status]}` : ''}${outside ? ' (다른 영역)' : ''}`}
              className={`moterm__chip${on ? ' moterm__chip--on' : ''}`}
              disabled={!st.connected}
              onClick={() => !on && controller.attach(s.id)}
            >
              {status && <span className={`moterm__dot moterm__dot--${status}`} aria-hidden="true" />}
              <span className="moterm__chip-name">{s.title}</span>
              {outside && <span className="moterm__chip-meta">다른 영역</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="moterm__chip-add"
          aria-label="새 세션"
          disabled={!st.connected}
          onClick={() => {
            controller.refreshNewSession();
            setSheet('new');
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      {searchOpen && !chatView && (
        <form
          className="moterm__search"
          onSubmit={(e) => {
            e.preventDefault();
            controller.findNext(query);
          }}
        >
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            className="moterm__search-input"
            type="search"
            value={query}
            placeholder="스크롤백 검색"
            aria-label="스크롤백 검색어"
            autoComplete="off"
            autoCapitalize="none"
            onChange={(e) => {
              setQuery(e.target.value);
              if (e.target.value) controller.findNext(e.target.value);
              else controller.clearSearch();
            }}
          />
          <button type="button" className="moterm__icon-btn" aria-label="이전 일치" onClick={() => controller.findPrev(query)}>
            <Icon name="chevron-up" size={16} />
          </button>
          <button type="submit" className="moterm__icon-btn" aria-label="다음 일치">
            <Icon name="chevron-down" size={16} />
          </button>
          <button
            type="button"
            className="moterm__icon-btn"
            aria-label="검색 닫기"
            onClick={() => {
              controller.clearSearch();
              setSearchOpen(false);
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </form>
      )}

      {/* 터미널 — 탭은 읽기(키보드를 열지 않는다). 선택 모드에선 드래그가 줄 선택 */}
      {chatView && (
        <MoChatView
          items={chatItems?.items ?? []}
          loaded={chatItems?.loaded ?? false}
          unavailable={chatItems?.unavailable ?? null}
          fresh={chatItems?.fresh ?? false}
          prompt={chatItems?.prompt ?? null}
          busy={!!attached && (attached.working || attached.status === 'busy')}
          onSend={sendChat}
          onKey={sendChatKey}
          onShowTerminal={showTerminal}
        />
      )}

      {/* ⚠️ 채팅 보기에서도 언마운트하지 않는다 — xterm 인스턴스·attach 를 그대로 두고 숨기기만(display:none).
          숨은(폭 0) 호스트는 controller.refit 이 건너뛴다 */}
      <div
        className={`moterm__term${st.connected ? '' : ' moterm__term--off'}${chatView ? ' moterm__term--hidden' : ''}`}
      >
        <div ref={hostRef} className="moterm__host" />
        {st.scrolledUp && (
          <button
            type="button"
            className="moterm__to-bottom"
            {...press(() => controller.scrollToBottom())}
          >
            <Icon name="arrow-down-to-line" size={14} />
            맨 아래로
          </button>
        )}
        {st.fontHud !== null && (
          <span className="moterm__hud" role="status">
            {st.fontHud}px{st.fontHud <= FONT_MIN ? ' (최소)' : st.fontHud >= FONT_MAX ? ' (최대)' : ''}
          </span>
        )}
        {noSessions && (
          <div className="moterm__empty">
            <span className="moterm__empty-icon" aria-hidden="true">
              <Icon name="terminal" size={20} />
            </span>
            <span className="moterm__empty-title">
              {st.scope ? '이 작업 영역에 세션이 없습니다' : '세션이 없습니다'}
            </span>
            <span className="moterm__empty-hint">셸이나 프리셋으로 새 세션을 시작하세요.</span>
            <button
              type="button"
              className="moterm__btn moterm__btn--primary moterm__btn--lg"
              onClick={() => {
                controller.refreshNewSession();
                setSheet('new');
              }}
            >
              <Icon name="plus" size={16} />새 세션
            </button>
          </div>
        )}
      </div>

      {/* 키 바 — 키보드 없이도 1단 고정 · 키보드가 뜨면 2단 · 선택 모드면 복사 바 */}
      {chatView ? null : st.selecting ? (
        <div className="moterm__keybar moterm__keybar--select">
          <span className="moterm__select-info">
            {st.selectedLines ? `${st.selectedLines}줄 선택됨` : '복사할 줄을 끌어서 고르세요'}
          </span>
          <button type="button" className="moterm__btn moterm__btn--ghost" onClick={() => controller.setSelecting(false)}>
            취소
          </button>
          <button
            type="button"
            className="moterm__btn moterm__btn--primary"
            disabled={!st.selectedLines}
            onClick={() => void doCopy()}
          >
            <Icon name="copy" size={14} />
            복사
          </button>
        </div>
      ) : st.kbdOpen ? (
        <div className="moterm__keybar moterm__keybar--two">
          <div className="moterm__keyrow">
            {key('esc', 'esc', 'Escape')}
            {key('tab', 'tab', 'Tab')}
            {key('shift-tab', '⇧tab', 'Shift+Tab')}
            {mod('ctrl')}
            {mod('alt')}
            {key('up', '↑', '위')}
            {key('down', '↓', '아래')}
            {key('left', '←', '왼쪽')}
            {key('right', '→', '오른쪽')}
            <button
              type="button"
              className="moterm__kbd-btn moterm__kbd-btn--on"
              aria-label="키보드 닫기"
              {...press(() => controller.closeKeyboard())}
            >
              <Icon name="keyboard-off" size={18} />
            </button>
          </div>
          <div className="moterm__keyrow">
            {key('pipe', '|', '세로 막대')}
            {key('tilde', '~', '물결')}
            {key('slash', '/', '슬래시')}
            {key('dash', '-', '하이픈')}
            {key('home', 'home', 'Home')}
            {key('end', 'end', 'End')}
            {key('pgup', 'pgup', 'Page Up')}
            {key('pgdn', 'pgdn', 'Page Down')}
            {key('ctrl-c', '^C', 'Ctrl+C')}
            {key('enter', '⏎', 'Enter')}
          </div>
        </div>
      ) : (
        <div className="moterm__keybar">
          <div className="moterm__keyrow">
            {key('esc', 'esc', 'Escape')}
            {key('tab', 'tab', 'Tab')}
            {mod('ctrl')}
            {key('up', '↑', '위')}
            {key('down', '↓', '아래')}
            {key('left', '←', '왼쪽')}
            {key('right', '→', '오른쪽')}
            {key('enter', '⏎', 'Enter')}
            <button
              type="button"
              className="moterm__kbd-btn"
              aria-label="키보드 열기"
              disabled={!attached}
              onClick={() => controller.openKeyboard()}
            >
              <Icon name="keyboard" size={18} />
            </button>
          </div>
        </div>
      )}

      {sheet === 'menu' && (
        <MenuSheet
          attached={attached}
          onClose={closeSheet}
          onGoChanges={() => {
            setSheet(null);
            onGoTab('changes');
          }}
          onKill={() => void killAttached()}
          onNextWaiting={
            st.waiting.length
              ? () => {
                  setSheet(null);
                  controller.nextWaiting();
                }
              : undefined
          }
        />
      )}
      {sheet === 'workspace' && <WorkspaceSheet onClose={closeSheet} />}
      {sheet === 'new' && (
        <NewSessionSheet
          onClose={closeSheet}
          onChangeScope={() => {
            controller.refreshWorkspaces();
            setSheet('workspace');
          }}
        />
      )}
    </div>
  );
}

// ── 세션 메뉴 ──

function MenuSheet({
  attached,
  onClose,
  onGoChanges,
  onKill,
  onNextWaiting,
}: {
  attached: TerminalSessionInfo | undefined;
  onClose: () => void;
  onGoChanges: () => void;
  onKill: () => void;
  onNextWaiting?: () => void;
}) {
  const st = useTermState();
  const chat = !!attached && st.view === 'chat'; // 출력 선택·붙여넣기는 xterm 대상이다
  const status = attached ? statusOf(attached) : null;
  const where = attached ? (attached.projectName ?? lastSeg(attached.cwd)) : '';
  const row = (icon: IconName, label: string, onClick: () => void, opts: { disabled?: boolean; sub?: string; danger?: boolean; chevron?: boolean } = {}) => (
    <button
      type="button"
      className={`moterm__menu-row${opts.danger ? ' moterm__menu-row--danger' : ''}`}
      disabled={opts.disabled}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
      <span className="moterm__menu-label">
        <span>{label}</span>
        {opts.sub && <span className="moterm__menu-sub">{opts.sub}</span>}
      </span>
      {opts.chevron && <Icon name="chevron-right" size={14} />}
    </button>
  );
  return (
    <Sheet
      title="세션 메뉴"
      onClose={onClose}
      head={
        <span className="moterm__menu-head">
          {status && <span className={`moterm__dot moterm__dot--${status}`} aria-hidden="true" />}
          <span className="moterm__menu-head-text">
            <span className="moterm__menu-title">{attached?.title ?? '열린 세션 없음'}</span>
            {attached && (
              <span className="moterm__menu-sub">
                {status ? `${STATUS_LABEL[status]} · ` : ''}
                {where}
              </span>
            )}
          </span>
        </span>
      }
    >
      <div className="moterm__menu">
        {onNextWaiting &&
          row('bell', `다음 입력 대기 세션 (${st.waiting.length})`, onNextWaiting)}
        {row(
          'copy',
          '출력 선택해 복사',
          () => {
            onClose();
            controller.setSelecting(true);
          },
          { disabled: !attached || chat, sub: chat ? '터미널 보기에서 쓸 수 있습니다' : undefined, chevron: true },
        )}
        {row(
          'clipboard',
          '붙여넣기',
          () => {
            onClose();
            void controller.paste();
          },
          {
            disabled: !attached || !st.canPaste || chat,
            sub: chat ? '터미널 보기에서 쓸 수 있습니다' : st.canPaste ? undefined : 'HTTPS 접속에서만 됩니다',
          },
        )}
        <div className="moterm__menu-row moterm__menu-row--static">
          <Icon name="type" size={18} />
          <span className="moterm__menu-label">글자 크기</span>
          <span className="moterm__font">
            <button
              type="button"
              className="moterm__font-btn"
              aria-label="글자 작게"
              disabled={st.fontSize <= FONT_MIN}
              onClick={() => controller.setFontSize(st.fontSize - 1)}
            >
              A−
            </button>
            <span className="moterm__font-val">{st.fontSize}px</span>
            <button
              type="button"
              className="moterm__font-btn"
              aria-label="글자 크게"
              disabled={st.fontSize >= FONT_MAX}
              onClick={() => controller.setFontSize(st.fontSize + 1)}
            >
              A+
            </button>
          </span>
        </div>
        {row('git-branch', '변경사항 보기', onGoChanges, { chevron: true })}
        {st.notifySupported && (
          <div className="moterm__menu-row moterm__menu-row--static">
            <Icon name="bell" size={18} />
            <span className="moterm__menu-label">
              <span>입력 대기 알림</span>
              <span className="moterm__menu-sub">
                {st.notifyGranted ? '켜짐 — 끄려면 브라우저 사이트 설정에서' : '자리를 비운 동안 폰 알림으로 받기'}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={st.notifyGranted}
              aria-label="입력 대기 알림"
              className={`moterm__switch${st.notifyGranted ? ' moterm__switch--on' : ''}`}
              // 권한은 페이지가 회수할 수 없다 — 켜기만 하고, 끄기는 브라우저 설정 안내
              disabled={st.notifyGranted}
              onClick={() => controller.requestNotify()}
            />
          </div>
        )}
        <span className="moterm__menu-divider" />
        {row('power', '세션 종료', onKill, { disabled: !attached, danger: true })}
      </div>
    </Sheet>
  );
}

// ── 작업 영역 시트 ──

function WorkspaceSheet({ onClose }: { onClose: () => void }) {
  const st = useTermState();
  const countAt = (paths: Set<string>) => st.sessions.filter((s) => paths.has(s.cwd)).length;
  const waitAt = (paths: Set<string>) =>
    st.sessions.some((s) => paths.has(s.cwd) && st.waiting.includes(s.id));

  const pick = (ws: TermWorkspaceNode, wt: TermWorkspaceNode['worktrees'][number]) => {
    const scope: MoScope = {
      wsId: ws.id,
      wsName: ws.name,
      wsColor: ws.color,
      path: wt.path,
      name: wt.name,
      branch: wt.branch,
    };
    controller.setScope(scope);
    onClose();
  };

  return (
    <Sheet title="작업 영역" onClose={onClose} tall>
      <div className="moterm__ws-list">
        <button
          type="button"
          className={`moterm__ws-all${st.scope ? '' : ' moterm__ws-all--on'}`}
          onClick={() => {
            controller.setScope(null);
            onClose();
          }}
        >
          <Icon name="terminal" size={18} />
          <span className="moterm__ws-all-label">
            전체 세션 보기
            {st.scope && <span className="moterm__menu-sub">작업 영역 해제</span>}
          </span>
          <span className="moterm__count-text">
            세션 <span className="moterm__num">{st.sessions.length}</span>
          </span>
        </button>
        <span className="moterm__menu-divider" />
        {!st.workspaces.length && (
          <p className="moterm__sheet-empty">워크스페이스가 없습니다 — 데스크톱에서 저장소를 등록하세요.</p>
        )}
        {st.workspaces.map((ws) => {
          // 지금 고른 영역이 속한 레포는 자동으로 펼친다 — 다시 열었을 때 어디였는지 보이게
          const open = st.expandedWs.includes(ws.id) || st.scope?.wsId === ws.id;
          const paths = new Set(ws.worktrees.map((w) => w.path));
          return (
            <div key={ws.id} className="moterm__ws-group">
              <button
                type="button"
                className="moterm__ws-head"
                aria-expanded={open}
                aria-label={`${ws.name} 워크스페이스 — 워크트리 ${open ? '접기' : '펼치기'}`}
                onClick={() => controller.toggleWs(ws.id)}
              >
                <span className={`moterm__chev${open ? ' moterm__chev--open' : ''}`}>
                  <Icon name="chevron-right" size={14} />
                </span>
                <Tile name={ws.name} color={ws.color} />
                <span className="moterm__ws-name">{ws.name}</span>
                {waitAt(paths) && <span className="moterm__dot moterm__dot--wait" aria-label="입력 대기" />}
                <span className="moterm__count-text">
                  세션 <span className="moterm__num">{countAt(paths)}</span>
                </span>
              </button>
              {open && (
                <div className="moterm__wt-list">
                  {!ws.worktrees.length && <p className="moterm__sheet-empty">워크트리가 없습니다</p>}
                  {ws.worktrees.map((wt) => {
                    const on = st.scope?.path === wt.path;
                    const one = new Set([wt.path]);
                    return (
                      <button
                        key={wt.path}
                        type="button"
                        className={`moterm__wt${on ? ' moterm__wt--on' : ''}`}
                        aria-current={on ? 'true' : undefined}
                        onClick={() => pick(ws, wt)}
                      >
                        <Icon name={wt.isMain ? 'folder' : 'git-branch'} size={16} />
                        <span className="moterm__wt-text">
                          <span className="moterm__wt-name">{wt.name}</span>
                          {wt.branch && <span className="moterm__wt-branch">{wt.branch}</span>}
                        </span>
                        {waitAt(one) && <span className="moterm__dot moterm__dot--wait" aria-label="입력 대기" />}
                        <span className="moterm__count-text">
                          세션 <span className="moterm__num">{countAt(one)}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

// ── 새 세션 시트 — 위치 → 무엇으로(셸 + 프리셋) ──
// 작업 영역이 잡혀 있으면 위치는 정해졌다 — 위치 칸은 카드로만 보이고 [바꾸기]로 작업 영역 시트를 연다.
// 영역이 없으면 위치(홈 · 프로젝트)를 먼저 고른다.

function NewSessionSheet({ onClose, onChangeScope }: { onClose: () => void; onChangeScope: () => void }) {
  const st = useTermState();
  const [cwd, setCwd] = useState<string | undefined | null>(st.scope ? st.scope.path : null);
  const picked = cwd !== null;
  // ⚠️ 위치를 직접 고른 경우엔 워크스페이스를 알 수 없어 전역 프리셋만 나온다 — 레포 전용 프리셋을
  //    쓰려면 작업 영역을 고르면 된다(옛 페이지와 같은 판정 — shared/types presetsForWorkspace)
  const wsId = st.scope && st.scope.path === cwd ? st.scope.wsId : null;
  const presets = presetsForWorkspace(st.presets, wsId);
  const start = (p?: TerminalPreset) => {
    controller.create(cwd ?? undefined, p);
    onClose();
  };
  const cwdLabel =
    cwd === undefined ? '홈 디렉터리' : (st.cwds.find((o) => o.path === cwd)?.name ?? (cwd ? lastSeg(cwd) : ''));

  return (
    <Sheet title="새 세션" onClose={onClose}>
      <div className="moterm__new">
        <span className="moterm__label">위치</span>
        {st.scope ? (
          <div className="moterm__where">
            <Tile name={st.scope.wsName} color={st.scope.wsColor} />
            <span className="moterm__where-text">
              <span className="moterm__where-name">
                {st.scope.wsName} · {st.scope.name}
              </span>
              <span className="moterm__where-path">{st.scope.path}</span>
            </span>
            <button type="button" className="moterm__btn moterm__btn--ghost" onClick={onChangeScope}>
              바꾸기
            </button>
          </div>
        ) : picked ? (
          <div className="moterm__where">
            <span className="moterm__tile moterm__tile--all" aria-hidden="true">
              <Icon name="folder" size={14} />
            </span>
            <span className="moterm__where-text">
              <span className="moterm__where-name">{cwdLabel}</span>
              {cwd && <span className="moterm__where-path">{cwd}</span>}
            </span>
            <button type="button" className="moterm__btn moterm__btn--ghost" onClick={() => setCwd(null)}>
              바꾸기
            </button>
          </div>
        ) : (
          <div className="moterm__pick-list">
            <button type="button" className="moterm__pick" onClick={() => setCwd(undefined)}>
              <span className="moterm__pick-box"><Icon name="home" size={16} /></span>
              <span className="moterm__pick-text">
                <span className="moterm__pick-name">홈 디렉터리</span>
              </span>
              <Icon name="chevron-right" size={14} />
            </button>
            {st.cwds.map((o) => (
              <button key={o.path} type="button" className="moterm__pick" onClick={() => setCwd(o.path)}>
                <span className="moterm__pick-box"><Icon name="folder" size={16} /></span>
                <span className="moterm__pick-text">
                  <span className="moterm__pick-name">{o.name}</span>
                  <span className="moterm__pick-mono">{o.path}</span>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
            ))}
          </div>
        )}

        {picked && (
          <>
            <span className="moterm__label moterm__label--gap">무엇으로 시작할까요</span>
            <div className="moterm__pick-list">
              <button type="button" className="moterm__pick" onClick={() => start()}>
                <span className="moterm__pick-box"><Icon name="terminal" size={16} /></span>
                <span className="moterm__pick-text">
                  <span className="moterm__pick-name">셸</span>
                  <span className="moterm__pick-sub">자동 실행 없음</span>
                </span>
                <Icon name="chevron-right" size={14} />
              </button>
              {presets.map((p) => (
                <button key={p.id} type="button" className="moterm__pick" onClick={() => start(p)}>
                  <span className="moterm__pick-box moterm__pick-box--accent"><Icon name="play" size={16} /></span>
                  <span className="moterm__pick-text">
                    <span className="moterm__pick-name">{p.name}</span>
                    <span className="moterm__pick-mono">{p.command}</span>
                  </span>
                  <Icon name="chevron-right" size={14} />
                </button>
              ))}
            </div>
            <p className="moterm__sheet-hint">
              {presets.length
                ? '프리셋은 데스크톱 터미널의 프리셋 편집에서 추가합니다.'
                : st.presets.length
                  ? '이 위치에 노출된 프리셋이 없습니다 — 작업 영역을 고르면 그 레포 프리셋이 보입니다.'
                  : '프리셋이 없습니다 — 데스크톱 터미널의 프리셋 편집에서 추가하세요.'}
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}
