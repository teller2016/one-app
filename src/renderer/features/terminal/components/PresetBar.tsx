// 프리셋 바 (Superset 동일) — [⚙ | 칩…]. 칩 클릭 = 그 위치의 새 세션에서 명령 실행.
// ⚠️ 세션 화면(TerminalView)과 '세션 없음' 화면(TerminalSection)이 **같은 것을 쓴다** —
//    예전엔 TerminalView 안에만 있어서 세션이 0 개면 프리셋이 통째로 사라졌다.
//    첫 세션을 프리셋으로 시작하는 것이 가장 자연스러운 흐름인데 그게 막혀 있었다
//    (2026-08-08 사용자 지적). 자리도 같아서 세션이 생겨도 바가 움직이지 않는다.
import type { TerminalPreset } from '../../../../shared/types';
import { Icon } from '../../../components/Icon';
import { Tooltip } from '../../../components/Tooltip';
import { presetIcon } from '../lib/workspace';

export function PresetBar({
  presets,
  cwd,
  disabled = false,
  onRun,
  onEdit,
}: {
  /** 이 위치의 워크스페이스에 노출된 프리셋만 (presetsForWorkspace) */
  presets: TerminalPreset[];
  /** 툴팁용 실행 위치 — 세션 없음 화면에선 선택된 워크트리 경로 */
  cwd?: string;
  /** 실행할 위치가 없을 때(워크트리 미선택) — 편집은 열되 칩은 누를 수 없다 */
  disabled?: boolean;
  onRun: (preset: TerminalPreset) => void;
  onEdit: () => void;
}) {
  return (
    <span className="terminal__bar-presets" title={cwd}>
      <Tooltip label="프리셋 편집 — 클릭 한 번으로 실행할 명령 관리">
        <button
          type="button"
          className="icon-btn"
          aria-label="프리셋 편집"
          onClick={onEdit}
        >
          <Icon name="settings" size={14} />
        </button>
      </Tooltip>
      {presets.length > 0 && (
        <span className="terminal__bar-sep" aria-hidden="true" />
      )}
      {presets.map((p) => (
        <Tooltip
          key={p.id}
          label={
            disabled
              ? '좌측에서 워크트리를 선택하면 실행할 수 있습니다'
              : `${p.command} — 새 세션에서 실행`
          }
        >
          <button
            type="button"
            className="terminal__preset"
            disabled={disabled}
            onClick={() => onRun(p)}
          >
            <Icon name={presetIcon(p)} size={13} />
            <span className="terminal__preset-name">{p.name}</span>
          </button>
        </Tooltip>
      ))}
    </span>
  );
}
