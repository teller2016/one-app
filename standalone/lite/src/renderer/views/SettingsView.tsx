import { useRef, useState } from 'react';
import type { AppSettingsView, ThemePref } from '@one/shared/types';
import type { UpdateInfo } from '../../shared/update';
import { Banner } from '@one/renderer/components/Banner';
import { Button } from '@one/renderer/components/Button';
import { Icon, type IconName } from '@one/renderer/components/Icon';
import { Input } from '@one/renderer/components/Input';
import { Segment } from '@one/renderer/components/Segment';
import { TextLink } from '@one/renderer/components/TextLink';
import { useToast } from '@one/renderer/components/Toast';
import { errMsg } from '@one/renderer/lib/errMsg';
import { applyThemePref, getThemePref } from '@one/renderer/lib/theme';
// ⚠️ settings 는 공개 API(index.ts)가 SettingsSection 을 함께 내보내고, 그 파일은 이 앱에 없는 채널을
// 쓰므로 패널 컴포넌트 파일만 직접 가져온다 (JiraReportPanel 과 같은 이유)
import { SettingsPanel } from '@one/renderer/features/settings/components/SettingsPanel';

type GroupId = 'account' | 'jira' | 'general' | 'version';

/** 왼쪽 그룹 목록 — 본체 환경설정과 같은 배치·아이콘 */
const GROUPS: { id: GroupId; label: string; icon: IconName }[] = [
  { id: 'account', label: '비즈박스 계정', icon: 'user' },
  { id: 'jira', label: 'Jira 연동 (티켓 보고)', icon: 'link' },
  { id: 'general', label: '일반', icon: 'sliders' },
  { id: 'version', label: '버전', icon: 'info' },
];

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/**
 * 환경설정 — 본체 환경설정 중 이 앱이 쓰는 것만: 비즈박스 계정·결재 소속 · Jira 연동 · 테마 · 버전.
 * 배치도 본체와 같다 — 왼쪽 그룹 목록 · 가운데 패널 열(스크롤) · 아래 저장 바 (본체 `_settings.scss`).
 * 저장 채널은 본체와 같은 `settings:set` 이라 저장 형식(settings.json)도 본체와 같다.
 * 계정이 없으면 첫 실행 때 여기부터 시작한다(취소 없음).
 */
export function SettingsView({
  settings,
  update,
  onUpdateInfo,
  onInstall,
  installing,
  onSaved,
  onCancel,
}: {
  settings: AppSettingsView;
  /** 새 버전 확인 결과 — 셸이 시작할 때 받아둔 값. current(현재 버전)는 실패해도 들어 있다 */
  update: UpdateInfo | null;
  /** 여기서 다시 확인한 결과를 셸에 돌려준다 — 배너와 같은 상태를 보게 */
  onUpdateInfo: (info: UpdateInfo) => void;
  /** 앱 안에서 받아 교체·재시작 (셸이 확인 다이얼로그까지 처리한다) */
  onInstall: () => void;
  installing: boolean;
  onSaved: (next: AppSettingsView) => void;
  onCancel: (() => void) | null;
}) {
  const [bizboxId, setBizboxId] = useState(settings.bizboxId);
  const [password, setPassword] = useState('');
  const [approvalDept, setApprovalDept] = useState(settings.approvalDept);
  const [jiraUrl, setJiraUrl] = useState(settings.jiraUrl);
  const [jiraEmail, setJiraEmail] = useState(settings.jiraEmail);
  const [jiraToken, setJiraToken] = useState('');
  const [theme, setTheme] = useState<ThemePref>(getThemePref); // localStorage 미러로 즉시 표시
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // 수동 업데이트 확인 — 셸이 시작할 때 이미 한 번 보지만, 여기서 직접 다시 볼 수 있다.
  // 시작 때의 실패는 조용히 넘기고, 사용자가 직접 눌렀을 때만 실패 사유를 보여준다.
  const [checking, setChecking] = useState(false);
  const [manual, setManual] = useState(false);
  const toast = useToast();
  // 왼쪽 그룹 목록 — 고른 그룹·그룹별 열림(휘발성 — 매번 기본값)·패널 요소(스크롤 대상)
  const [selected, setSelected] = useState<GroupId>('account');
  const [openMap, setOpenMap] = useState<Record<GroupId, boolean>>({
    account: true,
    jira: true,
    general: true,
    version: false,
  });
  const panelRefs = useRef<Partial<Record<GroupId, HTMLDetailsElement | null>>>({});

  // 목록에서 고르면 접힌 그룹은 펼치고 스크롤한다 — 접혀 있었으면 펼침 애니메이션(--dur-3 .28s)
  // 뒤에 재야 목록 끝 그룹(버전)이 화면 밖에 남지 않는다 (본체 환경설정과 같은 처리)
  const goGroup = (id: GroupId) => {
    setSelected(id);
    const wasOpen = openMap[id];
    if (!wasOpen) setOpenMap((m) => ({ ...m, [id]: true }));
    const scroll = () =>
      panelRefs.current[id]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (wasOpen) requestAnimationFrame(scroll);
    else window.setTimeout(scroll, 300);
  };

  const panel = (id: GroupId) => ({
    id,
    title: GROUPS.find((g) => g.id === id)?.label ?? id,
    open: openMap[id],
    selected: selected === id,
    onToggle: (open: boolean) => setOpenMap((m) => ({ ...m, [id]: open })),
    onSelect: () => setSelected(id),
    panelRef: (el: HTMLDetailsElement | null) => {
      panelRefs.current[id] = el;
    },
  });

  const checkUpdate = async () => {
    setChecking(true);
    try {
      onUpdateInfo(await window.oneApp.update.check());
    } catch (e) {
      onUpdateInfo({
        ok: false,
        current: update?.current ?? '',
        url: '',
        error: errMsg(e, '확인에 실패했습니다.'),
      });
    } finally {
      setChecking(false);
      setManual(true);
    }
  };

  // 테마는 [저장] 없이 즉시 적용·저장 (본체 환경설정과 같은 동작)
  const changeTheme = (next: ThemePref) => {
    setTheme(next);
    applyThemePref(next);
    void window.oneApp.settings.setTheme(next).catch(() => undefined);
  };

  const save = async () => {
    if (!bizboxId.trim()) {
      setError('사번(ID)을 입력하세요.');
      return;
    }
    if (!settings.hasPassword && !password) {
      setError('비밀번호를 입력하세요.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const next = await window.oneApp.settings.set({
        bizboxId: bizboxId.trim(),
        password: password || undefined, // 빈 값이면 기존 유지
        approvalDept,
        jiraUrl,
        jiraEmail,
        jiraToken: jiraToken || undefined, // 빈 값이면 기존 유지
      });
      setPassword('');
      setJiraToken('');
      toast('저장했습니다');
      onSaved(next);
    } catch (e) {
      setError(errMsg(e, '저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section settings">
      <nav className="settings__nav" aria-label="설정 그룹">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={'settings__nav-item' + (selected === g.id ? ' settings__nav-item--on' : '')}
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
          {!settings.hasPassword && (
            <div className="settings__banner">
              <Banner variant="info">
                그룹웨어(gw.forbiz.co.kr) 로그인에 쓰는 사번·비밀번호를 먼저 저장하세요.
              </Banner>
            </div>
          )}
          {!settings.secureStorage && (
            <div className="settings__banner">
              <Banner variant="danger">
                이 PC 에서는 OS 보안 저장소(키체인)를 쓸 수 없어 <b>비밀번호·토큰을 저장할 수
                없습니다</b> — 평문으로 남기지 않기 위해 저장을 막습니다. 키체인 잠금을 해제하거나
                앱을 다시 설치한 뒤 시도하세요.
              </Banner>
            </div>
          )}
          {error && (
            <div className="settings__banner">
              <Banner variant="danger">{error}</Banner>
            </div>
          )}

          <SettingsPanel {...panel('account')}>
            <p className="hint">
              그룹웨어 로그인 계정 — 비밀번호는 이 PC 에만 암호화 저장됩니다.
            </p>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="lt-bizbox-id">
                사번(ID)
              </label>
              <Input
                id="lt-bizbox-id"
                value={bizboxId}
                onChange={(e) => setBizboxId(e.target.value)}
                placeholder="그룹웨어 로그인 ID"
                disabled={saving}
              />
              <label className="settings__label" htmlFor="lt-bizbox-pw">
                비밀번호
              </label>
              <Input
                id="lt-bizbox-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  settings.hasPassword ? '저장됨 — 변경할 때만 입력' : '그룹웨어 비밀번호'
                }
                disabled={saving}
              />
              <label className="settings__label" htmlFor="lt-dept">
                결재 소속
              </label>
              <Input
                id="lt-dept"
                value={approvalDept}
                onChange={(e) => setApprovalDept(e.target.value)}
                placeholder="예: FE챕터 플랫폼기술부문"
                disabled={saving}
              />
            </div>
            <p className="hint settings__hint--indent">
              야근 결재 근무자 표의 &apos;소속&apos; 칸과 휴가신청서 제목에 <b>그대로</b>{' '}
              들어갑니다(제목에서는 공백이 밑줄로 바뀝니다). 비워 두면 야근·휴가 결재를 시작할 수
              없습니다.
            </p>
          </SettingsPanel>

          <SettingsPanel {...panel('jira')}>
            <div className="settings__grid">
              <label className="settings__label" htmlFor="lt-jira-url">
                Jira 주소
              </label>
              <Input
                id="lt-jira-url"
                value={jiraUrl}
                onChange={(e) => setJiraUrl(e.target.value)}
                placeholder="예: https://forbizkorea.atlassian.net"
                disabled={saving}
              />
              {/* http 는 막지 않지만(온프렘 서버가 있을 수 있다) 토큰이 평문으로 나간다는 것은 알린다 */}
              {/^http:\/\//i.test(jiraUrl.trim()) && (
                <p className="hint settings__grid-note">
                  <b>http</b> 주소입니다 — 이메일·API 토큰이 <b>암호화 없이</b> 전송됩니다.
                  가능하면 https 주소를 쓰세요.
                </p>
              )}
              <label className="settings__label" htmlFor="lt-jira-email">
                이메일
              </label>
              <Input
                id="lt-jira-email"
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="Jira 로그인 이메일"
                disabled={saving}
              />
              <label className="settings__label" htmlFor="lt-jira-token">
                API 토큰
              </label>
              <Input
                id="lt-jira-token"
                type="password"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                placeholder={
                  settings.hasJiraToken ? '저장됨 — 변경할 때만 입력' : 'Atlassian API 토큰'
                }
                disabled={saving}
              />
            </div>
            <p className="hint settings__hint--indent">
              토큰은{' '}
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
              에서 발급하세요. 주소·이메일·토큰 셋 다 있어야 티켓 보고가 동작합니다.
            </p>
          </SettingsPanel>

          <SettingsPanel {...panel('general')}>
            <div className="settings__grid settings__grid--loose">
              <span className="settings__label">테마</span>
              <div>
                <Segment<ThemePref> options={THEMES} value={theme} onChange={changeTheme} />
              </div>
            </div>
          </SettingsPanel>

          {/* 새 버전이 있으면 앱 안에서 받아 교체한다(셸 배너와 같은 동작) — 안 되는 위치면 릴리스 페이지 */}
          <SettingsPanel {...panel('version')}>
            <div className="settings__grid">
              <span className="settings__label">현재 버전</span>
              <div className="settings-version">
                <span className="settings-version__value">{update?.current || '—'}</span>
                <Button
                  size="xs"
                  onClick={() => void checkUpdate()}
                  loading={checking}
                  disabled={installing}
                >
                  업데이트 확인
                </Button>
              </div>
            </div>
            {update && (update.ok || manual) && (
              <p className="hint settings__hint--indent">
                {!update.ok ? (
                  update.error
                ) : update.hasUpdate ? (
                  <>
                    새 버전 <b>{update.latest}</b> 이 있습니다 —{' '}
                    {update.canInstall ? (
                      <TextLink small onClick={onInstall} disabled={installing}>
                        {installing ? '설치 중…' : '지금 업데이트'}
                      </TextLink>
                    ) : (
                      <>
                        <TextLink
                          small
                          external
                          onClick={() => void window.oneApp.openExternal(update.url)}
                        >
                          받으러 가기
                        </TextLink>
                        {update.installBlocked && <> ({update.installBlocked})</>}
                      </>
                    )}
                    . 설정과 계정은 그대로 유지됩니다.
                  </>
                ) : (
                  '최신 버전을 쓰고 있습니다.'
                )}
              </p>
            )}
          </SettingsPanel>
        </div>

        <div className="settings__bar">
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            저장
          </Button>
          {onCancel && (
            <Button onClick={onCancel} disabled={saving}>
              취소
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
