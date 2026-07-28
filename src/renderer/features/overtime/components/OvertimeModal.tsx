import { useEffect, useMemo, useState } from 'react';
import type { OvertimeSubmitResult } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { Textarea } from '../../../components/Textarea';
import { useToast } from '../../../components/Toast';

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

/** 시간합계 표시 — 자정을 넘겨도 계산 (submit.ts 의 규칙과 동일) */
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
 * 야근 결재 모달 — 연장근무내역서를 작성해 그룹웨어에 상신한다.
 * 결재선이 '본인'이라 상신 후 미결함에서 직접 승인하면 완료 ([결재하러 가기] 링크 제공).
 */
export function OvertimeModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(todayKey());
  // 시작은 정규 퇴근(18:00), 종료는 지금 시각의 30분 올림 — 열 때마다 새로 계산
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState(defaultEndTime);
  const [target, setTarget] = useState('');
  const [content, setContent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<OvertimeSubmitResult | null>(null);

  // 마지막에 작성한 업무내용을 기본값으로 + 진행 단계 구독
  useEffect(() => {
    void window.oneApp.overtime.getDefaults().then((d) => {
      setTarget(d.target);
      setContent(d.content);
      setReason(d.reason);
    });
    const offProgress = window.oneApp.overtime.onProgress((p) =>
      setStep(p.step),
    );
    return offProgress;
  }, []);

  // 상신 진행 중에는 dim·Escape·닫기 버튼으로 닫히지 않게 잠근다
  const requestClose = () => {
    if (!busy) onClose();
  };

  const total = useMemo(() => hoursTotal(startTime, endTime), [startTime, endTime]);
  const valid =
    !!date && !!total && !!target.trim() && !!content.trim() && !!reason.trim();

  const submit = async () => {
    setBusy(true);
    setStep('실행 준비 중…');
    setError('');
    const res = await window.oneApp.overtime.submit({
      date,
      startTime,
      endTime,
      target: target.trim(),
      content: content.trim(),
      reason: reason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      setDone(res);
      toast('연장근무내역서를 상신했습니다.');
    } else {
      setError(res.error ?? '상신에 실패했습니다.');
    }
  };

  // 상신 완료 화면 — 남은 일은 미결함에서 본인 결재뿐
  if (done) {
    return (
      <Modal title="야근 결재 상신 완료" onClose={onClose}>
        <div className="overtime-done">
          <span className="overtime-done__icon">
            <Icon name="check" size={28} />
          </span>
          <p className="overtime-done__title">{done.title}</p>
          <p className="overtime-done__hint">
            상신됐습니다. 결재선이 본인이라 미결함에서 [결재]만 누르면 완료됩니다.
          </p>
          <div className="form-actions">
            {done.docUrl && (
              <Button
                variant="primary"
                onClick={() => void window.oneApp.openExternal(done.docUrl ?? '')}
              >
                결재하러 가기
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              닫기
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="야근 결재 상신" onClose={requestClose}>
      <div className="overtime-form">
        {error && <Banner variant="danger">{error}</Banner>}

        <FormRow label="연장근무일">
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={busy}
          />
        </FormRow>

        <FormRow label="근무시간">
          <div className="overtime-form__times">
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={busy}
            />
            <span className="overtime-form__tilde">~</span>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={busy}
            />
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
          <p className="overtime-form__progress">
            <span className="spinner" aria-hidden />
            {step || '진행 중…'}
            <span className="overtime-form__progress-note">
              최대 1분 정도 걸립니다 — 완료 전에는 창이 닫히지 않습니다.
            </span>
          </p>
        )}

        <div className="form-actions">
          <Button variant="primary" onClick={submit} disabled={!valid || busy} loading={busy}>
            상신하기
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
        </div>
      </div>
    </Modal>
  );
}
