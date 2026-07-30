import { useEffect, useMemo, useState } from 'react';
import type { OvertimeSubmitResult } from '../../shared/types';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { DatePicker } from '../components/DatePicker';
import { DoneCard } from '../components/DoneCard';
import { FormRow } from '../components/FormRow';
import { Icon } from '../components/Icon';
import { Input } from '../components/Input';
import { Textarea } from '../components/Textarea';
import { TimePicker } from '../components/TimePicker';

/** 오늘 날짜 "YYYY-MM-DD" (로컬 기준) */
const todayKey = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * 종료 시간 기본값 — 현재 시각을 30분 단위로 올림 (예: 19:10 → 19:30).
 * 아직 18시(퇴근)를 넘지 않았으면 18:30, 자정 직전이면 23:30 으로 고정.
 */
const defaultEndTime = () => {
  const now = new Date();
  let mins = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
  mins = Math.max(mins, 18 * 60 + 30);
  mins = Math.min(mins, 23 * 60 + 30);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(mins / 60))}:${p(mins % 60)}`;
};

/** 시간합계 표시 — 자정을 넘겨도 계산 (main 의 submit.ts 규칙과 동일) */
const hoursTotal = (start: string, end: string): string => {
  const toMin = (t: string) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (Number.isNaN(s) || Number.isNaN(e) || s === e) return '';
  const diff = (e - s + 24 * 60) % (24 * 60);
  return `${parseFloat((diff / 60).toFixed(1))}시간`;
};

/**
 * 야근 결재 — 연장근무내역서를 작성해 그룹웨어에 상신한다.
 * 결재선이 '본인'이라 상신 후 미결함에서 직접 승인하면 완료.
 */
export function OvertimeForm({ configured }: { configured: boolean }) {
  const [date, setDate] = useState(todayKey());
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
    void window.overtimeApp.getDefaults().then((d) => {
      setTarget(d.target);
      setContent(d.content);
      setReason(d.reason);
    });
    return window.overtimeApp.onProgress((p) => setStep(p.step));
  }, []);

  const total = useMemo(() => hoursTotal(startTime, endTime), [startTime, endTime]);
  const valid =
    !!date && !!total && !!target.trim() && !!content.trim() && !!reason.trim();

  const run = async (previewOnly: boolean) => {
    setBusy(true);
    setStep(previewOnly ? '미리보기 준비 중…' : '실행 준비 중…');
    setError('');
    const res = await window.overtimeApp.submit({
      date,
      startTime,
      endTime,
      target: target.trim(),
      content: content.trim(),
      reason: reason.trim(),
      previewOnly,
    });
    setBusy(false);
    if (res.ok) setDone(res);
    else setError(res.error ?? '실행에 실패했습니다.');
  };

  if (done) {
    const isPreview = done.preview === true;
    return (
      <DoneCard
        tone={isPreview ? 'info' : 'ok'}
        icon={isPreview ? 'info' : 'check'}
        title={done.title ?? ''}
        hint={
          isPreview
            ? '미리보기 창에 작성된 내용이 떠 있습니다. 상신은 하지 않았으니 확인 후 창을 닫고 [상신하기]를 누르세요.'
            : '상신됐습니다. 결재선이 본인이라 미결함에서 [결재]만 누르면 완료됩니다.'
        }
      >
        {isPreview ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                void window.overtimeApp.closeKeptWindow();
                setDone(null);
              }}
            >
              미리보기 창 닫기
            </Button>
            <Button variant="ghost" onClick={() => setDone(null)}>
              창 그대로 두고 계속
            </Button>
          </>
        ) : (
          <>
            {done.docUrl && (
              <Button
                variant="primary"
                onClick={() => void window.overtimeApp.openExternal(done.docUrl ?? '')}
              >
                결재하러 가기
                <Icon name="arrow-up-right" size={14} />
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDone(null)}>
              새로 작성
            </Button>
          </>
        )}
      </DoneCard>
    );
  }

  return (
    <div className="overtime-form">
      {!configured && (
        <Banner variant="warning">
          계정이 없습니다. 오른쪽 위 설정에서 사번·비밀번호를 저장하세요.
        </Banner>
      )}
      {error && <Banner variant="danger">{error}</Banner>}

      <FormRow label="연장근무일">
        <DatePicker value={date} onChange={setDate} disabled={busy} />
      </FormRow>

      <FormRow label="근무시간">
        <div className="overtime-form__times">
          <TimePicker value={startTime} onChange={setStartTime} disabled={busy} />
          <span className="overtime-form__tilde">~</span>
          <TimePicker value={endTime} onChange={setEndTime} disabled={busy} />
          <span className="overtime-form__total">
            {total ? `합계 ${total}` : '시간을 확인하세요'}
          </span>
        </div>
      </FormRow>

      <FormRow label="업무 대상" column>
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="예: A프로젝트"
          disabled={busy}
        />
      </FormRow>

      <FormRow label="수행 내용" column>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="예: 결제 기능 오류 수정 및 테스트"
          rows={2}
          disabled={busy}
        />
      </FormRow>

      <FormRow label="연장근무 사유" column>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 고객 납기일 준수를 위해 당일 연장근무 필요"
          rows={2}
          disabled={busy}
        />
      </FormRow>

      {busy && (
        <p className="progress-line">
          <span className="spinner" aria-hidden />
          {step || '진행 중…'}
          <span className="progress-line__note">최대 1분 정도 걸립니다</span>
        </p>
      )}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void run(false)}
          disabled={!valid || busy || !configured}
          loading={busy}
        >
          상신하기
        </Button>
        <Button
          variant="ghost"
          onClick={() => void run(true)}
          disabled={!valid || busy || !configured}
          title="상신하지 않고 작성된 양식만 띄워 확인합니다"
        >
          미리보기
        </Button>
      </div>
    </div>
  );
}
