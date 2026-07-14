import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Collapsible } from '../../../components/Collapsible';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
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
  const [notifyPr, setNotifyPr] = useState(true);
  const [autostart, setAutostart] = useState(false);
  const [jiraUrl, setJiraUrl] = useState('');
  const [giteaUrl, setGiteaUrl] = useState('');
  const [giteaToken, setGiteaToken] = useState('');
  const [hasGiteaToken, setHasGiteaToken] = useState(false);
  const [reminders, setReminders] = useState<DayReminderConfig[]>(defaultDays);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatMinutes, setRepeatMinutes] = useState('10');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    window.oneApp?.settings.get().then((s) => {
      setBizboxId(s.bizboxId);
      setHasPassword(s.hasPassword);
      setNotifyDeploy(s.notifyDeploy);
      setNotifyPr(s.notifyPr);
      setJiraUrl(s.jiraUrl);
      setGiteaUrl(s.giteaUrl);
      setHasGiteaToken(s.hasGiteaToken);
      setLoading(false);
    });
    window.oneApp?.getAutostart().then((r) => setAutostart(r.enabled));
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
    setSaving(true);
    try {
      const res = await window.oneApp.settings.set({
        bizboxId,
        password,
        notifyDeploy,
        notifyPr,
        jiraUrl,
        giteaUrl,
        giteaToken,
      });
      const savedReminders: ReminderConfig =
        await window.oneApp.attendance.setReminders({
          days: reminders,
          repeat: {
            enabled: repeatEnabled,
            minutes: Number(repeatMinutes) || 10,
          },
        });
      const auto = await window.oneApp.setAutostart(autostart);
      setAutostart(auto.enabled);
      setHasPassword(res.hasPassword);
      setNotifyDeploy(res.notifyDeploy);
      setNotifyPr(res.notifyPr);
      setJiraUrl(res.jiraUrl);
      setGiteaUrl(res.giteaUrl);
      setHasGiteaToken(res.hasGiteaToken);
      setGiteaToken('');
      if (savedReminders.days?.length) setReminders(savedReminders.days);
      if (savedReminders.repeat) {
        setRepeatEnabled(savedReminders.repeat.enabled);
        setRepeatMinutes(String(savedReminders.repeat.minutes));
      }
      setPassword('');
      toast('저장되었습니다');
    } catch {
      // IPC/파일 쓰기 실패 시 침묵하지 않고 알린다
      toast('저장에 실패했습니다. 다시 시도해 주세요.', 'fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section">
      <SectionHeader
        title="환경설정"
        icon={<Icon name="settings" size={18} />}
        sub="계정 · 알림 · 출퇴근 리마인더를 관리합니다."
      />

      <Collapsible
        title="비즈박스 계정"
        icon={<Icon name="key" size={14} />}
        storageKey="settings:group:account"
      >
        <p className="hint settings__group-desc">
          그룹웨어 로그인 계정 — 일정 등록 · 출퇴근 · 주간보고에 공용으로
          사용됩니다.
        </p>
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
          비밀번호는 macOS 키체인으로 <b>암호화</b>되어 이 기기에만 저장됩니다.
          (평문 저장 아님)
        </p>
      </Collapsible>

      <Collapsible
        title="알림"
        icon={<Icon name="bell" size={14} />}
        storageKey="settings:group:notify"
      >
        <label className="settings__check">
          <input
            type="checkbox"
            checked={notifyDeploy}
            onChange={(e) => setNotifyDeploy(e.target.checked)}
            disabled={loading}
          />
          <span>배포가 끝나면 알림 받기 (성공/실패)</span>
        </label>
        <label className="settings__check">
          <input
            type="checkbox"
            checked={notifyPr}
            onChange={(e) => setNotifyPr(e.target.checked)}
            disabled={loading}
          />
          <span>새 PR 이 올라오면 알림 받기 (Gitea 주소 설정 시, 5분 간격 확인)</span>
        </label>
        <div className="settings__test-row">
          <Button size="sm" onClick={() => window.oneApp?.testNotification()}>
            테스트 알림 보내기
          </Button>
          <span className="hint">알림(알럿)이 어떻게 뜨는지 미리 확인</span>
        </div>
      </Collapsible>

      <Collapsible
        title="일반"
        icon={<Icon name="settings" size={14} />}
        storageKey="settings:group:general"
      >
        <label className="settings__check">
          <input
            type="checkbox"
            checked={autostart}
            onChange={(e) => setAutostart(e.target.checked)}
            disabled={loading}
          />
          <span>로그인 시 One App 자동 시작</span>
        </label>
        <p className="note">
          메뉴바 아이콘은 항상 표시됩니다 — 창을 닫아도 메뉴바에서 열기·출퇴근
          찍기를 할 수 있어요. (자동 시작은 패키징된 앱에서 동작)
        </p>
      </Collapsible>

      <Collapsible
        title="연동 (Jira · Gitea)"
        icon={<Icon name="building" size={14} />}
        storageKey="settings:group:integrations"
      >
        <p className="hint settings__group-desc">
          배포 커밋 내역의 이슈 키·커밋 해시 링크화와 배포 전 커밋 미리보기에
          사용됩니다. 비워두면 해당 기능만 꺼집니다.
        </p>
        <FormRow label="Jira 주소">
          <Input
            type="text"
            value={jiraUrl}
            onChange={(e) => setJiraUrl(e.target.value)}
            placeholder="예: https://myteam.atlassian.net"
            disabled={loading}
          />
        </FormRow>
        <FormRow label="Gitea 주소">
          <Input
            type="text"
            value={giteaUrl}
            onChange={(e) => setGiteaUrl(e.target.value)}
            placeholder="예: http://3.36.200.205"
            disabled={loading}
          />
        </FormRow>
        <FormRow label="Gitea 토큰">
          <Input
            type="password"
            value={giteaToken}
            onChange={(e) => setGiteaToken(e.target.value)}
            placeholder={
              hasGiteaToken
                ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
                : '(선택) 비공개 저장소 조회용'
            }
            disabled={loading}
          />
        </FormRow>
        <p className="note">
          토큰은 macOS 키체인으로 <b>암호화</b>되어 이 기기에만 저장됩니다.
          익명 조회가 되는 서버라면 비워둬도 됩니다.
        </p>
      </Collapsible>

      <Collapsible
        title="출퇴근 리마인더"
        icon={<Icon name="clock" size={14} />}
        storageKey="settings:group:reminders"
      >
        <p className="hint settings__group-desc">
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
                    onChange={(e) =>
                      updateSlot(d.day, type, { time: e.target.value })
                    }
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
      </Collapsible>

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={save}
          loading={saving}
          disabled={loading || !bizboxId}
        >
          저장
        </Button>
      </div>
    </div>
  );
}
