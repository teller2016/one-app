import { useCallback, useEffect, useState } from 'react';
import {
  AUTH_CODE_SERVICES,
  authCodeService,
  type AltMailAccount,
  type AuthCodeResult,
  type AuthCodeServiceId,
} from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useCopy } from '../../../lib/useCopy';
import { relativeTime } from '../lib/format';

/**
 * 계정별 조회 상태 — 서비스가 둘이라 **어느 서비스로** 조회 중인지까지 들고 있어야
 * 누른 버튼만 스피너가 돌고, 결과도 그 서비스 것으로 표시된다.
 */
type CodeState =
  | { kind: 'idle' }
  | { kind: 'loading'; service: AuthCodeServiceId }
  | { kind: 'done'; service: AuthCodeServiceId; result: AuthCodeResult };

const IDLE: CodeState = { kind: 'idle' };

/**
 * 팀 공용 계정의 인증코드 패널 (메일 리더 모달의 '인증코드' 탭).
 *
 * 계정 한 줄에 서비스 버튼(피그마·유데미)이 붙는다. 누르면 그 계정으로 로그인해 최근 메일에서
 * 해당 서비스의 인증 메일만 골라 코드를 뽑고, **성공하면 바로 클립보드에 넣는다** —
 * 코드를 받는 목적이 붙여넣기이기 때문이다.
 * 계정 등록은 여기가 아니라 **환경설정 → [추가 비즈박스 계정]** 에서 한다.
 */
export function AuthCodePanel() {
  const [accounts, setAccounts] = useState<AltMailAccount[] | null>(null);
  const [codes, setCodes] = useState<Record<string, CodeState>>({});
  const copy = useCopy();

  useEffect(() => {
    void window.oneApp.mail.authCodeAccounts().then(setAccounts);
  }, []);

  const fetchCode = useCallback(
    async (loginId: string, service: AuthCodeServiceId) => {
      setCodes((prev) => ({ ...prev, [loginId]: { kind: 'loading', service } }));
      const result = await window.oneApp.mail.getAuthCode(loginId, service);
      setCodes((prev) => ({
        ...prev,
        [loginId]: { kind: 'done', service, result },
      }));
      if (result.ok && result.code) {
        await copy(result.code, {
          success: `인증코드 ${result.code} 복사되었습니다`,
        });
      }
    },
    [copy],
  );

  if (accounts === null) {
    return <p className="hint">불러오는 중...</p>;
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon="key"
        message="등록된 추가 계정이 없습니다."
        hint="환경설정 → [추가 비즈박스 계정] 에서 팀 공용 계정을 등록하면 여기서 인증코드를 받을 수 있습니다."
      />
    );
  }

  return (
    <div className="mail-authcode">
      <ul className="mail-authcode__list">
        {accounts.map((a) => {
          const state = codes[a.loginId] ?? IDLE;
          const done = state.kind === 'done' ? state.result : null;
          const shown =
            state.kind === 'idle' ? null : authCodeService(state.service);
          return (
            <li key={a.loginId} className="mail-authcode__row">
              <div className="mail-authcode__head">
                <span className="mail-authcode__id">
                  <Icon name="key" size={14} />
                  {a.loginId}
                </span>
                <div className="mail-authcode__actions">
                  {AUTH_CODE_SERVICES.map((svc) => (
                    <Button
                      key={svc.id}
                      size="sm"
                      loading={
                        state.kind === 'loading' && state.service === svc.id
                      }
                      onClick={() => void fetchCode(a.loginId, svc.id)}
                    >
                      {svc.label}
                    </Button>
                  ))}
                </div>
              </div>

              {done?.ok && done.code ? (
                <>
                  <div className="mail-authcode__result">
                    {/* 코드 자체가 복사 버튼 — 자동 복사가 실패했을 때의 재시도 경로 */}
                    <button
                      type="button"
                      className="mail-authcode__code"
                      onClick={() => void copy(done.code ?? '')}
                      title="클릭하면 다시 복사합니다"
                      aria-label={`${shown?.label} 인증코드 ${done.code} 복사`}
                    >
                      {done.code}
                    </button>
                    <span className="mail-authcode__meta">
                      {shown?.label} · {relativeTime(done.receivedAt ?? 0)} 도착
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void copy(done.code ?? '')}
                    >
                      <Icon name="copy" size={13} />
                      복사
                    </Button>
                  </div>
                  {done.stale && (
                    <Banner variant="warning">
                      {shown?.freshMinutes}분이 지난 코드입니다 — 이미 만료됐을 수
                      있으니, {shown?.label}에서 코드를 다시 보낸 뒤 한 번 더
                      가져오세요.
                    </Banner>
                  )}
                </>
              ) : done && !done.ok ? (
                <Banner variant="warning">{done.error}</Banner>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
