import { useEffect, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { DatePicker } from '../../../components/DatePicker';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Textarea } from '../../../components/Textarea';
import { TimePicker } from '../../../components/TimePicker';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { DoneCard } from './DoneCard';
import { ProgressLine } from './ProgressLine';
import { defaultEndTime, hoursTotal, today } from '../lib/calc';
import type { OvertimeSubmitResult } from '../../../../shared/types';

/**
 * 야근 결재 — 연장근무내역서를 작성해 그룹웨어에 상신한다.
 * 결재선이 '본인'이라 상신 후 미결함에서 직접 승인하면 완료.
 * onBusyChange 로 진행 상태를 알려 모달이 닫히지 않게 잠글 수 있다.
 */
export function OvertimeForm({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(today);
  // 시작은 정규 퇴근(18:00), 종료는 지금 시각의 30분 올림
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [target, setTarget] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<OvertimeSubmitResult | null>(null);

  // 마지막 작성 내용 불러오기 + 진행 단계 구독
  useEffect(() => {
    void window.oneApp.approval.getOvertimeDefaults().then((d) => {
      setTarget(d.target);
      setContent(d.content);
      setReason(d.reason);
    });
    return window.oneApp.approval.onProgress((p) => setStep(p.step));
  }, []);

  useEffect(() => onBusyChange?.(busy), [busy, onBusyChange]);

  const total = useMemo(() => hoursTotal(startTime, endTime), [startTime, endTime]);
  const valid =
    !!date && !!total && !!target.trim() && !!content.trim() && !!reason.trim();

  const run = async () => {
    setBusy(true);
    setStep('실행 준비 중…');
    setError('');
    // invoke 거부도 잡는다 — busy 가 남으면 폼 전체가 disabled 로 잠긴다
    try {
      const res = await window.oneApp.approval.submitOvertime({
        date,
        startTime,
        endTime,
        target: target.trim(),
        content: content.trim(),
        reason: reason.trim(),
      });
      if (res.ok) {
        setDone(res);
        toast('연장근무내역서를 작성했습니다. 창에서 [상신] 하세요.');
      } else {
        setError(res.error ?? '실행에 실패했습니다.');
      }
    } catch (err) {
      setError(errMsg(err, '실행에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <DoneCard
        tone="info"
        icon="check"
        title={done.title ?? ''}
        hint="열린 창에 작성돼 있습니다. 내용을 확인하고 [상신]을 눌러 마무리하세요. (앱이 상신까지 하지는 않습니다)"
      />
    );
  }

  return (
    <div className="approval-form">
      {error && <Banner variant="danger">{error}</Banner>}

      <FormRow label="연장근무일">
        <DatePicker value={date} onChange={setDate} disabled={busy} />
      </FormRow>

      <FormRow label="근무시간">
        <div className="approval-form__times">
          <TimePicker value={startTime} onChange={setStartTime} disabled={busy} />
          <span className="approval-form__tilde">~</span>
          <TimePicker value={endTime} onChange={setEndTime} disabled={busy} />
          <span className="approval-form__total">
            {total ? `합계 ${total}` : '시간을 확인하세요'}
          </span>
        </div>
      </FormRow>

      <FormRow label="업무 대상">
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="예: A프로젝트"
          disabled={busy}
        />
      </FormRow>

      <FormRow label="수행 내용">
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="예: 결제 기능 오류 수정 및 테스트"
          rows={2}
          disabled={busy}
        />
      </FormRow>

      <FormRow label="연장근무 사유">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 고객 납기일 준수를 위해 당일 연장근무 필요"
          rows={2}
          disabled={busy}
        />
      </FormRow>

      {busy && (
        <ProgressLine step={step} note="창이 열리고 양식이 채워집니다 — 기다려 주세요" />
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
          작성만 합니다 — 열린 창에서 확인 후 직접 [상신]
        </span>
      </div>
    </div>
  );
}
