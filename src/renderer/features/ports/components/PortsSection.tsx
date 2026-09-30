// 포트 섹션 — 리스닝 중인 포트를 보고 필요하면 그 프로세스를 종료한다.
// "포트가 이미 사용 중" 이 떴을 때 lsof 로 찾아 kill 하던 일을 여기서 끝낸다.
import { useCallback, useMemo, useState } from 'react';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { Segment } from '../../../components/Segment';
import { TopbarSlot } from '../../../components/TopbarSlot';
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
  const devCount = useMemo(
    () => entries.filter((e) => e.dev).length,
    [entries],
  );
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
      const res = await window.oneApp!.ports!.kill(e.pid, false, e.command);
      if (res.ok) {
        toast(`${e.ports.join(', ')} 포트를 정리했습니다 (${e.command})`, 'ok');
        await reload();
        return;
      }
      if (!res.alive) {
        // 이미 종료됐거나 대상이 바뀌었다(PID 재사용) — 옛 목록을 보고 또 누르지 않게 새로 불러온다
        toast(res.message, 'fail');
        await reload();
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
      const forced = await window.oneApp!.ports!.kill(e.pid, true, e.command);
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
      {/*
        탑바(목업 Ports.dc.html) — 경로 옆 '개발 | 전체' 세그먼트, 오른쪽 끝 검색·새로고침.
        개수는 세그먼트 라벨 안에 둔다 — 예전엔 옆에 '9개 · 15 숨김' 을 따로 적었는데,
        필터·검색에 따라 **문구 길이가 변해 새로고침 버튼이 좌우로 밀렸다**(사용자 지적).
        여기 숫자는 검색과 무관한 전체 기준이라 자릿수가 바뀌지 않는 한 자리가 고정된다.
      */}
      <TopbarSlot
        left={
          <Segment
            options={[
              {
                value: 'dev',
                label: (
                  <>
                    개발 <span className="ports__n">{devCount}</span>
                  </>
                ),
              },
              {
                value: 'all',
                label: (
                  <>
                    전체 <span className="ports__n">{entries.length}</span>
                  </>
                ),
              },
            ]}
            value={scope}
            onChange={(v) => setScope(v as 'dev' | 'all')}
          />
        }
        right={
          <>
            <label className="ports__search">
              <Icon name="search" size={14} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="포트 번호 · 프로세스 · 프로젝트로 검색 (예: 3000)"
                aria-label="포트 검색"
              />
            </label>
            <RefreshButton
              bordered
              size={14}
              spinning={loading}
              onClick={() => void reload()}
              aria-label="포트 목록 새로고침"
            />
          </>
        }
      />

      <div className="ports__body">
        {error && <Banner variant="warning">{error}</Banner>}

        {!loading && filtered.length === 0 ? (
          <EmptyState
            icon="network"
            message={
              query
                ? '검색 결과가 없습니다'
                : '리스닝 중인 개발 서버가 없습니다'
            }
            hint={
              query
                ? '포트 번호나 프로세스 이름으로 찾아보세요.'
                : scope === 'dev' && entries.length > 0
                  ? `[전체] 로 바꾸면 ${entries.length}개가 보입니다.`
                  : undefined
            }
          />
        ) : (
          // 목업: 패널 면 안의 표 — 열 포트 190 · 프로세스 150 · PID 100 · 프로젝트 130 · 작업 경로 · 동작 100.
          // 패널만 안에서 스크롤한다(머리 줄 sticky) — .main 에 스크롤바가 생기면 툴바가 밀린다(아래 SCSS)
          <div className="ports__panel">
            <table className="ports__table">
              <thead>
                <tr>
                  <th className="ports__col-ports">포트</th>
                  <th className="ports__col-proc">프로세스</th>
                  <th className="ports__col-pid">PID</th>
                  <th className="ports__col-proj">프로젝트</th>
                  <th>작업 경로</th>
                  <th className="ports__col-act" aria-label="동작" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.pid} className="ports__row">
                    <td>
                      <span className="ports__ports">
                        {e.ports.map((port) => (
                          <span key={port} className="ports__chip">
                            {port}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="ports__proc">
                        <span className="ports__cmd">{e.command}</span>
                        {e.guarded && (
                          <Tooltip label="macOS 구성요소이거나 시스템 소유입니다">
                            <span className="ports__guard">
                              <Icon name="lock" size={12} />
                            </span>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    <td className="ports__pid">PID {e.pid}</td>
                    <td>
                      {e.projectName && (
                        <Badge variant="accent">{e.projectName}</Badge>
                      )}
                    </td>
                    <td className="ports__cwd" title={e.cwd || undefined}>
                      {e.cwd && e.cwd !== '/' ? shortPath(e.cwd) : ''}
                    </td>
                    <td className="ports__act">
                      <Button
                        size="xs"
                        variant={e.guarded ? 'plain' : 'danger'}
                        loading={busyPid === e.pid}
                        disabled={busyPid !== 0}
                        onClick={() => void kill(e)}
                      >
                        종료
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
