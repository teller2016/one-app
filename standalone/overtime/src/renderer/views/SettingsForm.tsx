import { useState } from 'react';
import type { AccountView } from '../../shared/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Checkbox';
import { FormRow } from '../components/FormRow';
import { Input } from '../components/Input';

/** 설정 화면 — 그룹웨어 계정·소속. 계정이 없으면 첫 실행 때 여기부터 시작한다. */
export function SettingsForm({
  account,
  onSaved,
  onCancel,
}: {
  account: AccountView;
  onSaved: (next: AccountView) => void;
  onCancel: (() => void) | null;
}) {
  const [id, setId] = useState(account.id);
  const [password, setPassword] = useState('');
  const [dept, setDept] = useState(account.dept);
  const [showBrowser, setShowBrowser] = useState(account.showBrowser);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!id.trim()) {
      setError('사번(ID)을 입력하세요.');
      return;
    }
    if (!account.hasPassword && !password) {
      setError('비밀번호를 입력하세요.');
      return;
    }
    setSaving(true);
    const next = await window.overtimeApp.saveAccount({
      id,
      password: password || undefined,
      dept,
      showBrowser,
    });
    setSaving(false);
    setPassword('');
    setError('');
    onSaved(next);
  };

  return (
    <div className="settings-form">
      {!account.hasPassword && (
        <Banner variant="info">
          그룹웨어(gw.forbiz.co.kr) 로그인에 쓰는 사번·비밀번호를 먼저 저장하세요.
        </Banner>
      )}
      {error && <Banner variant="danger">{error}</Banner>}

      <FormRow label="사번(ID)">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="그룹웨어 로그인 ID"
          disabled={saving}
        />
      </FormRow>

      <FormRow label="비밀번호">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            account.hasPassword ? '저장됨 — 변경할 때만 입력' : '그룹웨어 비밀번호'
          }
          disabled={saving}
        />
      </FormRow>

      <FormRow label="소속">
        <Input
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          placeholder="예: 플랫폼서비스사업부문 FE"
          disabled={saving}
        />
      </FormRow>
      <p className="hint settings-form__hint">
        야근 결재의 근무자 표 &apos;소속&apos; 칸에 그대로 들어갑니다.
      </p>

      <Checkbox
        label="작업 중 브라우저 창 보이기 (문제 확인용)"
        checked={showBrowser}
        onChange={(e) => setShowBrowser(e.target.checked)}
        disabled={saving}
      />

      <div className="form-actions">
        <Button variant="primary" onClick={() => void save()} loading={saving}>
          저장
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            취소
          </Button>
        )}
      </div>
    </div>
  );
}
