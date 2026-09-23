// 포트 섹션 — 리스닝 중인 포트를 보고 필요하면 그 프로세스를 종료한다.
// "포트가 이미 사용 중" 이 떴을 때 lsof 로 찾아 kill 하던 일을 여기서 끝낸다.
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { RefreshButton } from '../../../components/RefreshButton';
import { SectionHeader } from '../../../components/SectionHeader';
import { Segment } from '../../../components/Segment';
import { Tooltip } from '../../../components/Tooltip';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { useAsync } from '../../../lib/useAsync';
import type { PortProcess } from '../../../../shared/types';

/** 홈 경로를 `~` 로 줄여 표시 — 목록에서 경로가 길면 정작 포트가 안 보인다 */
function shortPath(p: string): string {
  const home = '/Users/';
  if (!p.startsWith(home)) return p;
  const rest = p.slice(home.length);
  const slash = rest.indexOf('/');
  return slash < 0 ? '~' : `~${rest.slice(slash)}`;
}

export function PortsSection() {
  const [query, setQuery] = useState('');
  // 기본은 '개발' — 언어 서버·IDE 헬퍼·시스템 데몬까지 다 보이면 정작 내 서버를 못 찾는다
  const [scope, setScope] = useState<'dev' | 'all'>('dev');
  const [busyPid, setBusyPid] = useState(0);
  const toast = useToast();
  const confirm = useConfirm();

  // ⚠️ useCallback 으로 안정화 — 인라인 화살표를 넘기면 매 렌더마다 재조회한다
  const fetchPorts = useCallback(async () => {
    const api = window.oneApp?.ports;
    if (!api) throw new Error('앱을 다시 시작해야 포트 기능을 쓸 수 있습니다.');
    return api.list();
  }, []);
  const { data, loading, error, reload } = useAsync(fetchPorts);

  const entries = useMemo(() => data ?? [], [data]);
  const devCount = useMemo(() => entries.filter((e) => e.dev).length, [entries]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // ⚠️ 검색은 **전체**를 대상으로 한다 — '개발' 필터에 가려진 것도 포트 번호로 찾을 수 있어야 한다
    const base = q || scope === 'all' ? entries : entries.filter((e) => e.dev);
    if (!q) return base;
    return base.filter(
      (e) =>
        e.ports.some((p) => String(p).includes(q)) ||
        e.command.toLowerCase().includes(q) ||
        e.projectName.toLowerCase().includes(q) ||
        String(e.pid).includes(q),
    );
  }, [entries, query, scope]);

  /** 종료 — 보호 대상은 한 번 더 확인하고, SIGTERM 으로 안 죽으면 강제 종료를 잇는다 */
  const kill = async (e: PortProcess) => {
    if (e.guarded) {
      const ok = await confirm({
        title: `${e.command} 을(를) 종료할까요?`,
        message:
          'macOS 구성요소이거나 시스템이 쓰는 프로세스입니다. 종료하면 관련 기능이 멈출 수 있습니다.',
        confirmLabel: '종료',
        danger: true,
      });
      if (!ok) return;
    }
    setBusyPid(e.pid);
    try {
      const res = await window.oneApp!.ports!.kill(e.pid, false);
      if (res.ok) {
        toast(`${e.ports.join(', ')} 포트를 정리했습니다 (${e.command})`, 'ok');
        await reload();
        return;
      }
      if (!res.alive) {
        toast(res.message, 'fail');
        return;
      }
      // SIGTERM 을 무시했다 — 강제 종료를 물어본다
      const force = await confirm({
        title: '강제 종료할까요?',
        message: `${e.command}(${e.pid}) 이(가) 종료 신호를 무시했습니다. 강제 종료하면 저장하지 않은 작업이 사라질 수 있습니다.`,
        confirmLabel: '강제 종료',
        danger: true,
      });
      if (!force) return;
      const forced = await window.oneApp!.ports!.kill(e.pid, true);
      toast(forced.message, forced.ok ? 'ok' : 'fail');
      await reload();
    } catch (err) {
      toast(errMsg(err, '종료하지 못했습니다.'), 'fail');
    } finally {
      setBusyPid(0);
    }
  };

  return (
    <div className="section ports">
      <SectionHeader
        icon={<Icon name="network" size={18} />}
        title="포트"
        sub="리스닝 중인 포트를 확인하고, 자리를 차지한 프로세스를 바로 종료합니다."
      />

      {error && <Banner variant="warning">{error}</Banner>}

      <div className="ports__toolbar">
        <Input
          small
          className="ports__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="포트 번호 · 프로세스 · 프로젝트로 검색 (예: 3000)"
          aria-label="포트 검색"
        />
        {/*
          개수는 세그먼트 라벨 안에 둔다 — 예전엔 옆에 '9개 · 15 숨김' 을 따로 적었는데,
          필터·검색에 따라 **문구 길이가 변해 새로고침 버튼이 좌우로 밀렸다**(사용자 지적).
          여기 숫자는 검색과 무관한 전체 기준이라 자릿수가 바뀌지 않는 한 자리가 고정된다.
        */}
        <Segment
          options={[
            { value: 'dev', label: <>개발 <span className="ports__n">{devCount}</span></> },
            { value: 'all', label: <>전체 <span className="ports__n">{entries.length}</span></> },
          ]}
          value={scope}
          onChange={(v) => setScope(v as 'dev' | 'all')}
        />
        <RefreshButton
          bordered
          spinning={loading}
          onClick={() => void reload()}
          aria-label="포트 목록 새로고침"
        />
      </div>

      {!loading && filtered.length === 0 ? (
        <EmptyState
          icon="network"
          message={query ? '검색 결과가 없습니다' : '리스닝 중인 개발 서버가 없습니다'}
          hint={
            query
              ? '포트 번호나 프로세스 이름으로 찾아보세요.'
              : scope === 'dev' && entries.length > 0
                ? `[전체] 로 바꾸면 ${entries.length}개가 보입니다.`
                : undefined
          }
        />
      ) : (
        <ul className="ports__list">
          {filtered.map((e) => (
            <li key={e.pid} className="ports__row">
              <div className="ports__main">
                <div className="ports__title">
                  <span className="ports__cmd">{e.command}</span>
                  <span className="ports__pid">PID {e.pid}</span>
                  {e.projectName && <Badge variant="pill">{e.projectName}</Badge>}
                  {e.guarded && (
                    <Tooltip label="macOS 구성요소이거나 시스템 소유입니다">
                      <span className="ports__guard">
                        <Icon name="lock" size={12} />
                      </span>
                    </Tooltip>
                  )}
                </div>
                <div className="ports__ports">
                  {e.ports.map((port) => (
                    <span key={port} className="ports__chip">
                      {port}
                    </span>
                  ))}
                  {e.cwd && e.cwd !== '/' && (
                    <span className="ports__cwd" title={e.cwd}>
                      {shortPath(e.cwd)}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant={e.guarded ? 'ghost' : 'danger'}
                loading={busyPid === e.pid}
                disabled={busyPid !== 0}
                onClick={() => void kill(e)}
              >
                종료
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
