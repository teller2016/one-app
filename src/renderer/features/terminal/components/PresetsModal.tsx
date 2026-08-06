// 프리셋 편집 모달 — 프리셋 바(⚙ 옆 칩)의 이름·명령·노출 레포·바 표시를 관리한다.
// Superset 의 terminal_presets 와 같은 모델: 전역 목록 + workspaceIds 스코프 + 바 노출 여부.
// 레포 스코프는 MultiSelect 드롭다운 하나로 — 인라인 체크박스는 행 구분을 망친다(2026-08-06).
import { useEffect, useState } from 'react';
import type { TerminalPreset, TerminalWorkspace } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { MultiSelect } from '../../../components/MultiSelect';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';

export function PresetsModal({
  workspaces,
  onClose,
}: {
  workspaces: TerminalWorkspace[];
  onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<TerminalPreset[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void window.oneApp.workspaces.presets.get().then(setRows);
  }, []);

  const patch = (id: string, part: Partial<TerminalPreset>) =>
    setRows((cur) => cur?.map((p) => (p.id === id ? { ...p, ...part } : p)) ?? cur);

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
          칩을 누르면 그 워크트리 위치의 <b>새 세션</b>에서 명령이 실행됩니다. 레포를
          고르면 그 레포 화면에서만 칩이 보입니다. 이름이나 명령이 빈 행은 저장 시
          제거됩니다.
        </p>
        {!rows && <span className="spinner" />}
        {rows?.map((p) => (
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
            <MultiSelect
              small
              aria-label="노출 레포"
              className="terminal-presets__scope"
              options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
              values={p.workspaceIds}
              onChange={(ids) => patch(p.id, { workspaceIds: ids })}
              allLabel="전역"
              countLabel={(n) => `레포 ${n}개`}
              emptyLabel="레포 없음"
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
        ))}
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
