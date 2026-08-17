// Jira 티켓 [작업] — 시작할 위치를 고르고 femc 세션으로 넘긴다.
//
// 위치 목록은 터미널 LNB 와 같은 문법(저장소 그룹 → 워크트리 행)이고, Jira 프로젝트 키와
// 이어진 저장소를 맨 위로 올려 기본 선택한다(프로젝트 레지스트리의 jiraProjectKey).
// 티켓 본문·첨부 수집과 명령 조립은 main(`jira:prepare-work`)이 하고, 여기서는 그 결과를
// 그대로 터미널에 넘긴다 — ⚠️ command 문자열을 렌더러에서 손대지 말 것(셸 인용 파손).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  JiraWorkAccount,
  JiraWorkAccountInfo,
  JiraWorkSkill,
  Project,
  TerminalSessionInfo,
  TerminalWorkspace,
  WorktreeInfo,
} from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { FormRow } from '../../../components/FormRow';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { openTerminalSession } from '../../../lib/sectionNav';
import { worktreeName } from '../../terminal';
import { errMsg } from '../../../lib/errMsg';

const SKILL_KEY = 'jira:workSkill'; // 마지막으로 고른 시작 스킬 (localStorage)
const ACCOUNT_KEY = 'jira:workAccount'; // 마지막으로 고른 Claude 계정

const SKILL_OPTIONS: { value: JiraWorkSkill; label: string }[] = [
  { value: 'auto', label: '자동 (버그 → /bugfix, 그 외 → /dev)' },
  { value: 'bugfix', label: '/bugfix — 버그 분류·수정' },
  { value: 'dev', label: '/dev — 페이지·기능 개발' },
  { value: 'qa', label: '/qa — 검증' },
  { value: 'none', label: '지정 없음 (femc 가 판단)' },
];

/** 선택된 위치 — 워크스페이스와 워크트리 경로 쌍 */
type Spot = { wsId: string; path: string };

export function StartWorkModal({
  issueKey,
  summary,
  projectKey,
  onClose,
}: {
  issueKey: string;
  summary: string;
  /** 이슈의 Jira 프로젝트 키 — 레지스트리와 맞춰 기본 위치를 고른다 */
  projectKey: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeInfo[]>>({});
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [femcReady, setFemcReady] = useState(true); // 확인 전엔 경고를 띄우지 않는다
  const [accounts, setAccounts] = useState<JiraWorkAccountInfo[]>([]);
  const [ready, setReady] = useState(false);

  const [spot, setSpot] = useState<Spot | null>(null);
  const [resume, setResume] = useState(false);
  const [skill, setSkill] = useState<JiraWorkSkill>(
    () => (localStorage.getItem(SKILL_KEY) as JiraWorkSkill | null) ?? 'auto'
  );
  const [note, setNote] = useState('');
  // 셸(zshrc)이 매번 묻던 Personal/Team 선택을 여기서 대신 정한다
  const [account, setAccount] = useState<JiraWorkAccount>(
    () => (localStorage.getItem(ACCOUNT_KEY) as JiraWorkAccount | null) ?? 'personal'
  );
  const [busy, setBusy] = useState(false);

  // 위치·세션 목록 — 모달을 열 때 한 번 (긴 작업이 아니라 폴링하지 않는다)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const api = window.oneApp;
      if (!api) return;
      const [ws, ss, ps, agents, accs] = await Promise.all([
        api.workspaces.list(),
        api.terminal.list(),
        api.projects.list(),
        api.terminal.agents(),
        api.jira.workAccounts(),
      ]);
      const trees = await Promise.all(
        ws.map(async (w) => [w.id, await api.workspaces.worktrees(w.id)] as const)
      );
      if (!alive) return;
      setWorkspaces(ws);
      setWorktrees(Object.fromEntries(trees));
      setSessions(ss);
      setProjects(ps);
      setFemcReady(agents.some((a) => a.id === 'femc' && a.installed));
      setAccounts(accs);
      // 저장된 선택이 사라졌으면(프로필 폴더 삭제) 첫 계정으로 되돌린다
      if (accs.length > 0 && !accs.some((a) => a.id === account)) setAccount(accs[0].id);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 이 티켓과 이어진 저장소 — 레지스트리의 Jira 키가 같은 프로젝트의 로컬 경로로 판정
  const matchedWsIds = useMemo(() => {
    const paths = new Set(
      projects
        .filter((p) => p.jiraProjectKey && p.jiraProjectKey === projectKey)
        .map((p) => p.localPath)
    );
    return new Set(workspaces.filter((w) => paths.has(w.repoPath)).map((w) => w.id));
  }, [projects, workspaces, projectKey]);

  // 매칭된 저장소를 맨 위로 (그 안의 순서는 등록 순 유지)
  const ordered = useMemo(
    () =>
      [...workspaces].sort(
        (a, b) => Number(matchedWsIds.has(b.id)) - Number(matchedWsIds.has(a.id))
      ),
    [workspaces, matchedWsIds]
  );

  // 기본 선택 — 매칭 저장소의 주 워크트리, 없으면 첫 저장소의 첫 워크트리
  useEffect(() => {
    if (!ready || spot) return;
    for (const ws of ordered) {
      const list = worktrees[ws.id] ?? [];
      const wt = list.find((w) => w.isMain && !w.missing) ?? list.find((w) => !w.missing);
      if (wt) {
        setSpot({ wsId: ws.id, path: wt.path });
        return;
      }
    }
  }, [ready, spot, ordered, worktrees]);

  /** 이어서 쓸 수 있는 세션 — 고른 위치에서 **입력을 기다리는** femc 세션 하나 */
  const resumable = useMemo(() => {
    if (!spot) return null;
    return (
      sessions.find(
        (s) => s.cwd === spot.path && s.agentId === 'femc' && s.status === 'waiting'
      ) ?? null
    );
  }, [sessions, spot]);

  // 위치를 옮기면 이어서 쓰기 선택은 초기화한다 (그 위치의 세션 이야기였다)
  useEffect(() => {
    setResume(false);
  }, [spot?.path]);

  const changeAccount = useCallback((v: string) => {
    setAccount(v as JiraWorkAccount);
    localStorage.setItem(ACCOUNT_KEY, v);
  }, []);

  const changeSkill = useCallback((v: string) => {
    setSkill(v as JiraWorkSkill);
    localStorage.setItem(SKILL_KEY, v);
  }, []);

  const start = async () => {
    if (!spot) return;
    setBusy(true);
    try {
      const prep = await window.oneApp.jira.prepareWork({
        key: issueKey,
        skill,
        note: note.trim() || undefined,
        account,
      });
      if (!prep.ok || !prep.command || !prep.paste) {
        toast(prep.error ?? '티켓을 준비하지 못했습니다', 'fail');
        return;
      }

      if (resume && resumable) {
        // 이미 떠 있는 femc 에 그대로 입력 — paste 는 main 이 한 줄로 만들어 준다
        window.oneApp.terminal.write(resumable.id, `${prep.paste}\r`);
        openTerminalSession({ sessionId: resumable.id, cwd: spot.path });
        toast(`${issueKey} — 진행 중인 세션에 전달했습니다`);
      } else {
        const info = await window.oneApp.terminal.create({
          cwd: spot.path,
          agentId: 'femc',
          command: prep.command,
          title: prep.title ?? issueKey,
        });
        openTerminalSession({ sessionId: info.id, cwd: spot.path });
        const att = prep.attachments ?? 0;
        toast(`${issueKey} 작업을 시작했습니다${att > 0 ? ` (첨부 ${att}개 전달)` : ''}`);
      }
      onClose();
    } catch (err) {
      toast(`작업을 시작하지 못했습니다 — ${errMsg(err)}`, 'fail');
    } finally {
      setBusy(false);
    }
  };

  const sessionCount = (cwd: string) => sessions.filter((s) => s.cwd === cwd).length;
  const hasWorkspace = ordered.some((ws) => (worktrees[ws.id] ?? []).length > 0);

  return (
    <Modal title={`${issueKey} 작업 시작`} onClose={onClose}>
      <div className="jira-work">
        <p className="jira-work__summary">{summary}</p>

        {!femcReady && (
          <Banner variant="warning">
            femc 를 찾을 수 없습니다. 설치 후 앱을 다시 시작하면 여기서 바로 시작할 수
            있습니다.
          </Banner>
        )}

        <FormRow label="위치" column>
          {!ready ? (
            <p className="hint">위치 목록을 불러오는 중...</p>
          ) : !hasWorkspace ? (
            <p className="hint">
              터미널 섹션에서 저장소(워크스페이스)를 먼저 등록하세요.
            </p>
          ) : (
            <div className="jira-work__list" role="radiogroup" aria-label="시작할 위치">
              {ordered.map((ws) => (
                <div className="jira-work__ws" key={ws.id}>
                  <div className="jira-work__ws-head">
                    <span className="jira-work__ws-name">{ws.name}</span>
                    {matchedWsIds.has(ws.id) && (
                      <span className="jira-work__match">{projectKey} 매칭</span>
                    )}
                  </div>
                  {(worktrees[ws.id] ?? []).map((wt) => {
                    const on = spot?.wsId === ws.id && spot.path === wt.path;
                    const count = sessionCount(wt.path);
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        key={wt.path}
                        className={'jira-work__wt' + (on ? ' jira-work__wt--on' : '')}
                        disabled={wt.missing}
                        title={wt.path}
                        onClick={() => setSpot({ wsId: ws.id, path: wt.path })}
                      >
                        <span className="jira-work__wt-mark">
                          {on && <Icon name="check" size={12} />}
                        </span>
                        <span className="jira-work__wt-name">{worktreeName(wt)}</span>
                        <span className="jira-work__wt-branch">
                          {wt.branch ?? wt.head ?? ''}
                        </span>
                        {/* 작업 중인 곳에 새 티켓을 얹지 않도록 미커밋 변경량을 보여준다.
                            ⚠️ untracked 만 있으면 증감이 0 이라 '±0' 이 되므로 말로 쓴다 */}
                        {wt.dirty && (
                          <span
                            className="jira-work__wt-dirty"
                            title="미커밋 변경이 있습니다"
                          >
                            {wt.additions + wt.deletions > 0
                              ? `±${wt.additions + wt.deletions}`
                              : '미커밋'}
                          </span>
                        )}
                        {count > 0 && (
                          <span className="jira-work__wt-count">{count}세션</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </FormRow>

        {resumable && (
          <Checkbox
            label={`이어서 쓰기 — 이 위치의 femc 세션(${resumable.title})에 전달`}
            checked={resume}
            onChange={(e) => setResume(e.currentTarget.checked)}
          />
        )}

        {accounts.length > 1 && (
          <FormRow label="Claude 계정" column>
            <Select
              aria-label="Claude 계정"
              value={account}
              onChange={changeAccount}
              options={accounts.map((a) => ({
                value: a.id,
                label: a.email ? `${a.label} — ${a.email}` : `${a.label} (미로그인)`,
                search: `${a.label} ${a.email ?? ''}`,
              }))}
            />
          </FormRow>
        )}

        <FormRow label="시작" column>
          <Select
            aria-label="시작 스킬"
            value={skill}
            onChange={changeSkill}
            options={SKILL_OPTIONS}
          />
        </FormRow>

        <FormRow label="부가 설명 (선택)" column>
          <Input
            value={note}
            placeholder="예: 어드민만 보면 돼"
            onChange={(e) => setNote(e.currentTarget.value)}
          />
        </FormRow>

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button loading={busy} disabled={!spot} onClick={() => void start()}>
            작업 시작
          </Button>
        </div>
      </div>
    </Modal>
  );
}
