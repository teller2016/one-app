import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Palette } from '../components/Palette';
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
 * ⌘P 명령 팔레트 — 섹션 이동 · 상태바 위젯 명령(출퇴근·VPN·메일·MO·미러링) · 배포 확인 모달 열기.
 *
 * 동작의 정본은 각 기능이다 — 위젯 명령은 `lib/commands` 등록소에서 모으고, 배포는
 * 확인 모달(PROD 이름 입력 포함)까지만 연다(실행은 모달에서 사용자가).
 * 오버레이·키 처리·포커스는 공용 `Palette` 셸. 부모가 조건부 렌더로 연다(열릴 때마다 입력이 비워진다).
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
  const [deployProjects, setDeployProjects] = useState<DeployProjectView[]>([]);

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

  const navIcon = useMemo(
    () =>
      new Map<string, ReactNode>(sections.map((s) => [`nav-${s.id}`, s.icon])),
    [sections],
  );

  return (
    <Palette
      label="이동 · 명령"
      placeholder="섹션 이동, 명령, 배포 대상 검색"
      query={query}
      onQueryChange={setQuery}
      items={shown}
      itemKey={(c) => c.id}
      itemGroup={(c) => c.group}
      onRun={(c) => c.run()}
      onClose={onClose}
      empty="일치하는 명령이 없습니다"
      renderItem={(c) => (
        <>
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
        </>
      )}
    />
  );
}
