// ⌘⇧P Claude 세션 빠른 전환 — 모든 워크스페이스에서 claude 가 떠 있는 세션을 **저장소별로 묶어** 보고,
// 고르면 그 세션 터미널로 간다(토스트 [이동]과 같은 `openTerminalSession` — 팝아웃 창에 있으면 그 창이 앞으로).
// 2026-10-06 시안 C(저장소별 묶음 — 캔버스 'Claude 세션 전환 시안')를 사용자가 골랐다.
//
// 데이터는 main `overview.ts`(작업 제목 = claude 가 붙인 ai-title · 첫/마지막 요청 · 워크스페이스·브랜치)이고, 열린 동안만
// 몇 초마다 다시 읽는다(상태가 바뀌면 줄이 자리를 옮긴다 — 선택은 공용 `Palette` 가 항목 key 로 따라간다).
// 묶음·정렬·검색 규칙은 `lib/switcher.ts`. 앱 셸(App.tsx)이 어느 섹션에서든 조건부 렌더로 연다.
import { useCallback, useMemo, useState } from 'react';
import { relativeTime } from '../../../../shared/date';
import type { TerminalOverviewItem } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
import { Palette } from '../../../components/Palette';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';
import { usePolling } from '../../../lib/usePolling';
import {
  PHASES,
  PHASE_LABEL,
  groupSessions,
  headline,
  matches,
  phaseCounts,
  phaseOf,
  showBranch,
  type Phase,
  type SessionGroup,
} from '../lib/switcher';
import { initials, tileColor } from '../lib/workspace';

const REFRESH_MS = 3000;

/** 상태 → 공용 뱃지 색 (fresh = 연두 · busy = 주황 · ok = 초록 · idle = 회색 — 탭 점과 같은 색) */
const PHASE_BADGE: Record<Phase, 'fresh' | 'busy' | 'ok' | 'idle'> = {
  fresh: 'fresh',
  wait: 'busy',
  run: 'ok',
  idle: 'idle',
};

/** 저장소 머리 — LNB 와 같은 색 타일 + 이름 + 세션 수 */
function GroupHead({ group }: { group: SessionGroup }) {
  const ws = group.workspace;
  return (
    <>
      {ws ? (
        <span className={`terminal__ws-tile terminal__ws-tile--c${tileColor(ws)}`} aria-hidden="true">
          {initials(ws.name, 2)}
        </span>
      ) : (
        <span className="terminal__ws-tile" aria-hidden="true">
          <Icon name="folder" size={12} />
        </span>
      )}
      <span className="palette__ws-name">{ws?.name ?? '기타'}</span>
      <span className="palette__ws-count">세션 {group.sessions.length}</span>
    </>
  );
}

export function SessionSwitcher({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<TerminalOverviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const api = window.oneApp?.terminal?.overview;
    if (!api) {
      setError('앱을 다시 시작하면 쓸 수 있습니다');
      return;
    }
    api()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      // 실패하면 직전 목록을 그대로 둔다 — 처음부터 못 받았을 때만 문구로
      .catch((e: unknown) => setError(errMsg(e, '세션 현황을 불러오지 못했습니다')));
  }, []);
  usePolling(refresh, REFRESH_MS);

  // 저장소별 묶음을 한 줄 목록으로 편다 — 셸은 줄 단위로 ↑↓, 그룹 머리는 묶음의 첫 줄 위에
  const { shown, groupOf } = useMemo(() => {
    const q = query.trim();
    const groups = groupSessions((items ?? []).filter((s) => matches(s, q)));
    const groupOf = new Map<string, SessionGroup>();
    for (const g of groups) for (const s of g.sessions) groupOf.set(s.id, g);
    return { shown: groups.flatMap((g) => g.sessions), groupOf };
  }, [items, query]);

  const counts = useMemo(() => phaseCounts(items ?? []), [items]);

  const empty =
    items === null
      ? (error ?? '불러오는 중…')
      : items.length === 0
        ? '실행 중인 Claude 세션이 없습니다'
        : '일치하는 세션이 없습니다';

  return (
    <Palette
      label="Claude 세션 전환"
      placeholder="Claude 세션 검색 — 작업 제목, 요청, 저장소, 브랜치"
      className="palette--wide"
      query={query}
      onQueryChange={setQuery}
      searchAside={
        <span className="palette__counts">
          {PHASES.filter((p) => counts[p] > 0).map((p) => (
            <span key={p} className={`palette__count palette__count--${p}`}>
              {PHASE_LABEL[p]} {counts[p]}
            </span>
          ))}
        </span>
      }
      items={shown}
      itemKey={(s) => s.id}
      itemGroup={(s) => groupOf.get(s.id)?.key ?? ''}
      renderGroup={(s) => {
        const g = groupOf.get(s.id);
        return g ? <GroupHead group={g} /> : null;
      }}
      itemClassName="palette__item--session"
      onRun={(s) => openTerminalSession({ sessionId: s.id, cwd: s.cwd })}
      onClose={onClose}
      empty={empty}
      runLabel="열기"
      renderItem={(s) => {
        const phase = phaseOf(s);
        const head = headline(s);
        const sub = s.lastPrompt && s.lastPrompt !== head ? s.lastPrompt : null;
        return (
          <>
            <span className="palette__status">
              <Badge variant={PHASE_BADGE[phase]} dot={false}>
                {PHASE_LABEL[phase]}
              </Badge>
            </span>
            <span className="palette__body">
              <span className="palette__line">
                <span className="palette__label">{head}</span>
                {showBranch(s.branch) && <span className="palette__branch">{s.branch}</span>}
                <span className="palette__time">{relativeTime(s.activityAt)}</span>
              </span>
              {sub && <span className="palette__sub">{sub}</span>}
            </span>
          </>
        );
      }}
    />
  );
}
