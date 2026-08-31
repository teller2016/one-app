import { useEffect, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { DatePicker } from '../../../components/DatePicker';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Tooltip } from '../../../components/Tooltip';
import { errMsg } from '../../../lib/errMsg';
import { DoneCard } from './DoneCard';
import { ProgressLine } from './ProgressLine';
import {
  dinnerNote,
  formatWon,
  monthEndDate,
  parkingAmount,
  parkingNote,
  shiftMonth,
  thisMonth,
  today,
} from '../lib/calc';
import type { ExpendResult } from '../../../../shared/types';

type DinnerRow = { key: number; date: string; amount: string };

let rowSeq = 1;
const newRow = (date: string): DinnerRow => ({ key: rowSeq++, date, amount: '' });

/**
 * 지출결의서(개인) — 주차요금·석식대 항목을 채워 넣는다.
 * 작성만 하고 화면을 남기므로 첨부파일 등록·결재상신은 사용자가 그 창에서 직접 한다.
 */
export function ExpendForm() {
  const [month, setMonth] = useState(thisMonth);
  const [parkingOn, setParkingOn] = useState(true);
  const [manCount, setManCount] = useState('0');
  const [halfCount, setHalfCount] = useState('0');
  const [dinnerOn, setDinnerOn] = useState(true);
  const [dinners, setDinners] = useState<DinnerRow[]>(() => [newRow(today())]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<ExpendResult | null>(null);

  // 마지막 주차권 매수 불러오기 + 진행 단계 구독
  useEffect(() => {
    void window.oneApp.approval.getExpendDefaults().then((d) => {
      setManCount(String(d.manCount));
      setHalfCount(String(d.halfCount));
    });
    return window.oneApp.approval.onProgress((p) => setStep(p.step));
  }, []);

  const man = Number(manCount) || 0;
  const half = Number(halfCount) || 0;
  const parkingTotal = useMemo(() => parkingAmount(man, half), [man, half]);

  const dinnerRows = dinners.map((d) => ({ ...d, won: Number(d.amount) || 0 }));
  const dinnerSum = dinnerRows.reduce((a, d) => a + d.won, 0);

  const parkingValid = !parkingOn || (man + half > 0 && parkingTotal > 0);
  const dinnerValid =
    !dinnerOn || (dinnerRows.length > 0 && dinnerRows.every((d) => !!d.date && d.won > 0));
  const anySection = parkingOn || dinnerOn;
  const valid = anySection && parkingValid && dinnerValid;

  const run = async () => {
    setBusy(true);
    setStep('실행 준비 중…');
    setError('');
    // invoke 거부도 잡는다 — busy 가 남으면 폼 전체가 disabled 로 잠긴다
    try {
      const res = await window.oneApp.approval.runExpend({
        month,
        parking: parkingOn ? { manCount: man, halfCount: half } : null,
        dinners: dinnerOn ? dinnerRows.map((d) => ({ date: d.date, amount: d.won })) : [],
      });
      if (res.ok) setDone(res);
      else {
        setError(res.error ?? '작성에 실패했습니다.');
        setDone(res.added ? res : null); // 일부라도 들어갔으면 결과 화면으로
      }
    } catch (err) {
      setError(errMsg(err, '작성에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (done?.ok) {
    return (
      <DoneCard
        tone="info"
        icon="check"
        title={`항목 ${done.added}건 작성 완료`}
        hint="지출결의서 창에 그대로 떠 있습니다. 첨부파일을 넣고 [결재상신]을 눌러 마무리하세요. (앱이 상신까지 하지는 않습니다)"
      />
    );
  }

  return (
    <div className="approval-form">
      {error && (
        <Banner variant="danger">
          {error}
          {done?.added ? ` (${done.added}건까지 작성됨)` : ''} — 지출결의서 창은 열어
          두었습니다.
        </Banner>
      )}

      {/* 주차요금 */}
      <section className="expend-sec">
        <div className="expend-sec__head">
          <Checkbox
            label="주차요금"
            checked={parkingOn}
            onChange={(e) => setParkingOn(e.target.checked)}
            disabled={busy}
          />
          <div className="expend-month">
            <Tooltip label="이전 달">
              <button
                type="button"
                className="icon-btn"
                aria-label="이전 달"
                disabled={busy}
                onClick={() => setMonth((m) => shiftMonth(m, -1))}
              >
                <Icon name="chevron-left" size={14} />
              </button>
            </Tooltip>
            <span className="expend-month__label">{month}</span>
            <Tooltip label="다음 달">
              <button
                type="button"
                className="icon-btn"
                aria-label="다음 달"
                disabled={busy}
                onClick={() => setMonth((m) => shiftMonth(m, 1))}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </Tooltip>
          </div>
        </div>

        {parkingOn && (
          <div className="expend-sec__body">
            <div className="expend-count">
              <label className="expend-count__item">
                <span>만원권</span>
                <Input
                  type="number"
                  min={0}
                  small
                  value={manCount}
                  onChange={(e) => setManCount(e.target.value)}
                  disabled={busy}
                />
                <span>장</span>
              </label>
              <label className="expend-count__item">
                <span>5천원권</span>
                <Input
                  type="number"
                  min={0}
                  small
                  value={halfCount}
                  onChange={(e) => setHalfCount(e.target.value)}
                  disabled={busy}
                />
                <span>장</span>
              </label>
            </div>
            <p className="hint">
              공급대가 <strong>{formatWon(parkingTotal)}원</strong> · 증빙일자{' '}
              {monthEndDate(month)} · 적요 &quot;{parkingNote(month)}&quot;
            </p>
          </div>
        )}
      </section>

      {/* 석식대 */}
      <section className="expend-sec">
        <div className="expend-sec__head">
          <Checkbox
            label="석식대 (연장근로)"
            checked={dinnerOn}
            onChange={(e) => setDinnerOn(e.target.checked)}
            disabled={busy}
          />
          {dinnerOn && dinnerSum > 0 && (
            <span className="expend-sec__sum">합계 {formatWon(dinnerSum)}원</span>
          )}
        </div>

        {dinnerOn && (
          <div className="expend-sec__body">
            {dinners.map((row) => (
              <div className="expend-row" key={row.key}>
                <DatePicker
                  value={row.date}
                  onChange={(v) =>
                    setDinners((rows) =>
                      rows.map((r) => (r.key === row.key ? { ...r, date: v } : r)),
                    )
                  }
                  disabled={busy}
                />
                <Input
                  type="number"
                  min={0}
                  step={100}
                  placeholder="금액"
                  value={row.amount}
                  onChange={(e) =>
                    setDinners((rows) =>
                      rows.map((r) =>
                        r.key === row.key ? { ...r, amount: e.target.value } : r,
                      ),
                    )
                  }
                  disabled={busy}
                />
                <span className="expend-row__note">{dinnerNote(row.date) || ''}</span>
                <Tooltip label="행 삭제">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="행 삭제"
                    disabled={busy || dinners.length === 1}
                    onClick={() =>
                      setDinners((rows) => rows.filter((r) => r.key !== row.key))
                    }
                  >
                    <Icon name="x" size={14} />
                  </button>
                </Tooltip>
              </div>
            ))}
            <Button
              size="sm"
              onClick={() =>
                setDinners((rows) => [
                  ...rows,
                  newRow(rows[rows.length - 1]?.date ?? today()),
                ])
              }
              disabled={busy}
            >
              행 추가
            </Button>
          </div>
        )}
      </section>

      {busy && (
        <ProgressLine
          step={step}
          note="항목마다 찾기 창이 열리고 닫힙니다 — 건드리지 말고 기다려 주세요"
        />
      )}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void run()}
          disabled={!valid || busy}
          loading={busy}
        >
          작성 시작
        </Button>
        <span className="hint">
          {anySection
            ? '상신은 하지 않습니다 — 작성된 창에서 첨부 후 직접 상신'
            : '항목을 하나 이상 선택하세요'}
        </span>
      </div>
    </div>
  );
}
