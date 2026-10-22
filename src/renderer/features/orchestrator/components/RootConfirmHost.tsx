import { useCallback, useEffect, useState } from 'react';
import { pad2 } from '../../../../shared/date';
import type { OrchestratorConfirmPicks, OrchestratorConfirmRequest } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { useTick } from '../../../lib/usePolling';

/**
 * 루트 승인 창 — main(`orchestrator/approve.ts`)이 대기열에 넣고 여기로 방송한다. **맨 앞 요청 하나**를 모달로 띄운다.
 *  - 무인 연쇄 가드: 워커 보고로 시작된 루트의 턴이 지시·프리셋 실행·탭 닫기를 하려 할 때
 *  - 세션·워크트리 만들기: 늘 — 여러 티켓은 한 창에 항목으로 묶여 항목별로 뺄 수 있고, 스택·계정을 고른다
 * 보류 중인 비서 브랜치의 승인 창과 같은 틀이다.
 *
 * App 셸 최상단에 한 번만 마운트한다 — 어느 섹션에 있든 뜬다. 닫기(✕·Escape·바깥 클릭)는 전부
 * [취소] 다: 잘못 눌러도 실행되지 않는 쪽으로만 기운다.
 */
export function RootConfirmHost() {
  const [pending, setPending] = useState<OrchestratorConfirmRequest[]>([]);

  useEffect(() => {
    const api = window.oneApp?.orchestrator;
    if (!api) return;
    // 렌더러가 새로 떴을 때(리로드) 이미 기다리던 요청도 받는다
    void api.listConfirms().then(setPending);
    return api.onConfirmsChanged(setPending);
  }, []);

  const current = pending[0];
  if (!current) return null;
  // 요청마다 새로 — 고른 항목·값이 다음 요청으로 새지 않게
  return <ConfirmModal key={current.id} req={current} waiting={pending.length - 1} />;
}

function ConfirmModal({ req, waiting }: { req: OrchestratorConfirmRequest; waiting: number }) {
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<Set<string>>(() => new Set((req.items ?? []).filter((i) => i.checked).map((i) => i.id)));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((req.choices ?? []).filter((c) => c.value !== null).map((c) => [c.id, c.value as string])),
  );
  const toast = useToast();
  // 남은 시간 표시 — 1초 틱
  useTick(1000, true);

  const items = req.items ?? [];
  // 필요한 선택: 항목에 묶인 선택은 그 항목을 남겼을 때만
  const needed = (req.choices ?? []).filter((c) => !c.itemId || kept.has(c.itemId));
  const missing = needed.filter((c) => !values[c.id]);
  const nothingKept = items.length > 0 && kept.size === 0;

  const answer = useCallback(
    async (approved: boolean) => {
      const api = window.oneApp?.orchestrator;
      if (!api) return;
      setBusy(true);
      try {
        const picks: OrchestratorConfirmPicks = { items: [...kept], choices: values };
        const ok = await api.answerConfirm(req.id, approved, approved ? picks : undefined);
        if (!ok) toast('이미 만료되었거나 취소된 요청입니다', 'fail');
      } catch (e) {
        toast(errMsg(e, '응답을 보내지 못했습니다'), 'fail');
      } finally {
        setBusy(false);
      }
    },
    [req.id, kept, values, toast],
  );

  const reject = useCallback(() => void answer(false), [answer]);

  const toggle = (id: string, on: boolean) =>
    setKept((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const remainSec = Math.max(0, Math.ceil((req.expiresAt - Date.now()) / 1000));
  const remain = `${Math.floor(remainSec / 60)}:${pad2(remainSec % 60)}`;

  return (
    <Modal
      title={
        <span className="root-confirm__title">
          <Icon name="root" size={18} />
          루트 승인 — {req.title}
        </span>
      }
      onClose={reject}
      footer={
        <>
          <span className="hint root-confirm__remain">
            {remain} 뒤 자동 취소
            {waiting > 0 && ` · 대기 ${waiting}건`}
            {missing.length > 0 && ' · 고를 값이 남았습니다'}
          </span>
          <Button onClick={reject} disabled={busy}>
            취소
          </Button>
          <Button
            variant={req.danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={missing.length > 0 || nothingKept}
            onClick={() => void answer(true)}
          >
            {items.length > 1 ? `${kept.size}건 실행` : '실행'}
          </Button>
        </>
      }
    >
      {req.note && (
        <Banner variant="warning">
          {/* 안내가 여럿이면 main 이 줄바꿈으로 잇는다(무인 연쇄 표시 · 제외 목록) — 한 줄로 붙지 않게 줄마다 */}
          {req.note.split('\n').map((line) => (
            <div key={line}>{line}</div>
          ))}
        </Banner>
      )}

      {req.fields.length > 0 && (
        <dl className="root-confirm__fields">
          {req.fields.map((f) => (
            <div key={f.label} className="root-confirm__row">
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {items.length > 0 && (
        <ul className="root-confirm__items">
          {items.map((it) => (
            <li key={it.id} className={'root-confirm__item' + (kept.has(it.id) ? '' : ' root-confirm__item--off')}>
              <Checkbox
                checked={kept.has(it.id)}
                onChange={(e) => toggle(it.id, e.target.checked)}
                label={<span className="root-confirm__item-title">{it.title}</span>}
              />
              <div className="root-confirm__item-lines">
                {it.lines.map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {needed.length > 0 && (
        <div className="root-confirm__choices">
          {needed.map((c) => (
            <label key={c.id} className="root-confirm__choice">
              <span>{c.label}</span>
              <Select
                small
                options={c.options}
                value={values[c.id] ?? ''}
                onChange={(v) => setValues((cur) => ({ ...cur, [c.id]: v }))}
                placeholder="골라 주세요"
                aria-label={c.label}
              />
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
