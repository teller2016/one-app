// 새 세션 모달 — 위치는 선택된 워크트리로 고정, 에이전트만 고른다.
// 에이전트를 고르면 셸이 뜬 뒤 해당 CLI 가 자동 실행된다 (미설치 에이전트는 선택지에서 제외).
import { useEffect, useState } from 'react';
import type { TerminalAgentId, TerminalAgentInfo } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { terminalBackend } from '../lib/backend';

export function NewSessionModal({
  cwd,
  location,
  onCreated,
  onClose,
}: {
  /** 세션 시작 디렉터리 — 선택된 워크트리 경로 */
  cwd: string;
  /** 위치 표시용 라벨 (워크트리명 · 브랜치) */
  location: string;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [agents, setAgents] = useState<TerminalAgentInfo[]>([]);
  const [agentId, setAgentId] = useState<TerminalAgentId>('shell');
  const [creating, setCreating] = useState(false);
  const [tmux, setTmux] = useState(true); // 확인 전엔 힌트를 띄우지 않는다

  useEffect(() => {
    void window.oneApp?.terminal.agents().then((list) => {
      setAgents(list);
      // 주 사용 사례가 claude 세션 — 설치돼 있으면 기본 선택
      if (list.some((a) => a.id === 'claude' && a.installed)) setAgentId('claude');
    });
    void terminalBackend().then((b) => setTmux(b.tmux));
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      const info = await window.oneApp.terminal.create({ cwd, agentId });
      onCreated(info.id);
      onClose();
    } catch (err) {
      toast(`세션 생성 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title="새 세션" onClose={onClose}>
      <div className="terminal-new">
        <FormRow label="위치" column>
          <code className="terminal-new__path" title={cwd}>
            {location}
          </code>
        </FormRow>
        <FormRow label="에이전트" column>
          <Select
            className="terminal-new__select"
            aria-label="에이전트"
            value={agentId}
            onChange={(v) => setAgentId(v as TerminalAgentId)}
            options={agents
              .filter((a) => a.installed)
              .map((a) => ({ value: a.id, label: a.name }))}
          />
        </FormRow>
        {!tmux && (
          <p className="hint">
            tmux 를 설치하면(brew install tmux) 앱을 재시작해도 세션이
            유지됩니다.
          </p>
        )}
        <div className="form-actions">
          <Button loading={creating} onClick={() => void create()}>
            시작
          </Button>
        </div>
      </div>
    </Modal>
  );
}
