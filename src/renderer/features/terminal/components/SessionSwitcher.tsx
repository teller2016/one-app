// ⌘⇧P Claude 세션 빠른 전환 — 모든 워크스페이스에서 claude 가 떠 있는 세션을 한 목록으로 보고,
// 고르면 그 세션 터미널로 간다(토스트 [이동]과 같은 `openTerminalSession` — 팝아웃 창에 있으면 그 창이 앞으로).
//
// 데이터는 main `overview.ts`(작업 제목 = claude 가 붙인 ai-title · 첫/마지막 요청 · 위치)이고, 열린 동안만 몇 초마다
// 다시 읽는다(상태가 바뀌면 줄이 그룹을 옮긴다 — 선택은 공용 `Palette` 가 항목 key 로 따라간다).
// 앱 셸(App.tsx)이 어느 섹션에서든 조건부 렌더로 연다.
import { useCallback, useMemo, useState } from 'react';
import { relativeTime } from '../../../../shared/date';
import type { TerminalOverviewItem } from '../../../../shared/types';
import { Palette } from '../../../components/Palette';
import { StatusDot } from '../../../components/StatusDot';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';
import { usePolling } from '../../../lib/usePolling';

const REFRESH_MS = 3000;

/** 탭 점과 같은 기준 — 입력 대기 = 주황(wait) · 작업 중 = 초록(run, `working` — busy 는 한 프레임에도 켜진다) */
type Phase = 'wait' | 'run' | 'idle';
const PHASES: Phase[] = ['wait', 'run', 'idle'];
const PHASE_LABEL: Record<Phase, string> = {
  wait: '입력 대기',
  run: '작업 중',
  idle: '쉬는 중',
};
const phaseOf = (s: TerminalOverviewItem): Phase =>
  s.status === 'waiting' ? 'wait' : s.working ? 'run' : 'idle';

/** 큰 글씨 한 줄 — 작업 제목, 없으면 첫 요청, 그것도 없으면(첫 메시지 전) 탭 이름 */
const headline = (s: TerminalOverviewItem) => s.title ?? s.firstPrompt ?? s.tabTitle;

/** 공백으로 나눈 모든 조각이 들어 있으면 일치 (대소문자 무시) — ⌘P 팔레트와 같은 규칙 */
function matches(s: TerminalOverviewItem, q: string): boolean {
  if (!q) return true;
  const hay = [s.title, s.firstPrompt, s.lastPrompt, s.location, s.tabTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
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

  // 입력 대기 → 작업 중 → 쉬는 중, 같은 상태끼리는 최근 활동순
  const shown = useMemo(() => {
    const q = query.trim();
    const hit = (items ?? []).filter((s) => matches(s, q));
    return PHASES.flatMap((p) =>
      hit
        .filter((s) => phaseOf(s) === p)
        .sort((a, b) => b.activityAt - a.activityAt),
    );
  }, [items, query]);

  const empty =
    items === null
      ? (error ?? '불러오는 중…')
      : items.length === 0
        ? '실행 중인 Claude 세션이 없습니다'
        : '일치하는 세션이 없습니다';

  return (
    <Palette
      label="Claude 세션 전환"
      placeholder="Claude 세션 검색 — 작업 제목, 요청, 워크스페이스"
      query={query}
      onQueryChange={setQuery}
      items={shown}
      itemKey={(s) => s.id}
      itemGroup={(s) => PHASE_LABEL[phaseOf(s)]}
      itemClassName="palette__item--session"
      onRun={(s) => openTerminalSession({ sessionId: s.id, cwd: s.cwd })}
      onClose={onClose}
      empty={empty}
      runLabel="열기"
      renderItem={(s) => {
        const head = headline(s);
        const sub = s.lastPrompt && s.lastPrompt !== head ? s.lastPrompt : null;
        return (
          <>
            <span className="palette__icon">
              <StatusDot status={phaseOf(s)} md />
            </span>
            <span className="palette__body">
              <span className="palette__line">
                <span className="palette__label">{head}</span>
                <span className="palette__hint">{s.location ?? s.tabTitle}</span>
              </span>
              <span className="palette__line palette__line--sub">
                <span className="palette__sub">{sub}</span>
                <span className="palette__time">{relativeTime(s.activityAt)}</span>
              </span>
            </span>
          </>
        );
      }}
    />
  );
}
