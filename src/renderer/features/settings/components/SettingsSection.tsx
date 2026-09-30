import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Checkbox } from '../../../components/Checkbox';
import { Input } from '../../../components/Input';
import { Icon, type IconName } from '../../../components/Icon';
import { Segment } from '../../../components/Segment';
import { Select } from '../../../components/Select';
import { TextLink } from '../../../components/TextLink';
import { TimePicker } from '../../../components/TimePicker';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { AltAccountsCard } from '../../mail';
import { applyThemePref, getThemePref } from '../../../lib/theme';
import {
  NOTIFY_SOUND_DEFAULTS,
  SCHEDULE_START_CONFIG_DEFAULT,
  type NotifySoundKind,
  type ReminderConfig,
  type DayReminderConfig,
  type ScheduleStartConfig,
  type TerminalNotifyLevel,
  type ThemePref,
} from '../../../../shared/types';
import { SettingsPanel } from './SettingsPanel';

const DAY_LABELS: Record<number, string> = {
  1: '월',
  2: '화',
  3: '수',
  4: '목',
  5: '금',
};

// 설정 그룹 — 왼쪽 목록과 오른쪽 패널의 순서가 같다(목업 Settings.dc.html).
// storageKey 는 예전 Collapsible 과 같은 키라 사용자가 접어 둔 상태가 그대로 이어진다.
type GroupId =
  | 'account'
  | 'alt-accounts'
  | 'notify'
  | 'terminal'
  | 'power'
  | 'general'
  | 'integrations'
  | 'reminders'
  | 'schedule';

const GROUPS: {
  id: GroupId;
  label: string;
  icon: IconName;
  defaultOpen?: boolean;
}[] = [
  { id: 'account', label: '비즈박스 계정', icon: 'user' },
  {
    id: 'alt-accounts',
    label: '추가 비즈박스 계정',
    icon: 'user-plus',
    defaultOpen: false,
  },
  { id: 'notify', label: '알림', icon: 'bell' },
  { id: 'terminal', label: '터미널', icon: 'terminal' },
  { id: 'power', label: '전원', icon: 'power' },
  { id: 'general', label: '일반', icon: 'sliders' },
  { id: 'integrations', label: '연동 (Jira · Gitea · 노션)', icon: 'link' },
  { id: 'reminders', label: '출퇴근 리마인더', icon: 'clock' },
  { id: 'schedule', label: '일정 등록', icon: 'calendar' },
];

const groupKey = (id: GroupId) => `settings:group:${id}`;

// 그룹별 열림 상태 — 접힘 여부는 휘발성 UI 상태라 localStorage 로 충분하다
const loadOpenMap = (): Record<GroupId, boolean> =>
  Object.fromEntries(
    GROUPS.map((g) => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(groupKey(g.id));
      } catch {
        /* 저장소를 못 읽으면 기본값 */
      }
      return [g.id, saved === null ? (g.defaultOpen ?? true) : saved === '1'];
    }),
  ) as Record<GroupId, boolean>;

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
  // 계정·연동 조회가 성공했는지 — 실패한 채 [저장] 하면 빈 기본값이 저장된 값을 전부 덮는다
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [approvalDept, setApprovalDept] = useState('');
  const [notifyDeploy, setNotifyDeploy] = useState(true);
  const [notifyMail, setNotifyMail] = useState(true);
  // 잠잘 때 블루투스 끄기 — blueutil 이 있어야 동작하므로 설치 여부를 함께 들고 있는다
  const [sleepBluetoothOff, setSleepBluetoothOff] = useState(false);
  const [hasBlueutil, setHasBlueutil] = useState(true);
  // 알림음 — 선택값(자리별)과 고를 수 있는 음원 목록
  const [sounds, setSounds] = useState<Record<NotifySoundKind, string>>(
    NOTIFY_SOUND_DEFAULTS,
  );
  const [soundNames, setSoundNames] = useState<string[]>([]);
  const [autostart, setAutostart] = useState(false);
  const [theme, setTheme] = useState<ThemePref>(getThemePref); // localStorage 미러로 즉시 표시
  const [jiraUrl, setJiraUrl] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraToken, setJiraToken] = useState('');
  const [hasJiraToken, setHasJiraToken] = useState(false);
  const [giteaUrl, setGiteaUrl] = useState('');
  const [giteaToken, setGiteaToken] = useState('');
  const [hasGiteaToken, setHasGiteaToken] = useState(false);
  const [notionRootUrl, setNotionRootUrl] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [hasNotionToken, setHasNotionToken] = useState(false);
  const [reminders, setReminders] = useState<DayReminderConfig[]>(defaultDays);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatMinutes, setRepeatMinutes] = useState('10');
  const [schedStart, setSchedStart] = useState<ScheduleStartConfig>(
    SCHEDULE_START_CONFIG_DEFAULT,
  );
  const [termNotify, setTermNotify] = useState<TerminalNotifyLevel>('sound');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  // 키체인 암호화 가능 여부 — false 면 비밀이 평문으로 저장되므로 배너로 알린다.
  // 기본값을 true 로 둬야 로딩 중 배너가 깜빡이지 않는다.
  const [secureStorage, setSecureStorage] = useState(true);
  const toast = useToast();
  // 왼쪽 그룹 목록 — 고른 그룹·그룹별 열림 상태·패널 요소(스크롤 대상)
  const [selected, setSelected] = useState<GroupId>('account');
  const [openMap, setOpenMap] = useState(loadOpenMap);
  const panelRefs = useRef<Partial<Record<GroupId, HTMLDetailsElement | null>>>(
    {},
  );

  useEffect(() => {
    // 프리로드가 깨진 비정상 상황 — 옵셔널 체이닝이 체인 전체를 단락시켜 아래
    // finally 도 안 돌므로, 여기서 loading 을 내려야 화면이 잠기지 않는다
    if (!window.oneApp) {
      setLoading(false);
      setLoadError('앱 브리지를 사용할 수 없습니다 — 앱을 다시 시작해 보세요.');
      return;
    }
    window.oneApp.settings
      .get()
      .then((s) => {
        setBizboxId(s.bizboxId);
        setHasPassword(s.hasPassword);
        setApprovalDept(s.approvalDept);
        setNotifyDeploy(s.notifyDeploy);
        setNotifyMail(s.notifyMail);
        setSleepBluetoothOff(s.sleepBluetoothOff);
        setSounds(s.sounds);
        setJiraUrl(s.jiraUrl);
        setJiraEmail(s.jiraEmail);
        setHasJiraToken(s.hasJiraToken);
        setGiteaUrl(s.giteaUrl);
        setHasGiteaToken(s.hasGiteaToken);
        setNotionRootUrl(s.notionRootUrl);
        setHasNotionToken(s.hasNotionToken);
        setSecureStorage(s.secureStorage);
        // 정본(settings.json)과 미러가 어긋나 있으면 정본 기준으로 맞춘다
        setTheme(s.theme);
        applyThemePref(s.theme);
        setSettingsLoaded(true);
      })
      .catch((err) => {
        // 안 잡으면 loading 이 영영 true 라 모든 입력이 조용히 disabled 로 남는다
        setLoadError(errMsg(err, '설정을 불러오지 못했습니다.'));
      })
      .finally(() => setLoading(false));
    // 부가 설정 조회 실패는 기본값으로 두되 조용히 넘기지 않는다 — 이대로 [저장] 하면
    // 기본값이 저장된 값을 덮을 수 있어 사용자가 알아야 한다
    const warn = (what: string) => () =>
      setLoadError(
        (prev) =>
          prev ||
          `${what} 설정을 불러오지 못했습니다. 저장 전에 값을 확인하세요.`,
      );
    // 음원 목록 — 실패해도 선택값은 그대로 두고 드롭다운만 비게 둔다(알림음 자체는 동작한다)
    window.oneApp?.settings.sounds
      .list()
      .then(setSoundNames)
      .catch(() => setSoundNames([]));
    window.oneApp
      ?.getAutostart()
      .then((r) => setAutostart(r.enabled))
      .catch(warn('자동 시작'));
    // 터미널 알림 강도는 [저장] 이 아니라 Segment 변경 즉시 저장이라 "저장 전에 확인"
    // 안내가 어긋난다 — 사용자가 건드리기 전엔 덮어쓸 일도 없으니 문구를 달리 한다
    window.oneApp?.terminal?.notifyLevel
      .get()
      .then(setTermNotify)
      .catch(() =>
        setLoadError(
          (prev) => prev || '터미널 알림 설정을 불러오지 못했습니다.',
        ),
      );
    window.oneApp?.attendance
      .getReminders()
      .then((r) => {
        if (r.days?.length) setReminders(r.days);
        if (r.repeat) {
          setRepeatEnabled(r.repeat.enabled);
          setRepeatMinutes(String(r.repeat.minutes));
        }
      })
      .catch(warn('리마인더'));
    window.oneApp?.schedule
      .getStartConfig()
      .then(setSchedStart)
      .catch(warn('일정 시작'));
    // blueutil 설치 여부 — 브리지가 없는 구 preload·폰 셸에서는 안내를 띄우지 않는다
    // (체크박스만 잠기고 경고가 뜨는 어정쩡한 상태를 피한다)
    const checkBlueutil = window.oneApp?.power?.checkBlueutil;
    if (checkBlueutil) {
      checkBlueutil()
        .then((r) => setHasBlueutil(r.installed))
        .catch(() => setHasBlueutil(true));
    }
  }, []);

  // 음원 드롭다운 옵션 — 목록 조회가 실패해도 **지금 값은 보이게** 합쳐 둔다
  // (빈 목록이면 Select 가 placeholder 만 띄워 마치 설정이 날아간 것처럼 보인다)
  const soundOptions = [
    ...new Set([...soundNames, sounds.mail, sounds.terminalWaiting]),
  ]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));

  // 재택 요일 토글 — 오름차순 유지
  const toggleRemoteDay = (day: number, on: boolean) =>
    setSchedStart((prev) => ({
      ...prev,
      remoteDays: on
        ? [...prev.remoteDays, day].sort((a, b) => a - b)
        : prev.remoteDays.filter((d) => d !== day),
    }));

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

  // 테마는 [저장] 없이 즉시 적용·즉시 저장 (실패해도 화면 적용은 유지 — 다음 변경 때 재시도)
  const changeTheme = (next: ThemePref) => {
    setTheme(next);
    applyThemePref(next);
    window.oneApp?.settings.setTheme(next).catch(() => {
      toast('테마 저장에 실패했습니다', 'fail');
    });
  };

  // 알림음 — 고르는 즉시 들려주고 즉시 저장한다 ([저장] 버튼을 기다리면
  // "소리는 났는데 저장은 안 된" 상태가 된다)
  const changeSound = (kind: NotifySoundKind, name: string) => {
    setSounds((prev) => ({ ...prev, [kind]: name }));
    void window.oneApp?.settings.sounds.preview(name);
    window.oneApp?.settings.sounds.set(kind, name).catch(() => {
      toast('알림음 저장에 실패했습니다', 'fail');
    });
  };

  // 터미널 입력대기 알림 강도 — 테마처럼 즉시 저장
  const changeTermNotify = (next: TerminalNotifyLevel) => {
    setTermNotify(next);
    window.oneApp?.terminal?.notifyLevel.set(next).catch(() => {
      toast('알림 설정 저장에 실패했습니다', 'fail');
    });
  };

  const setGroupOpen = (id: GroupId, open: boolean) => {
    setOpenMap((prev) => ({ ...prev, [id]: open }));
    try {
      localStorage.setItem(groupKey(id), open ? '1' : '0');
    } catch {
      /* 기억 못 해도 화면은 동작한다 */
    }
  };

  // 왼쪽 목록에서 그룹을 고르면 — 접혀 있으면 펼치고, 패널 머리가 본문 위쪽에 오게 스크롤
  const goGroup = (id: GroupId) => {
    setSelected(id);
    if (!openMap[id]) setGroupOpen(id, true);
    // 펼친 높이가 반영된 다음 프레임에 스크롤해야 위치가 맞는다
    requestAnimationFrame(() =>
      panelRefs.current[id]?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      }),
    );
  };

  // 그룹 패널 공통 props
  const panel = (id: GroupId) => ({
    id,
    title: GROUPS.find((g) => g.id === id)?.label ?? id,
    open: openMap[id],
    selected: selected === id,
    onToggle: (open: boolean) => setGroupOpen(id, open),
    onSelect: () => setSelected(id),
    panelRef: (el: HTMLDetailsElement | null) => {
      panelRefs.current[id] = el;
    },
  });

  // 저장은 4개 채널에 나눠 쓴다 — 하나의 catch 로 뭉뚱그리면 중간에 실패했을 때
  // "절반만 저장된" 상태를 알 수 없어, 단계별로 잡아 실패한 항목을 구분해 알린다
  const save = async () => {
    setSaving(true);
    const failed: string[] = [];
    let firstErr: unknown;
    const fail = (what: string, err: unknown) => {
      failed.push(what);
      firstErr ??= err;
    };
    try {
      try {
        const res = await window.oneApp.settings.set({
          bizboxId,
          password,
          approvalDept,
          notifyDeploy,
          notifyMail,
          sleepBluetoothOff,
          jiraUrl,
          jiraEmail,
          jiraToken,
          giteaUrl,
          giteaToken,
          notionRootUrl,
          notionToken,
        });
        setHasPassword(res.hasPassword);
        setNotifyDeploy(res.notifyDeploy);
        setNotifyMail(res.notifyMail);
        setSleepBluetoothOff(res.sleepBluetoothOff);
        setJiraUrl(res.jiraUrl);
        setJiraEmail(res.jiraEmail);
        setHasJiraToken(res.hasJiraToken);
        setJiraToken('');
        setGiteaUrl(res.giteaUrl);
        setHasGiteaToken(res.hasGiteaToken);
        setGiteaToken('');
        setNotionRootUrl(res.notionRootUrl);
        setHasNotionToken(res.hasNotionToken);
        setSecureStorage(res.secureStorage);
        setNotionToken('');
        setPassword('');
      } catch (err) {
        fail('계정·연동', err);
      }
      try {
        const savedReminders: ReminderConfig =
          await window.oneApp.attendance.setReminders({
            days: reminders,
            repeat: {
              enabled: repeatEnabled,
              minutes: Number(repeatMinutes) || 10,
            },
          });
        if (savedReminders.days?.length) setReminders(savedReminders.days);
        if (savedReminders.repeat) {
          setRepeatEnabled(savedReminders.repeat.enabled);
          setRepeatMinutes(String(savedReminders.repeat.minutes));
        }
      } catch (err) {
        fail('리마인더', err);
      }
      try {
        setSchedStart(await window.oneApp.schedule.setStartConfig(schedStart));
      } catch (err) {
        fail('일정 시작', err);
      }
      try {
        const auto = await window.oneApp.setAutostart(autostart);
        setAutostart(auto.enabled);
      } catch (err) {
        fail('자동 시작', err);
      }
      if (failed.length === 0) toast('저장되었습니다');
      else {
        // 4 = 저장 채널 수(계정·연동 / 리마인더 / 일정 시작 / 자동 시작)
        const label =
          failed.length === 4
            ? '저장 실패'
            : `일부 저장 실패 (${failed.join('·')})`;
        toast(`${label} — ${errMsg(firstErr, '다시 시도해 주세요.')}`, 'fail');
      }
    } finally {
      setSaving(false);
    }
  };

  // 목업 Settings·SettingsAccount·SettingsMore — 왼쪽 그룹 목록(224) · 가운데 패널 열(max 760, 스크롤) ·
  // 아래 저장 바(56). 입력칸 설명(settings__hint--indent)은 라벨 열(112 + 간격 16)만큼 들여쓴다.
  return (
    <div className="section settings">
      <nav className="settings__nav" aria-label="설정 그룹">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={
              'settings__nav-item' +
              (selected === g.id ? ' settings__nav-item--on' : '')
            }
            aria-current={selected === g.id ? 'true' : undefined}
            onClick={() => goGroup(g.id)}
          >
            <Icon name={g.icon} size={14} />
            <span className="settings__nav-label">{g.label}</span>
          </button>
        ))}
      </nav>

      <div className="settings__main">
        <div className="settings__scroll">
          {/* 키체인을 못 쓰는 상태 — 비밀 값 저장이 거부된다(평문으로 떨어뜨리지 않는다).
              서명이 깨졌거나 키체인이 잠긴 경우다(정상 환경에선 이 배너가 뜨지 않는다) */}
          {!secureStorage && (
            <div className="settings__banner">
              <Banner variant="danger">
                OS 키체인을 쓸 수 없어{' '}
                <strong>비밀번호·API 토큰을 저장할 수 없습니다</strong> — 앱
                서명이 깨졌거나 키체인이 잠겨 있을 수 있습니다. 앱을 다시
                설치하거나 키체인 잠금을 해제한 뒤 비밀 값을 다시 저장하세요.
              </Banner>
            </div>
          )}

          {loadError && (
            <div className="settings__banner">
              <Banner variant="warning">{loadError}</Banner>
            </div>
          )}

          <SettingsPanel {...panel('account')}>
            <p className="hint">
              그룹웨어 로그인 계정 — 일정 등록 · 출퇴근 · 주간보고에 공용으로
              사용됩니다.
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="st-bizbox-id">
                아이디
              </label>
              <Input
                id="st-bizbox-id"
                type="text"
                value={bizboxId}
                onChange={(e) => setBizboxId(e.target.value)}
                placeholder="비즈박스 아이디"
                disabled={loading}
              />
              <label className="settings__label" htmlFor="st-bizbox-pw">
                비밀번호
              </label>
              <Input
                id="st-bizbox-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  hasPassword
                    ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
                    : '비밀번호 입력'
                }
                disabled={loading}
              />
            </div>
            <p className="hint settings__hint--indent">
              비밀번호는 macOS 키체인으로 <b>암호화</b>되어 이 기기에만
              저장됩니다. (평문 저장 아님)
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="st-dept">
                결재 소속
              </label>
              <Input
                id="st-dept"
                type="text"
                value={approvalDept}
                onChange={(e) => setApprovalDept(e.target.value)}
                placeholder="예: FE챕터 플랫폼기술부문"
                disabled={loading}
              />
            </div>
            <p className="hint settings__hint--indent">
              야근 결재 근무자 표의 &apos;소속&apos; 칸과 휴가신청서 제목에{' '}
              <b>그대로</b> 들어갑니다(제목에서는 공백이 밑줄로 바뀝니다). 비워
              두면 야근·휴가 결재를 시작할 수 없습니다.
            </p>
          </SettingsPanel>

          {/* 추가 계정(팀 공용 등) — 본문은 mail 기능이 공개 API 로 제공한다 */}
          <SettingsPanel {...panel('alt-accounts')}>
            <AltAccountsCard />
          </SettingsPanel>

          <SettingsPanel {...panel('notify')}>
            <Checkbox
              checked={notifyDeploy}
              onChange={(e) => setNotifyDeploy(e.target.checked)}
              disabled={loading}
              label="배포가 끝나면 알림 받기 (성공/실패)"
            />
            <Checkbox
              checked={notifyMail}
              onChange={(e) => setNotifyMail(e.target.checked)}
              disabled={loading}
              label="새 메일이 오면 소리로 알리기"
            />
            <div className="settings__grid">
              <span className="settings__label">메일 알림음</span>
              <div>
                <Select
                  small
                  className="settings__sound"
                  options={soundOptions}
                  value={sounds.mail}
                  onChange={(v) => changeSound('mail', v)}
                  disabled={loading || !notifyMail}
                  aria-label="새 메일 알림음"
                />
              </div>
            </div>
            <p className="hint">
              안읽은 메일 수가 늘면 알림음이 한 번 울립니다 — 메일함을 열어 둔
              채 읽을 때는 울리지 않고, 앱을 켤 때 쌓여 있던 메일에도 울리지
              않습니다. (알림음은 즉시 저장)
            </p>
            <div className="settings__test-row">
              <Button
                size="xs"
                onClick={() => window.oneApp?.testNotification()}
              >
                테스트 알림 보내기
              </Button>
              <span className="hint">알림(알럿)이 어떻게 뜨는지 미리 확인</span>
            </div>
          </SettingsPanel>

          <SettingsPanel {...panel('terminal')}>
            <div className="settings__grid">
              <span className="settings__label">입력대기 알림</span>
              <div>
                <Segment
                  options={[
                    { value: 'badge', label: '뱃지만' },
                    { value: 'sound', label: '뱃지+소리' },
                    { value: 'alert', label: '뱃지+알럿' },
                  ]}
                  value={termNotify}
                  onChange={changeTermNotify}
                />
              </div>
              <span className="settings__label">알림음</span>
              <div>
                <Select
                  small
                  className="settings__sound"
                  options={soundOptions}
                  value={sounds.terminalWaiting}
                  onChange={(v) => changeSound('terminalWaiting', v)}
                  disabled={loading || termNotify === 'badge'}
                  aria-label="터미널 입력대기 알림음"
                />
              </div>
            </div>
            <p className="hint">
              에이전트(claude 등)가 작업을 마치고 입력을 기다리면
              사이드바·독(Dock) 뱃지로 표시됩니다 — 소리나 알럿을 더할지
              선택하세요. (즉시 저장)
            </p>
          </SettingsPanel>

          <SettingsPanel {...panel('power')}>
            <Checkbox
              checked={sleepBluetoothOff}
              onChange={(e) => setSleepBluetoothOff(e.target.checked)}
              disabled={loading || !hasBlueutil}
              label="잠잘 때 블루투스 끄기"
            />
            {!hasBlueutil && (
              <Banner variant="warning">
                blueutil 이 필요합니다 — 터미널에서{' '}
                <code>brew install blueutil</code> 를 실행한 뒤 앱을 다시
                시작하세요.
              </Banner>
            )}
            <p className="hint">
              <b>덮개를 닫고 · 외부 모니터도 없고 · 배터리로만</b> 있을 때(=
              가방 안)에만 끕니다. 깨어나면 다시 켜고, 원래 꺼져 있었다면
              건드리지 않습니다. 책상에서 외부 모니터를 연결한 채 덮개를 닫고
              쓰는 중에는 동작하지 않습니다 — 블루투스 키보드·마우스로 맥을 깨울
              수 없게 되기 때문입니다.
            </p>
          </SettingsPanel>

          <SettingsPanel {...panel('general')}>
            <div className="settings__grid settings__grid--loose">
              <span className="settings__label">테마</span>
              <div>
                <Segment
                  options={[
                    { value: 'system', label: '시스템' },
                    { value: 'light', label: '라이트' },
                    { value: 'dark', label: '다크' },
                  ]}
                  value={theme}
                  onChange={changeTheme}
                />
              </div>
            </div>
            <Checkbox
              checked={autostart}
              onChange={(e) => setAutostart(e.target.checked)}
              disabled={loading}
              label="로그인 시 One App 자동 시작"
            />
            <p className="hint">
              창을 닫아도 앱은 계속 실행되고, Dock 아이콘을 누르면 다시
              열립니다. (자동 시작은 패키징된 앱에서 동작)
            </p>
          </SettingsPanel>

          <SettingsPanel {...panel('integrations')}>
            <p className="hint">
              배포 커밋 내역의 이슈 키·커밋 해시 링크화와 배포 전 커밋
              미리보기에 사용됩니다. 비워두면 해당 기능만 꺼집니다.
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="st-jira-url">
                Jira 주소
              </label>
              <Input
                id="st-jira-url"
                type="text"
                value={jiraUrl}
                onChange={(e) => setJiraUrl(e.target.value)}
                placeholder="예: https://forbizkorea.atlassian.net"
                disabled={loading}
              />
              {/* http 는 막지 않지만(온프렘 서버가 있을 수 있다) 토큰이 평문으로 나간다는 것은 알린다 */}
              {/^http:\/\//i.test(jiraUrl.trim()) && (
                <p className="hint settings__grid-note">
                  <b>http</b> 주소입니다 — Jira 인증 정보(이메일·API 토큰)가{' '}
                  <b>암호화 없이</b> 전송됩니다. 가능하면 https 주소를 쓰세요.
                </p>
              )}
              <label className="settings__label" htmlFor="st-jira-email">
                Jira 이메일
              </label>
              <Input
                id="st-jira-email"
                type="text"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="Jira 로그인 이메일 (내 이슈 조회용)"
                disabled={loading}
              />
              <label className="settings__label" htmlFor="st-jira-token">
                Jira 토큰
              </label>
              <Input
                id="st-jira-token"
                type="password"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                placeholder={
                  hasJiraToken
                    ? 'API 토큰 (저장됨 — 바꿀 때만 입력)'
                    : 'API 토큰'
                }
                disabled={loading}
              />
            </div>
            <p className="hint settings__hint--indent">
              Jira 이메일·토큰은 [Jira] 탭의 내 이슈 조회에 사용됩니다. 토큰은{' '}
              <TextLink
                small
                external
                onClick={() =>
                  void window.oneApp.openExternal(
                    'https://id.atlassian.com/manage-profile/security/api-tokens',
                  )
                }
              >
                Atlassian API tokens
              </TextLink>
              에서 발급하세요.
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="st-gitea-url">
                Gitea 주소
              </label>
              <Input
                id="st-gitea-url"
                className="settings__mono"
                type="text"
                value={giteaUrl}
                onChange={(e) => setGiteaUrl(e.target.value)}
                placeholder="http://3.36.200.205"
                disabled={loading}
              />
              <label className="settings__label" htmlFor="st-gitea-token">
                Gitea 토큰
              </label>
              <Input
                id="st-gitea-token"
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
            </div>
            <p className="hint settings__hint--indent">
              Gitea 토큰은 익명 조회가 되는 서버라면 비워둬도 됩니다.
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="st-notion-url">
                노션 페이지
              </label>
              <Input
                id="st-notion-url"
                type="text"
                value={notionRootUrl}
                onChange={(e) => setNotionRootUrl(e.target.value)}
                placeholder="투입시간 루트 페이지 URL (일정 노션 기록용)"
                disabled={loading}
              />
              <label className="settings__label" htmlFor="st-notion-token">
                노션 토큰
              </label>
              <Input
                id="st-notion-token"
                type="password"
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                placeholder={
                  hasNotionToken
                    ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
                    : '개인 액세스 토큰 (ntn_…)'
                }
                disabled={loading}
              />
            </div>
            <p className="hint settings__hint--indent">
              [일정 등록]의 [노션에 기록]이 사용합니다. 토큰은{' '}
              <TextLink
                small
                external
                onClick={() =>
                  void window.oneApp.openExternal(
                    'https://www.notion.so/my-integrations',
                  )
                }
              >
                노션 개인 액세스 토큰
              </TextLink>
              에서 발급하고, 노션의 <b>루트 페이지 → ⋯ → 연결</b>에 그 토큰을
              추가해야 하위 페이지까지 접근됩니다.
            </p>
            <div className="settings__secure">
              <Icon name="lock" size={14} />
              <span>
                모든 토큰은 macOS 키체인으로 <b>암호화</b>되어 이 기기에만
                저장됩니다.
              </span>
            </div>
          </SettingsPanel>

          <SettingsPanel {...panel('reminders')}>
            <p className="hint">
              요일별로 시각을 정하면 그 시각에 알림을 줍니다. 이미 찍었으면
              알리지 않아요. (평일만)
            </p>
            <div className="settings__reminders">
              <span />
              <span className="settings__rem-head">출근</span>
              <span className="settings__rem-head">퇴근</span>
              {reminders.map((d) => (
                <div key={d.day} className="settings__rem-row">
                  <span className="settings__label">{DAY_LABELS[d.day]}</span>
                  {(['come', 'leave'] as const).map((type) => (
                    <div key={type} className="settings__rem-slot">
                      <Checkbox
                        checked={d[type].enabled}
                        onChange={(e) =>
                          updateSlot(d.day, type, { enabled: e.target.checked })
                        }
                        disabled={loading}
                        aria-label={`${DAY_LABELS[d.day]} ${type === 'come' ? '출근' : '퇴근'} 알림 사용`}
                      />
                      <span className="settings__time">
                        <TimePicker
                          small
                          adorn="clock-end"
                          step={5}
                          value={d[type].time}
                          onChange={(time) => updateSlot(d.day, type, { time })}
                          disabled={loading || !d[type].enabled}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="settings__repeat-row">
              <Checkbox
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
                disabled={loading}
                label="안 찍었으면"
              />
              <Input
                small
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
          </SettingsPanel>

          <SettingsPanel {...panel('schedule')}>
            <p className="hint">
              요일별 기준 시작 시각 — [일정 등록] 실행 시 시작 시각이 기준과
              다르면 한 번 더 확인합니다.
            </p>
            <div className="settings__grid">
              <span className="settings__label">재택 요일</span>
              <div className="settings__days-row">
                {[1, 2, 3, 4, 5].map((day) => (
                  <Checkbox
                    key={day}
                    checked={schedStart.remoteDays.includes(day)}
                    onChange={(e) => toggleRemoteDay(day, e.target.checked)}
                    disabled={loading}
                    label={DAY_LABELS[day]}
                  />
                ))}
              </div>
              <span className="settings__label">재택 시작</span>
              <span className="settings__time">
                <TimePicker
                  small
                  adorn="clock-end"
                  value={schedStart.remoteStart}
                  onChange={(remoteStart) =>
                    setSchedStart((prev) => ({ ...prev, remoteStart }))
                  }
                  disabled={loading}
                />
              </span>
              <span className="settings__label">출근 시작</span>
              <span className="settings__time">
                <TimePicker
                  small
                  adorn="clock-end"
                  value={schedStart.officeStart}
                  onChange={(officeStart) =>
                    setSchedStart((prev) => ({ ...prev, officeStart }))
                  }
                  disabled={loading}
                />
              </span>
            </div>
          </SettingsPanel>
        </div>

        <div className="settings__bar">
          <Button
            variant="primary"
            onClick={save}
            loading={saving}
            disabled={loading || !settingsLoaded}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}
