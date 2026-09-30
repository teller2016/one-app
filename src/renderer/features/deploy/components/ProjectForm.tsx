import type { DeployProjectView } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Banner } from '../../../components/Banner';
import { TopbarSlot } from '../../../components/TopbarSlot';

// ── 폼 상태 ──
export type TargetFormState = { id?: string; name: string; jobPath: string };
export type ProjectFormState = {
  id?: string;
  name: string;
  jenkinsUrl: string;
  username: string;
  secret: string;
  hasSecret: boolean; // 기존에 토큰이 저장돼 있는지 (placeholder 표시용)
  production: boolean; // 운영(PROD) — 배포 시 강한 확인
  targets: TargetFormState[];
};

export const emptyForm = (): ProjectFormState => ({
  name: '',
  jenkinsUrl: '',
  username: '',
  secret: '',
  hasSecret: false,
  production: false,
  targets: [{ name: '', jobPath: '' }],
});

export const toForm = (p: DeployProjectView): ProjectFormState => ({
  id: p.id,
  name: p.name,
  jenkinsUrl: p.jenkinsUrl,
  username: p.username,
  secret: '',
  hasSecret: p.hasSecret,
  production: p.production,
  targets: p.targets.map((t) => ({ ...t })),
});

type Props = {
  form: ProjectFormState;
  error: string;
  onChange: (next: ProjectFormState) => void;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * 프로젝트 추가/편집 폼 — 젠킨스 정보 + 배포 대상 목록 입력.
 * 목업 DeployProjectForm.dc.html: 페이지 제목(h1) + 패널 안 2열 그리드(라벨 120 · 입력) + 토큰 안내 →
 * 운영(PROD) 체크 띠 → 배포 대상 행(표시명 180 · 잡 · 삭제 32) → 구분선 → [저장][취소]. 목록 자리를 대체한다(모달 아님).
 */
export function ProjectForm({
  form,
  error,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const setTarget = (idx: number, patch: Partial<TargetFormState>) => {
    onChange({
      ...form,
      targets: form.targets.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });
  };
  const title = form.id ? '프로젝트 편집' : '프로젝트 추가';

  return (
    <div className="section deploy deploy--form">
      {/* 탑바 경로 셋째 칸 — 목업 '개발 / 배포 / 프로젝트 편집' */}
      <TopbarSlot crumb={title} />
      <div className="deploy__form">
        <h1 className="deploy__form-title">{title}</h1>

        <div className="deploy__form-grid">
          <label className="deploy__form-label" htmlFor="dp-name">
            프로젝트명
          </label>
          <Input
            id="dp-name"
            type="text"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="예: 메타커머스"
          />

          <label className="deploy__form-label" htmlFor="dp-url">
            젠킨스 URL
          </label>
          <Input
            id="dp-url"
            className="deploy__form-mono"
            type="text"
            value={form.jenkinsUrl}
            onChange={(e) => onChange({ ...form, jenkinsUrl: e.target.value })}
            placeholder="예: https://jenkins.example.com"
          />

          <label className="deploy__form-label" htmlFor="dp-id">
            아이디
          </label>
          <Input
            id="dp-id"
            type="text"
            value={form.username}
            onChange={(e) => onChange({ ...form, username: e.target.value })}
            placeholder="젠킨스 아이디"
          />

          <label className="deploy__form-label" htmlFor="dp-token">
            API 토큰
          </label>
          <Input
            id="dp-token"
            type="password"
            value={form.secret}
            onChange={(e) => onChange({ ...form, secret: e.target.value })}
            placeholder={
              form.hasSecret
                ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
                : 'API 토큰 또는 비밀번호'
            }
          />

          <span />
          <p className="deploy__form-note">
            젠킨스 <b>내 계정 → 설정(Configure) → API Token</b> 에서 발급한 토큰
            권장. 비밀번호도 동작하지만 젠킨스 보안 설정에 따라 막힐 수
            있습니다. 값은 macOS 키체인으로 <b>암호화</b>되어 이 기기에만
            저장됩니다.
          </p>
        </div>

        <Checkbox
          danger
          className="deploy__prod-check"
          checked={form.production}
          onChange={(e) => onChange({ ...form, production: e.target.checked })}
          label="운영(PROD) 프로젝트 — 배포할 때 대상 이름을 입력해야 실행됩니다"
        />

        <div className="deploy__form-targets">
          <span className="deploy__form-targets-label">배포 대상</span>
          {form.targets.map((t, i) => (
            <div key={t.id ?? `new-${i}`} className="deploy__form-target">
              <Input
                type="text"
                value={t.name}
                onChange={(e) => setTarget(i, { name: e.target.value })}
                placeholder="표시명 (예: 스토어)"
                aria-label="표시명"
              />
              <Input
                className="deploy__form-mono"
                type="text"
                value={t.jobPath}
                onChange={(e) => setTarget(i, { jobPath: e.target.value })}
                placeholder="젠킨스 잡 이름 (폴더 안이면 폴더/잡)"
                aria-label="젠킨스 잡 이름"
              />
              <Button
                icon
                onClick={() =>
                  onChange({
                    ...form,
                    targets: form.targets.filter((_, idx) => idx !== i),
                  })
                }
                disabled={form.targets.length <= 1}
                title="이 배포 대상 삭제"
                aria-label="이 배포 대상 삭제"
              >
                <Icon name="x" size={14} />
              </Button>
            </div>
          ))}
          <div>
            <Button
              onClick={() =>
                onChange({
                  ...form,
                  targets: [...form.targets, { name: '', jobPath: '' }],
                })
              }
            >
              <Icon name="plus" size={14} />
              배포 대상 추가
            </Button>
          </div>
        </div>

        {error && <Banner>{error}</Banner>}

        <div className="deploy__divider" />
        <div className="deploy__form-actions">
          <Button variant="primary" onClick={onSave}>
            저장
          </Button>
          <Button onClick={onCancel}>취소</Button>
        </div>
      </div>
    </div>
  );
}
