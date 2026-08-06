// 프리셋 편집 모달 — 프리셋 바(⚙ 옆 칩)의 이름·명령·노출 범위를 관리한다.
// Superset 의 terminal_presets 와 같은 모델: 전역 목록 + workspaceIds 스코프 + 바 노출 여부.
import { useEffect, useState } from 'react';
import type { TerminalPreset, TerminalWorkspace } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';

type Scope = 'all' | 'current' | 'multi';

const scopeOf = (p: TerminalPreset, currentWsId: string | null): Scope => {
  if (!p.workspaceIds) return 'all';
  if (currentWsId && p.workspaceIds.length === 1 && p.workspaceIds[0] === currentWsId)
    return 'current';
  return 'multi';
};

export function PresetsModal({
  workspaces,
  currentWsId,
  onClose,
}: {
  workspaces: TerminalWorkspace[];
  /** 지금 보고 있는 워크스페이스 — '이 워크스페이스 전용' 스코프의 기준 (기타면 null) */
  currentWsId: string | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<TerminalPreset[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.oneApp.workspaces.presets.get().then(setRows);
  }, []);

  const currentWsName = workspaces.find((w) => w.id === currentWsId)?.name;

  const patch = (id: string, part: Partial<TerminalPreset>) =>
    setRows((cur) => cur?.map((p) => (p.id === id ? { ...p, ...part } : p)) ?? cur);

  const setScope = (p: TerminalPreset, scope: string) => {
    if (scope === 'all') patch(p.id, { workspaceIds: undefined });
    else if (scope === 'current' && currentWsId)
      patch(p.id, { workspaceIds: [currentWsId] });
    // 'multi' = 가져온 다중 스코프 유지 — 편집은 지원하지 않는다 (이관 데이터 보존용)
  };

  const add = () =>
    setRows((cur) => [
      ...(cur ?? []),
      { id: crypto.randomUUID(), name: '', command: '' },
    ]);

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    try {
      await window.oneApp.workspaces.presets.save(rows);
      toast('프리셋을 저장했습니다');
      onClose();
    } catch (err) {
      toast(`프리셋 저장 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="프리셋" onClose={onClose} wide>
      <div className="terminal-presets">
        <p className="hint">
          칩을 누르면 그 워크트리 위치의 <b>새 세션</b>에서 명령이 실행됩니다. 이름이나
          명령이 빈 행은 저장 시 제거됩니다.
        </p>
        {!rows && <span className="spinner" />}
        {rows?.map((p) => {
          const scope = scopeOf(p, currentWsId);
          return (
            <div key={p.id} className="terminal-presets__row">
              <Input
                small
                aria-label="프리셋 이름"
                placeholder="이름"
                className="terminal-presets__name"
                value={p.name}
                onChange={(e) => patch(p.id, { name: e.target.value })}
              />
              <Input
                small
                aria-label="실행 명령"
                placeholder="실행 명령 (예: npm run dev)"
                className="terminal-presets__cmd"
                value={p.command}
                onChange={(e) => patch(p.id, { command: e.target.value })}
              />
              <Select
                small
                aria-label="노출 범위"
                className="terminal-presets__scope"
                value={scope}
                onChange={(v) => setScope(p, v)}
                options={[
                  { value: 'all', label: '전역' },
                  ...(currentWsId
                    ? [{ value: 'current', label: `${currentWsName} 전용` }]
                    : []),
                  ...(scope === 'multi'
                    ? [
                        {
                          value: 'multi',
                          label: `지정 ${p.workspaceIds?.length ?? 0}개`,
                        },
                      ]
                    : []),
                ]}
              />
              <Checkbox
                label="바 표시"
                checked={p.pinned !== false}
                onChange={(e) =>
                  patch(p.id, { pinned: e.target.checked ? undefined : false })
                }
              />
              <Tooltip label="프리셋 삭제">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`'${p.name || '이름 없음'}' 프리셋 삭제`}
                  onClick={() =>
                    setRows((cur) => cur?.filter((r) => r.id !== p.id) ?? cur)
                  }
                >
                  <Icon name="x" size={14} />
                </button>
              </Tooltip>
            </div>
          );
        })}
        <div className="form-actions terminal-presets__actions">
          <Button size="sm" variant="ghost" onClick={add}>
            프리셋 추가
          </Button>
          <Button loading={saving} disabled={!rows} onClick={() => void save()}>
            저장
          </Button>
        </div>
      </div>
    </Modal>
  );
}
