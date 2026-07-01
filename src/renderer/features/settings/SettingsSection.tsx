import { useEffect, useState } from 'react';

/** 환경설정 섹션 — 비즈박스 로그인 계정 정보를 관리한다. */
export function SettingsSection() {
  const [bizboxId, setBizboxId] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.oneApp?.settings.get().then((s) => {
      setBizboxId(s.bizboxId);
      setHasPassword(s.hasPassword);
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setStatus('저장 중...');
    const res = await window.oneApp.settings.set({ bizboxId, password });
    setHasPassword(res.hasPassword);
    setPassword('');
    setStatus('✅ 저장되었습니다.');
    setTimeout(() => setStatus(''), 2500);
  };

  return (
    <div className="sched">
      <h2 className="sched__title">⚙️ 환경설정</h2>
      <p className="sched__sub">
        비즈박스 그룹웨어 로그인 계정 정보 (일정 등록에 사용)
      </p>

      <div className="sched__row">
        <label className="sched__label">아이디</label>
        <input
          className="sched__input"
          type="text"
          value={bizboxId}
          onChange={(e) => setBizboxId(e.target.value)}
          placeholder="비즈박스 아이디"
          disabled={loading}
          autoComplete="off"
        />
      </div>

      <div className="sched__row">
        <label className="sched__label">비밀번호</label>
        <input
          className="sched__input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            hasPassword ? '●●●●●●  (저장됨 — 바꿀 때만 입력)' : '비밀번호 입력'
          }
          disabled={loading}
          autoComplete="off"
        />
      </div>

      <p className="sched__note">
        🔒 비밀번호는 macOS 키체인으로 <b>암호화</b>되어 이 기기에만 저장됩니다.
        (평문 저장 아님)
      </p>

      <div className="sched__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={loading || !bizboxId}
        >
          저장
        </button>
        {status && (
          <span className="sched__hint" style={{ alignSelf: 'center' }}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
