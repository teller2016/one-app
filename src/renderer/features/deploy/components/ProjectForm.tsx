import type { DeployProjectView } from '../../../../shared/types';

// ── 폼 상태 ──
export type TargetFormState = { id?: string; name: string; jobPath: string };
export type ProjectFormState = {
  id?: string;
  name: string;
  jenkinsUrl: string;
  username: string;
  secret: string;
  hasSecret: boolean; // 기존에 토큰이 저장돼 있는지 (placeholder 표시용)
  targets: TargetFormState[];
};

export const emptyForm = (): ProjectFormState => ({
  name: '',
  jenkinsUrl: '',
  username: '',
  secret: '',
  hasSecret: false,
  targets: [{ name: '', jobPath: '' }],
});

export const toForm = (p: DeployProjectView): ProjectFormState => ({
  id: p.id,
  name: p.name,
  jenkinsUrl: p.jenkinsUrl,
  username: p.username,
  secret: '',
  hasSecret: p.hasSecret,
  targets: p.targets.map((t) => ({ ...t })),
});

type Props = {
  form: ProjectFormState;
  error: string;
  onChange: (next: ProjectFormState) => void;
  onSave: () => void;
  onCancel: () => void;
};

/** 프로젝트 추가/편집 폼 — 젠킨스 정보 + 배포 대상 목록 입력 */
export function ProjectForm({ form, error, onChange, onSave, onCancel }: Props) {
  const setTarget = (idx: number, patch: Partial<TargetFormState>) => {
    onChange({
      ...form,
      targets: form.targets.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });
  };

  return (
    <div className="sched">
      <h2 className="sched__title">
        🚀 {form.id ? '프로젝트 편집' : '프로젝트 추가'}
      </h2>
      <p className="sched__sub">
        프로젝트의 젠킨스 정보와 배포 대상(스토어/어드민 등)을 등록합니다.
      </p>

      <div className="sched__row">
        <label className="sched__label">프로젝트명</label>
        <input
          className="sched__input"
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="예: 메타커머스"
          autoComplete="off"
        />
      </div>

      <div className="sched__row">
        <label className="sched__label">젠킨스 URL</label>
        <input
          className="sched__input"
          type="text"
          value={form.jenkinsUrl}
          onChange={(e) => onChange({ ...form, jenkinsUrl: e.target.value })}
          placeholder="예: https://jenkins.example.com"
          autoComplete="off"
        />
      </div>

      <div className="sched__row">
        <label className="sched__label">아이디</label>
        <input
          className="sched__input"
          type="text"
          value={form.username}
          onChange={(e) => onChange({ ...form, username: e.target.value })}
          placeholder="젠킨스 아이디"
          autoComplete="off"
        />
      </div>

      <div className="sched__row">
        <label className="sched__label">API 토큰</label>
        <input
          className="sched__input"
          type="password"
          value={form.secret}
          onChange={(e) => onChange({ ...form, secret: e.target.value })}
          placeholder={
            form.hasSecret
              ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
              : 'API 토큰 또는 비밀번호'
          }
          autoComplete="off"
        />
      </div>

      <p className="sched__note">
        🔐 젠킨스 <b>내 계정 → 설정(Configure) → API Token</b> 에서 발급한
        토큰 권장. 비밀번호도 동작하지만 젠킨스 보안 설정에 따라 막힐 수
        있습니다. 값은 macOS 키체인으로 <b>암호화</b>되어 이 기기에만
        저장됩니다.
      </p>

      <label className="sched__label sched__label--log">배포 대상</label>
      {form.targets.map((t, i) => (
        <div className="sched__row" key={t.id ?? `new-${i}`}>
          <input
            className="sched__input"
            style={{ maxWidth: 180 }}
            type="text"
            value={t.name}
            onChange={(e) => setTarget(i, { name: e.target.value })}
            placeholder="표시명 (예: 스토어)"
            autoComplete="off"
          />
          <input
            className="sched__input"
            type="text"
            value={t.jobPath}
            onChange={(e) => setTarget(i, { jobPath: e.target.value })}
            placeholder="젠킨스 잡 이름 (폴더 안이면 폴더/잡)"
            autoComplete="off"
          />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() =>
              onChange({
                ...form,
                targets: form.targets.filter((_, idx) => idx !== i),
              })
            }
            disabled={form.targets.length <= 1}
            title="이 배포 대상 삭제"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() =>
          onChange({
            ...form,
            targets: [...form.targets, { name: '', jobPath: '' }],
          })
        }
      >
        + 배포 대상 추가
      </button>

      {error && <p className="sched__banner">{error}</p>}

      <div className="sched__actions">
        <button type="button" className="btn btn--primary" onClick={onSave}>
          저장
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
