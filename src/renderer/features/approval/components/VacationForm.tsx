import { useEffect, useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { DatePicker } from '../../../components/DatePicker';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { DoneCard } from './DoneCard';
import { ProgressLine } from './ProgressLine';
import { Icon } from '../../../components/Icon';
import { Tooltip } from '../../../components/Tooltip';
import {
  APPLICANT_PLACEHOLDER,
  ATT_DIV_NAMES,
  DOC_REASONS,
  isSingleDayKind,
  today,
  vacationTitle,
} from '../lib/calc';
import type {
  VacationHandover,
  VacationResult,
  VacationStatus,
} from '../../../../shared/types';

const KIND_OPTIONS = ATT_DIV_NAMES.map((n) => ({ value: n, label: n }));
const REASON_OPTIONS = DOC_REASONS.map((n) => ({ value: n, label: n }));

type HandoverRow = VacationHandover & { key: number };
let rowSeq = 1;
const newHandover = (): HandoverRow => ({ key: rowSeq++, project: '', members: '' });

/**
 * 휴가신청서 — 근태 신청 화면을 채우고 [내역추가] 후 [결재상신]까지 누른다.
 * 결재(승인)는 언제나 사용자가 그룹웨어 결재함에서 직접 한다.
 *
 * 제목은 그룹웨어에서 읽은 신청자 이름이 있어야 완성되므로, 사용자가 손대지 않으면
 * 비운 채로 보내 main 이 채우게 한다(입력하면 그 값을 그대로 쓴다).
 */
export function VacationForm() {
  const toast = useToast();
  const [attDivName, setAttDivName] = useState(ATT_DIV_NAMES[0]);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [remark, setRemark] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState(DOC_REASONS[0]);
  const [reasonEtc, setReasonEtc] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [handovers, setHandovers] = useState<HandoverRow[]>(() => [newHandover()]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState<VacationResult | null>(null);
  const [status, setStatus] = useState<VacationStatus | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // 지난 입력(비상연락망·인수인계) 불러오기 + 진행 단계 구독
  useEffect(() => {
    void window.oneApp.approval.getVacationDefaults().then((d) => {
      setEmergencyContact(d.emergencyContact);
      if (d.handovers.length) {
        setHandovers(d.handovers.map((h) => ({ ...h, key: rowSeq++ })));
      }
    });
    return window.oneApp.approval.onProgress((p) => setStep(p.step));
  }, []);

  const singleDay = isSingleDayKind(attDivName);
  // 반차·시차는 하루짜리라 종료일자를 시작일자에 맞춰 둔다
  useEffect(() => {
    if (singleDay && toDate !== fromDate) setToDate(fromDate);
  }, [singleDay, fromDate, toDate]);

  // 제목 미리보기 — 이름·소속은 [조회] 로 그룹웨어에서 읽어 오면 그때부터 실제 값이 들어간다
  const titlePreview = useMemo(
    () =>
      vacationTitle({
        attDivName,
        fromDate,
        toDate: singleDay ? fromDate : toDate,
        name: status?.name,
        chapter: status?.chapter,
        division: status?.division,
      }),
    [attDivName, fromDate, toDate, singleDay, status],
  );

  const reasonOk = reason !== '기타' || !!reasonEtc.trim();
  const valid =
    !!fromDate &&
    !!toDate &&
    fromDate <= toDate &&
    reasonOk &&
    !!emergencyContact.trim();

  const loadStatus = async () => {
    setStatusBusy(true);
    const res = await window.oneApp.approval.vacationStatus();
    setStatusBusy(false);
    if (res.ok && res.status) setStatus(res.status);
    else setError(res.error ?? '연차 현황을 불러오지 못했습니다.');
  };

  const run = async () => {
    setBusy(true);
    setStep('실행 준비 중…');
    setError('');
    const res = await window.oneApp.approval.submitVacation({
      attDivName,
      fromDate,
      toDate: singleDay ? fromDate : toDate,
      // 사용자가 직접 고친 제목만 보낸다 — 비우면 main 이 신청자 이름까지 넣어 만든다.
      // 자리표시가 남아 있으면 고치다 만 것이므로 main 에 맡긴다(그대로 올라가면 곤란하다).
      title: titleEdited && !title.includes(APPLICANT_PLACEHOLDER) ? title.trim() : '',
      remark: remark.trim(),
      reason,
      reasonEtc: reasonEtc.trim(),
      emergencyContact: emergencyContact.trim(),
      handovers: handovers
        .filter((h) => h.project.trim() || h.members.trim())
        .map((h) => ({ project: h.project.trim(), members: h.members.trim() })),
    });
    setBusy(false);
    if (res.ok) {
      setDone(res);
      toast('휴가신청서를 작성했습니다. 창에서 [상신] 하세요.');
    } else {
      setError(res.error ?? '실행에 실패했습니다.');
    }
  };

  if (done) {
    const spent = [
      done.dayCount ? `신청일수 ${done.dayCount}일` : '',
      done.useDayCount ? `연차차감 ${done.useDayCount}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <DoneCard
        tone={done.eaReady && !done.missed?.length ? 'info' : 'warn'}
        icon={done.eaReady && !done.missed?.length ? 'check' : 'alert-triangle'}
        title={done.title ?? ''}
        hint={
          done.missed?.length
            ? `본문에서 채우지 못한 항목이 있습니다 — ${done.missed.join(', ')}. 창에서 직접 채우고 [상신]을 눌러 주세요.${spent ? ` (${spent})` : ''}`
            : done.eaReady
              ? `전자결재 본문(종류·사유·기간·비상연락망·인수인계·작성일자)까지 채워 창에 띄웠습니다. 확인하고 [상신]을 눌러 마무리하세요.${spent ? ` (${spent})` : ''}`
              : `신청내역은 저장됐지만 전자결재 창을 자동으로 마무리하지 못했습니다. 창에서 확인하고 [상신]을 눌러 주세요.${spent ? ` (${spent})` : ''}`
        }
      />
    );
  }

  return (
    <div className="approval-form">
      {error && <Banner variant="danger">{error}</Banner>}

      <div className="vacation-status">
        {status ? (
          <>
            <span>
              잔여연차 <strong>{status.rest}</strong>
            </span>
            <span className="vacation-status__sub">
              총 {status.total} · 사용 {status.used} · 결재중 {status.progress}
            </span>
          </>
        ) : (
          <span className="vacation-status__sub">
            연차 현황은 그룹웨어에서 조회합니다
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void loadStatus()}
          disabled={statusBusy || busy}
          loading={statusBusy}
        >
          {status ? '새로고침' : '조회'}
        </Button>
      </div>

      <FormRow label="근태구분">
        <Select
          className="vacation-kind"
          options={KIND_OPTIONS}
          value={attDivName}
          onChange={setAttDivName}
          disabled={busy}
          aria-label="근태구분"
        />
      </FormRow>

      <FormRow label="신청일자">
        <div className="approval-form__stack">
          <div className="approval-form__times">
            <DatePicker value={fromDate} onChange={setFromDate} disabled={busy} />
            {!singleDay && (
              <>
                <span className="approval-form__tilde">~</span>
                <DatePicker value={toDate} onChange={setToDate} disabled={busy} />
              </>
            )}
          </div>
          <p className="hint">
            {singleDay
              ? `${attDivName}는 하루만 신청합니다.`
              : fromDate > toDate
                ? '종료일이 시작일보다 빠릅니다.'
                : '신청일수·연차차감은 그룹웨어가 계산합니다.'}
          </p>
        </div>
      </FormRow>

      <FormRow label="제목">
        <div className="approval-form__stack">
          <Input
            value={titleEdited ? title : titlePreview}
            onChange={(e) => {
              setTitleEdited(true);
              setTitle(e.target.value);
            }}
            disabled={busy}
          />
          <p className="hint">
            {titleEdited
              ? '직접 입력한 제목으로 상신합니다.'
              : status
                ? '이대로 상신합니다. 고치면 그 제목을 씁니다.'
                : `${APPLICANT_PLACEHOLDER} 자리는 상신할 때 채워집니다. [조회]로 미리 볼 수 있습니다.`}
          </p>
        </div>
      </FormRow>

      <FormRow label="비고">
        <Input
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder="선택 — 비워 두어도 됩니다"
          disabled={busy}
        />
      </FormRow>

      {/* 아래 세 항목은 전자결재 본문(휴가신청서 서식)에 채워진다 */}
      <p className="approval-form__group">전자결재 본문</p>

      <FormRow label="사유">
        <div className="approval-form__times">
          <Select
            className="vacation-kind"
            options={REASON_OPTIONS}
            value={reason}
            onChange={setReason}
            disabled={busy}
            aria-label="휴가 사유"
          />
          {reason === '기타' && (
            <Input
              value={reasonEtc}
              onChange={(e) => setReasonEtc(e.target.value)}
              placeholder="기타 사유를 적어 주세요"
              disabled={busy}
            />
          )}
        </div>
      </FormRow>

      <FormRow label="비상연락망">
        <div className="approval-form__stack">
          <Input
            value={emergencyContact}
            onChange={(e) => setEmergencyContact(e.target.value)}
            placeholder="예: 010-1234-5678"
            disabled={busy}
          />
          <p className="hint">한 번 입력하면 다음부터 자동으로 채워집니다.</p>
        </div>
      </FormRow>

      <FormRow label="인수인계">
        <div className="approval-form__stack">
          {handovers.map((row) => (
            <div className="handover-row" key={row.key}>
              <Input
                value={row.project}
                onChange={(e) =>
                  setHandovers((rows) =>
                    rows.map((r) =>
                      r.key === row.key ? { ...r, project: e.target.value } : r,
                    ),
                  )
                }
                placeholder="프로젝트명"
                disabled={busy}
              />
              <span className="handover-row__colon">:</span>
              <Input
                value={row.members}
                onChange={(e) =>
                  setHandovers((rows) =>
                    rows.map((r) =>
                      r.key === row.key ? { ...r, members: e.target.value } : r,
                    ),
                  )
                }
                placeholder="팀원1, 팀원2"
                disabled={busy}
              />
              <Tooltip label="행 삭제">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="행 삭제"
                  disabled={busy || handovers.length === 1}
                  onClick={() =>
                    setHandovers((rows) => rows.filter((r) => r.key !== row.key))
                  }
                >
                  <Icon name="x" size={14} />
                </button>
              </Tooltip>
            </div>
          ))}
          <div className="handover-add">
            <Button
              size="sm"
              onClick={() => setHandovers((rows) => [...rows, newHandover()])}
              disabled={busy}
            >
              프로젝트 추가
            </Button>
            <span className="hint">
              본문에 &quot;프로젝트명: 팀원1, 팀원2&quot; 로 한 줄씩 들어갑니다
            </span>
          </div>
        </div>
      </FormRow>

      {busy && (
        <ProgressLine
          step={step}
          note="작성 → 내역추가 → 결재상신 → 전자결재 창 순으로 진행됩니다"
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
          전자결재 창까지 만들어 둡니다 — [상신]은 직접 (일정등록: 부재공유 캘린더)
        </span>
      </div>
    </div>
  );
}
