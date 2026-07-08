import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import type { ReminderConfig, DayReminderConfig } from '../../../../shared/types';

const DAY_LABELS: Record<number, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
};

// 설정이 비어 있을 때 표시할 기본 요일 구성 (월~금)
const defaultDays = (): DayReminderConfig[] =>
  [1, 2, 3, 4, 5].map((day) => ({
    day,
    come: { enabled: true, time: '09:00' },
    leave: { enabled: true, time: '18:00' },
  }));

/** 환경설정 섹션 — 비즈박스 계정 · 알림 · 출퇴근 리마인더를 관리한다. */
export function SettingsSection() {
  const [bizboxId, setBizboxId] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [notifyDeploy, setNotifyDeploy] = useState(true);
  const [reminders, setReminders] = useState<DayReminderConfig[]>(defaultDays);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatMinutes, setRepeatMinutes] = useState('10');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    window.oneApp?.settings.get().then((s) => {
      setBizboxId(s.bizboxId);
      setHasPassword(s.hasPassword);
      setNotifyDeploy(s.notifyDeploy);
      setLoading(false);
    });
    window.oneApp?.attendance.getReminders().then((r) => {
      if (r.days?.length) setReminders(r.days);
      if (r.repeat) {
        setRepeatEnabled(r.repeat.enabled);
        setRepeatMinutes(String(r.repeat.minutes));
      }
    });
  }, []);

  // 특정 요일의 출근/퇴근 슬롯 수정
  const updateSlot = (
    day: number,
    type: 'come' | 'leave',
    patch: Partial<{ enabled: boolean; time: string }>,
  ) => {
    setReminders((prev) =>
      prev.map((d) =>
        d.day === day ? { ...d, [type]: { ...d[type], ...patch } } : d,
      ),
    );
  };

  const save = async () => {
    setStatus('저장 중...');
    const res = await window.oneApp.settings.set({
      bizboxId,
      password,
      notifyDeploy,
    });
    const savedReminders: ReminderConfig =
      await window.oneApp.attendance.setReminders({
        days: reminders,
        repeat: { enabled: repeatEnabled, minutes: Number(repeatMinutes) || 10 },
      });
    setHasPassword(res.hasPassword);
    setNotifyDeploy(res.notifyDeploy);
    if (savedReminders.days?.length) setReminders(savedReminders.days);
    if (savedReminders.repeat) {
      setRepeatEnabled(savedReminders.repeat.enabled);
      setRepeatMinutes(String(savedReminders.repeat.minutes));
    }
    setPassword('');
    setStatus('✅ 저장되었습니다.');
    setTimeout(() => setStatus(''), 2500);
  };

  return (
    <div className="section">
      <SectionHeader
        title="⚙️ 환경설정"
        sub="비즈박스 그룹웨어 로그인 계정 정보 (일정 등록에 사용)"
      />

      <FormRow label="아이디">
        <Input
          type="text"
          value={bizboxId}
          onChange={(e) => setBizboxId(e.target.value)}
          placeholder="비즈박스 아이디"
          disabled={loading}
        />
      </FormRow>

      <FormRow label="비밀번호">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            hasPassword ? '●●●●●●  (저장됨 — 바꿀 때만 입력)' : '비밀번호 입력'
          }
          disabled={loading}
        />
      </FormRow>

      <p className="note">
        🔒 비밀번호는 macOS 키체인으로 <b>암호화</b>되어 이 기기에만 저장됩니다.
        (평문 저장 아님)
      </p>

      <label className="form-label">알림</label>
      <label className="settings__check">
        <input
          type="checkbox"
          checked={notifyDeploy}
          onChange={(e) => setNotifyDeploy(e.target.checked)}
          disabled={loading}
        />
        <span>배포가 끝나면 알림 받기 (성공/실패)</span>
      </label>
      <div className="settings__test-row">
        <Button onClick={() => window.oneApp?.testNotification()}>
          🔔 테스트 알림 보내기
        </Button>
        <span className="hint">알림(알럿)이 어떻게 뜨는지 미리 확인</span>
      </div>

      <label className="form-label">출퇴근 리마인더</label>
      <p className="hint" style={{ marginBottom: 10 }}>
        요일별로 시각을 정하면 그 시각에 알림을 줍니다. 이미 찍었으면 알리지
        않아요. (평일만)
      </p>
      <div className="settings__reminders">
        <div className="settings__rem-head">
          <span />
          <span>출근</span>
          <span>퇴근</span>
        </div>
        {reminders.map((d) => (
          <div key={d.day} className="settings__rem-row">
            <span className="settings__rem-day">{DAY_LABELS[d.day]}</span>
            {(['come', 'leave'] as const).map((type) => (
              <div key={type} className="settings__rem-slot">
                <input
                  type="checkbox"
                  checked={d[type].enabled}
                  onChange={(e) =>
                    updateSlot(d.day, type, { enabled: e.target.checked })
                  }
                  disabled={loading}
                  aria-label={`${DAY_LABELS[d.day]} ${type === 'come' ? '출근' : '퇴근'} 알림 사용`}
                />
                <input
                  type="time"
                  className="settings__time"
                  value={d[type].time}
                  onChange={(e) => updateSlot(d.day, type, { time: e.target.value })}
                  disabled={loading || !d[type].enabled}
                />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="settings__repeat-row">
        <label className="settings__check">
          <input
            type="checkbox"
            checked={repeatEnabled}
            onChange={(e) => setRepeatEnabled(e.target.checked)}
            disabled={loading}
          />
          <span>안 찍었으면</span>
        </label>
        <input
          type="number"
          className="settings__minutes"
          min={1}
          max={120}
          value={repeatMinutes}
          onChange={(e) => setRepeatMinutes(e.target.value)}
          disabled={loading || !repeatEnabled}
          aria-label="반복 알림 간격(분)"
        />
        <span>분마다 계속 알림</span>
      </div>

      <div className="form-actions">
        <Button variant="primary" onClick={save} disabled={loading || !bizboxId}>
          저장
        </Button>
        {status && (
          <span className="hint" style={{ alignSelf: 'center' }}>
            {status}
          </span>
        )}
      </div>
    </div>
  );
}
