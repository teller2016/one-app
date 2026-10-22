import { useCallback, useEffect, useState } from 'react';
import { pad2 } from '../../../../shared/date';
import type { OrchestratorConfirmRequest } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { useTick } from '../../../lib/usePolling';

/**
 * 루트 승인 창(무인 연쇄 가드) — 워커 보고로 시작된 루트의 턴이 지시·프리셋 실행·탭 닫기를 하려 하면 main 이
 * 대기열에 넣고 여기로 방송한다(main `orchestrator/approve.ts`). **맨 앞 요청 하나**를 모달로 띄운다.
 * 보류 중인 비서 브랜치의 승인 창과 같은 틀이다.
 *
 * App 셸 최상단에 한 번만 마운트한다 — 어느 섹션에 있든 뜬다. 닫기(✕·Escape·바깥 클릭)는 전부
 * [취소] 다: 잘못 눌러도 실행되지 않는 쪽으로만 기운다.
 */
export function RootConfirmHost() {
  const [pending, setPending] = useState<OrchestratorConfirmRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const current = pending[0];
  // 남은 시간 표시 — 요청이 있을 때만 1초 틱
  useTick(1000, !!current);

  useEffect(() => {
    const api = window.oneApp?.orchestrator;
    if (!api) return;
    // 렌더러가 새로 떴을 때(리로드) 이미 기다리던 요청도 받는다
    void api.listConfirms().then(setPending);
    return api.onConfirmsChanged(setPending);
  }, []);

  const answer = useCallback(
    async (approved: boolean) => {
      const api = window.oneApp?.orchestrator;
      if (!api || !current) return;
      setBusy(true);
      try {
        const ok = await api.answerConfirm(current.id, approved);
        if (!ok) toast('이미 만료되었거나 취소된 요청입니다', 'fail');
      } catch (e) {
        toast(errMsg(e, '응답을 보내지 못했습니다'), 'fail');
      } finally {
        setBusy(false);
      }
    },
    [current, toast],
  );

  const reject = useCallback(() => void answer(false), [answer]);

  if (!current) return null;
  const remainSec = Math.max(0, Math.ceil((current.expiresAt - Date.now()) / 1000));
  const remain = `${Math.floor(remainSec / 60)}:${pad2(remainSec % 60)}`;

  return (
    <Modal
      title={
        <span className="root-confirm__title">
          <Icon name="root" size={18} />
          루트 승인 — {current.title}
        </span>
      }
      onClose={reject}
    >
      {current.note && <Banner variant="warning">{current.note}</Banner>}

      <dl className="root-confirm__fields">
        {current.fields.map((f) => (
          <div key={f.label} className="root-confirm__row">
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <div className="root-confirm__foot">
        <span className="hint">
          {remain} 뒤 자동 취소
          {pending.length > 1 && ` · 대기 ${pending.length - 1}건`}
        </span>
        <Button onClick={reject} disabled={busy}>
          취소
        </Button>
        <Button
          variant={current.danger ? 'danger' : 'primary'}
          loading={busy}
          onClick={() => void answer(true)}
        >
          실행
        </Button>
      </div>
    </Modal>
  );
}
