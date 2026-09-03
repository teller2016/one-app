import { useState } from 'react';
import type { AppSettingsView, ThemePref } from '@one/shared/types';
import type { UpdateInfo } from '../../shared/update';
import { Banner } from '@one/renderer/components/Banner';
import { Button } from '@one/renderer/components/Button';
import { Collapsible } from '@one/renderer/components/Collapsible';
import { FormRow } from '@one/renderer/components/FormRow';
import { Icon } from '@one/renderer/components/Icon';
import { Input } from '@one/renderer/components/Input';
import { SectionHeader } from '@one/renderer/components/SectionHeader';
import { Segment } from '@one/renderer/components/Segment';
import { TextLink } from '@one/renderer/components/TextLink';
import { useToast } from '@one/renderer/components/Toast';
import { errMsg } from '@one/renderer/lib/errMsg';
import { applyThemePref, getThemePref } from '@one/renderer/lib/theme';

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' },
];

/**
 * 환경설정 — 본체 환경설정 중 이 앱이 쓰는 것만: 비즈박스 계정·결재 소속 · Jira 연동 · 테마.
 * 저장 채널은 본체와 같은 `settings:set` 이라 저장 형식(settings.json)도 본체와 같다.
 * 계정이 없으면 첫 실행 때 여기부터 시작한다(취소 없음).
 */
export function SettingsView({
  settings,
  version,
  onSaved,
  onCancel,
}: {
  settings: AppSettingsView;
  /** 실행 중인 앱 버전 — 셸이 시작할 때 받아둔 값(빈 문자열이면 확인 실패) */
  version: string;
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
  // 수동 업데이트 확인 — 셸이 시작할 때 이미 한 번 보지만, 여기서 직접 다시 볼 수 있다
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<UpdateInfo | null>(null);
  const toast = useToast();

  const checkUpdate = async () => {
    setChecking(true);
    try {
      setChecked(await window.oneApp.update.check());
    } catch (e) {
      setChecked({ ok: false, current: version, url: '', error: errMsg(e, '확인에 실패했습니다.') });
    } finally {
      setChecking(false);
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
    <div className="section settings-view">
      <SectionHeader
        icon={<Icon name="settings" size={18} />}
        title="환경설정"
        sub="그룹웨어 계정과 Jira 연동을 설정합니다. 비밀번호·토큰은 이 PC 에만 암호화 저장됩니다."
      />

      {!settings.hasPassword && (
        <Banner variant="info">
          그룹웨어(gw.forbiz.co.kr) 로그인에 쓰는 사번·비밀번호를 먼저 저장하세요.
        </Banner>
      )}
      {!settings.secureStorage && (
        <Banner variant="danger">
          이 PC 에서는 OS 보안 저장소(키체인)를 쓸 수 없어 <b>비밀번호·토큰을 저장할 수
          없습니다</b> — 평문으로 남기지 않기 위해 저장을 막습니다. 키체인 잠금을 해제하거나
          앱을 다시 설치한 뒤 시도하세요.
        </Banner>
      )}
      {error && <Banner variant="danger">{error}</Banner>}

      <Collapsible title="비즈박스 계정" icon={<Icon name="key" size={14} />}>
        <FormRow label="사번(ID)">
          <Input
            value={bizboxId}
            onChange={(e) => setBizboxId(e.target.value)}
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
              settings.hasPassword ? '저장됨 — 변경할 때만 입력' : '그룹웨어 비밀번호'
            }
            disabled={saving}
          />
        </FormRow>
        <FormRow label="결재 소속">
          <Input
            value={approvalDept}
            onChange={(e) => setApprovalDept(e.target.value)}
            placeholder="예: FE챕터 플랫폼기술부문"
            disabled={saving}
          />
        </FormRow>
        <p className="hint form-hint">
          야근 결재 근무자 표의 &apos;소속&apos; 칸과 휴가신청서 제목에 <b>그대로</b>{' '}
          들어갑니다(제목에서는 공백이 밑줄로 바뀝니다). 비워 두면 야근·휴가 결재를 시작할 수
          없습니다.
        </p>
      </Collapsible>

      <Collapsible title="Jira 연동 (티켓 보고)" icon={<Icon name="clipboard-list" size={14} />}>
        <FormRow label="Jira 주소">
          <Input
            value={jiraUrl}
            onChange={(e) => setJiraUrl(e.target.value)}
            placeholder="예: https://forbizkorea.atlassian.net"
            disabled={saving}
          />
        </FormRow>
        {/* http 는 막지 않지만(온프렘 서버가 있을 수 있다) 토큰이 평문으로 나간다는 것은 알린다 */}
        {/^http:\/\//i.test(jiraUrl.trim()) && (
          <p className="hint form-hint">
            ⚠️ <b>http</b> 주소입니다 — 이메일·API 토큰이 <b>암호화 없이</b> 전송됩니다. 가능하면
            https 주소를 쓰세요.
          </p>
        )}
        <FormRow label="이메일">
          <Input
            value={jiraEmail}
            onChange={(e) => setJiraEmail(e.target.value)}
            placeholder="Jira 로그인 이메일"
            disabled={saving}
          />
        </FormRow>
        <FormRow label="API 토큰">
          <Input
            type="password"
            value={jiraToken}
            onChange={(e) => setJiraToken(e.target.value)}
            placeholder={settings.hasJiraToken ? '저장됨 — 변경할 때만 입력' : 'Atlassian API 토큰'}
            disabled={saving}
          />
        </FormRow>
        <p className="hint form-hint">
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
      </Collapsible>

      <Collapsible title="테마" icon={<Icon name="moon" size={14} />}>
        <Segment<ThemePref> options={THEMES} value={theme} onChange={changeTheme} />
      </Collapsible>

      {/* 자동 업데이트는 없다 — 새 버전이 있으면 릴리스 페이지를 열어 zip 을 덮어쓰면 된다 */}
      <Collapsible title="버전" icon={<Icon name="info" size={14} />} defaultOpen={false}>
        <div className="settings-version">
          <span>
            현재 버전 <b>{version || '—'}</b>
          </span>
          <Button size="sm" onClick={() => void checkUpdate()} loading={checking}>
            업데이트 확인
          </Button>
        </div>
        {checked && (
          <p className="hint form-hint">
            {!checked.ok ? (
              checked.error
            ) : checked.hasUpdate ? (
              <>
                새 버전 <b>{checked.latest}</b> 이 있습니다 —{' '}
                <TextLink
                  small
                  external
                  onClick={() => void window.oneApp.openExternal(checked.url)}
                >
                  받으러 가기
                </TextLink>
                . 받은 zip 으로 기존 앱을 덮어쓰면 되고, 설정은 그대로 유지됩니다.
              </>
            ) : (
              '최신 버전을 쓰고 있습니다.'
            )}
          </p>
        )}
      </Collapsible>

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
