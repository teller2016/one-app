import { useEffect, useState } from 'react';
import type { AltMailAccount } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';

/**
 * 환경설정의 **'추가 비즈박스 계정'** 카드 — 내 계정 외에 조회용으로 쓸 그룹웨어 계정을 등록한다.
 * 지금 쓰임새는 팀 공용 계정의 피그마 인증코드 조회(메일 리더의 [인증코드] 탭)다.
 *
 * 비밀번호는 main 이 `safeStorage` 로 암호화해 보관하며 화면으로 다시 내려오지 않는다.
 * (환경설정에 두는 이유 — 계정 관리는 다른 계정 설정과 한자리에 있어야 찾기 쉽다)
 *
 * **패널 본문만** 그린다 — 테두리·제목·접기는 환경설정의 그룹 패널이 두른다(목업 SettingsAccount).
 */
export function AltAccountsCard() {
  const [accounts, setAccounts] = useState<AltMailAccount[] | null>(null);
  const [newId, setNewId] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  useEffect(() => {
    void window.oneApp.mail.authCodeAccounts().then(setAccounts);
  }, []);

  const addAccount = async () => {
    setSaving(true);
    setError('');
    const res = await window.oneApp.mail.saveAuthCodeAccount(newId, newPw);
    setSaving(false);
    if (res.ok && res.accounts) {
      setAccounts(res.accounts);
      setNewId('');
      setNewPw('');
    } else {
      setError(res.error ?? '계정을 저장하지 못했습니다.');
    }
  };

  const removeAccount = async (loginId: string) => {
    const ok = await confirm({
      title: `${loginId} 계정을 삭제할까요?`,
      message: '저장된 비밀번호도 함께 지워집니다.',
      danger: true,
    });
    if (!ok) return;
    const res = await window.oneApp.mail.removeAuthCodeAccount(loginId);
    if (res.accounts) setAccounts(res.accounts);
  };

  return (
    <>
      <span className="hint">
        팀 공용 계정 등 위 계정 외의 그룹웨어 계정 — 메일 리더의{' '}
        <b>[인증코드]</b> 탭에서 피그마 로그인 코드를 받아옵니다.
      </span>

      {/* 등록된 계정 줄 + 맨 아래 추가 줄이 한 상자(선·모서리 8)에 담긴다 */}
      <div className="alt-accounts">
        {accounts?.map((a) => (
          <div key={a.loginId} className="alt-accounts__row">
            <span className="alt-accounts__id">
              <Icon name="key" size={13} />
              {a.loginId}
            </span>
            <Button
              variant="plain"
              size="xs"
              onClick={() => void removeAccount(a.loginId)}
            >
              <Icon name="x" size={12} />
              삭제
            </Button>
          </div>
        ))}

        <div className="alt-accounts__form">
          <Input
            small
            placeholder="계정 아이디"
            aria-label="계정 아이디"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <Input
            small
            type="password"
            placeholder="비밀번호"
            aria-label="비밀번호"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
          />
          <Button
            size="xs"
            loading={saving}
            disabled={!newId.trim() || !newPw}
            onClick={() => void addAccount()}
          >
            <Icon name="plus" size={12} />
            추가
          </Button>
        </div>
      </div>

      {error && <Banner variant="danger">{error}</Banner>}

      <span className="hint">
        이미 등록한 아이디를 다시 추가하면 <b>비밀번호만 갱신</b>됩니다.
        비밀번호는 macOS 키체인으로 <b>암호화</b>되어 이 기기에만 저장됩니다.
      </span>
    </>
  );
}
