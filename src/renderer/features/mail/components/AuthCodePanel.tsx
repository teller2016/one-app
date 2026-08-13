import { useCallback, useEffect, useState } from 'react';
import type { AltMailAccount, AuthCodeResult } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useCopy } from '../../../lib/useCopy';
import { relativeTime } from '../lib/format';

/** 계정별 조회 상태 */
type CodeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: AuthCodeResult };

const IDLE: CodeState = { kind: 'idle' };

/**
 * 팀 공용 계정의 피그마 인증코드 패널 (메일 리더 모달의 '인증코드' 탭).
 *
 * 버튼을 누르면 그 계정으로 로그인해 최근 메일에서 인증 메일만 골라 코드를 뽑고,
 * **성공하면 바로 클립보드에 넣는다** — 코드를 받는 목적이 붙여넣기이기 때문이다.
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
    async (loginId: string) => {
      setCodes((prev) => ({ ...prev, [loginId]: { kind: 'loading' } }));
      const result = await window.oneApp.mail.getAuthCode(loginId);
      setCodes((prev) => ({ ...prev, [loginId]: { kind: 'done', result } }));
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
          return (
            <li key={a.loginId} className="mail-authcode__row">
              <div className="mail-authcode__head">
                <span className="mail-authcode__id">
                  <Icon name="key" size={14} />
                  {a.loginId}
                </span>
                <Button
                  size="sm"
                  loading={state.kind === 'loading'}
                  onClick={() => void fetchCode(a.loginId)}
                >
                  코드 가져오기
                </Button>
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
                      aria-label={`인증코드 ${done.code} 복사`}
                    >
                      {done.code}
                    </button>
                    <span className="mail-authcode__meta">
                      {relativeTime(done.receivedAt ?? 0)} 도착
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
                      10분이 지난 코드입니다 — 이미 만료됐을 수 있으니, 피그마에서
                      코드를 다시 보낸 뒤 한 번 더 가져오세요.
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
