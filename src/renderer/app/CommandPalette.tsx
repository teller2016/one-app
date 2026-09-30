import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { requestDeployConfirm } from '../features/deploy';
import {
  collectCommands,
  type Command,
  type CommandGroup,
} from '../lib/commands';
import type { DeployProjectView } from '../../shared/types';

/** 섹션 이동 명령의 재료 — App 의 SECTIONS 에서 필요한 것만 */
export type PaletteSection = {
  id: string;
  label: string;
  group?: string;
  icon: ReactNode;
};

const GROUP_ORDER: CommandGroup[] = ['이동', '명령', '배포'];

/** 공백으로 나눈 모든 조각이 들어 있으면 일치 (대소문자 무시) */
function matches(c: Command, q: string): boolean {
  if (!q) return true;
  const hay =
    `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

/**
 * ⌘K 명령 팔레트 — 섹션 이동 · 상태바 위젯 명령(출퇴근·VPN·메일·MO·미러링) · 배포 확인 모달 열기.
 *
 * 동작의 정본은 각 기능이다 — 위젯 명령은 `lib/commands` 등록소에서 모으고, 배포는
 * 확인 모달(PROD 이름 입력 포함)까지만 연다(실행은 모달에서 사용자가).
 * ↑↓ 이동 · ↵ 실행 · Esc 닫기. 부모가 조건부 렌더로 연다(열릴 때마다 입력이 비워진다).
 */
export function CommandPalette({
  sections,
  onNavigate,
  onClose,
}: {
  sections: PaletteSection[];
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [deployProjects, setDeployProjects] = useState<DeployProjectView[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 배포 대상은 열 때 한 번 가져온다 (토큰 값은 오지 않는 목록 조회)
  useEffect(() => {
    let alive = true;
    void window.oneApp?.deploy
      ?.getProjects()
      .then((list) => alive && setDeployProjects(list))
      .catch(() => {
        // 목록을 못 받아도 팔레트의 나머지 명령은 그대로 쓴다
      });
    return () => {
      alive = false;
    };
  }, []);

  // 닫을 때 원래 포커스로 돌려준다(터미널 pane 에서 열었으면 바로 이어 입력) — 단, 명령을
  // 실행해 닫았으면 돌려주지 않는다: 이동했거나 명령이 띄운 모달이 포커스를 가져간다
  const restoreRef = useRef(true);
  useEffect(() => {
    const prev = document.activeElement;
    return () => {
      if (restoreRef.current && prev instanceof HTMLElement && prev.isConnected)
        prev.focus();
    };
  }, []);

  // 포커스는 한 프레임 뒤에 — 여는 단축키의 keydown 이 끝나기 전에 옮기면 되돌아갈 수 있다
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // 섹션 이동·배포는 React 상태에서, 위젯 명령은 등록소에서 온다
  const fixed = useMemo<{ nav: Command[]; deploy: Command[] }>(
    () => ({
      nav: sections.map((s) => ({
        id: `nav-${s.id}`,
        group: '이동',
        label: s.label,
        hint: s.group,
        keywords: s.id,
        run: () => onNavigate(s.id),
      })),
      deploy: deployProjects.flatMap((p) =>
        p.targets.map((t) => ({
          id: `deploy-${p.id}-${t.id}`,
          group: '배포' as const,
          label: `${p.name} — ${t.name} 배포`,
          hint: p.production ? 'PROD' : t.jobPath,
          keywords: `deploy jenkins ${t.jobPath}`,
          icon: 'rocket' as const,
          run: () => requestDeployConfirm({ projectId: p.id, targetId: t.id }),
        })),
      ),
    }),
    [sections, deployProjects, onNavigate],
  );

  // 등록소는 React 상태가 아니다 — 입력이 바뀔 때마다 다시 모아, 그 사이 바뀐 위젯 상태
  // (연결됨/안 됨 등)가 명령에 반영되게 한다
  const shown = useMemo(() => {
    const q = query.trim();
    const hit = [...fixed.nav, ...collectCommands(), ...fixed.deploy].filter(
      (c) => matches(c, q),
    );
    return GROUP_ORDER.flatMap((g) => hit.filter((c) => c.group === g));
  }, [fixed, query]);

  const active = Math.min(index, Math.max(shown.length - 1, 0));
  const navIcon = useMemo(
    () =>
      new Map<string, ReactNode>(sections.map((s) => [`nav-${s.id}`, s.icon])),
    [sections],
  );

  // 선택 항목이 보이게 스크롤
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    // 첫 항목이면 맨 위까지 — 항목 기준 nearest 로는 위의 그룹 제목이 가려진 채 남는다
    if (active === 0 && listRef.current) listRef.current.scrollTop = 0;
  }, [active]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    restoreRef.current = false;
    onClose(); // 먼저 닫는다 — 명령이 띄우는 확인창·모달이 팔레트 뒤에 깔리지 않게
    c.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter·방향키는 IME 몫
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) =>
        shown.length ? (Math.min(i, shown.length - 1) + 1) % shown.length : 0,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) =>
        shown.length
          ? (Math.min(i, shown.length - 1) - 1 + shown.length) % shown.length
          : 0,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup: CommandGroup | null = null;
  return createPortal(
    <div
      className="palette-overlay"
      onPointerDown={(e) => {
        // ⚠️ preventDefault — 뒤따르는 mousedown 을 억제한다. 안 그러면 팔레트가 빠진 자리(body)로
        // mousedown 이 가서, 방금 돌려준 포커스(터미널 pane)를 다시 뺏는다(2026-09-30 /test)
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
    >
      {/* 키 처리는 팔레트 전체에서 받는다(입력창 이벤트가 버블링) — 그리고 입력창이 아닌 곳을
          눌러도 포커스가 입력창을 떠나지 않게 막는다. 안 그러면 푸터·그룹 제목 클릭 한 번에
          포커스가 body 로 빠져 ↑↓·↵·Esc 가 전부 먹통이 된다(2026-09-30 /test) */}
      <div
        className="palette"
        role="dialog"
        aria-label="이동 · 명령"
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="palette__search">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="섹션 이동, 명령, 배포 대상 검색"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            aria-label="명령 검색"
            aria-activedescendant={
              shown[active] ? `palette-${shown[active].id}` : undefined
            }
          />
        </div>
        <div className="palette__list" ref={listRef} role="listbox">
          {shown.length === 0 && (
            <p className="palette__empty">일치하는 명령이 없습니다</p>
          )}
          {shown.map((c, i) => {
            const head = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <div className="palette__group">{c.group}</div>}
                <button
                  type="button"
                  id={`palette-${c.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={
                    'palette__item' + (i === active ? ' palette__item--on' : '')
                  }
                  onPointerMove={() => i !== active && setIndex(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette__icon">
                    {navIcon.get(c.id) ??
                      (c.icon ? <Icon name={c.icon} size={14} /> : null)}
                  </span>
                  <span className="palette__label">{c.label}</span>
                  {c.hint && (
                    <span
                      className={
                        'palette__hint' +
                        (c.hint === 'PROD' ? ' palette__hint--prod' : '')
                      }
                    >
                      {c.hint}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span>
            <kbd className="palette__kbd">↑</kbd>
            <kbd className="palette__kbd">↓</kbd> 이동
          </span>
          <span>
            <kbd className="palette__kbd">↵</kbd> 실행
          </span>
          <span>
            <kbd className="palette__kbd">Esc</kbd> 닫기
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
