import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { FormRow } from '../../../components/FormRow';
import { Banner } from '../../../components/Banner';

type DateType = 'today' | 'yesterday' | 'date';

/** 일정 등록 섹션 — 폼 작성 후 버튼을 누르면 앱 내부 매크로가 실행된다. */
export function ScheduleSection() {
  const [scheduleText, setScheduleText] = useState('');
  const [startTime, setStartTime] = useState('9.5');
  const [dateType, setDateType] = useState<DateType>('today');
  const [customDate, setCustomDate] = useState('');
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState('');
  const [credsReady, setCredsReady] = useState<boolean | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  // 매크로 출력/종료 이벤트 구독
  useEffect(() => {
    if (!window.oneApp?.schedule) return;
    const offOutput = window.oneApp.schedule.onOutput(({ data }) => {
      setLog((prev) => prev + data);
      if (data.includes('등록 완료') || data.includes('페이지 이동까지 완료')) {
        setRunning(false);
      }
    });
    const offDone = window.oneApp.schedule.onDone(({ code }) => {
      setRunning(false);
      setLog((prev) => prev + `\n— 프로세스 종료 (code ${code}) —\n`);
    });
    return () => {
      offOutput();
      offDone();
    };
  }, []);

  // 계정 정보 설정 여부 확인
  useEffect(() => {
    window.oneApp?.settings
      .get()
      .then((s) => setCredsReady(!!s.bizboxId && s.hasPassword));
  }, []);

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const run = async (testMode: boolean) => {
    if (!window.oneApp?.schedule) {
      setLog('❌ 앱 연결(preload)이 되지 않았습니다.\n');
      return;
    }
    if (!scheduleText.trim()) {
      setLog('⚠️ 일정 내용을 입력하세요.\n');
      return;
    }
    if (dateType === 'date' && !customDate) {
      setLog('⚠️ 날짜를 선택하세요.\n');
      return;
    }
    setLog('');
    setRunning(true);
    const res = await window.oneApp.schedule.run({
      scheduleText,
      startTime,
      dateOption:
        dateType === 'date'
          ? { type: 'date', date: customDate }
          : { type: dateType },
      testMode,
    });
    if (!res.ok) {
      setRunning(false);
    }
  };

  const cancel = async () => {
    await window.oneApp.schedule.cancel();
    setRunning(false);
  };

  return (
    <div className="section">
      <SectionHeader
        title="🗓️ 일정 등록"
        sub="비즈박스 그룹웨어에 하루 일정을 자동 등록합니다."
      />

      {credsReady === false && (
        <Banner>
          ⚠️ 비즈박스 계정 정보가 없습니다. <b>환경설정</b> 탭에서 아이디/비밀번호를
          먼저 저장하세요.
        </Banner>
      )}

      {/* 날짜 */}
      <FormRow label="날짜">
        <div className="sched__segment">
          {(['today', 'yesterday', 'date'] as DateType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={'seg' + (dateType === t ? ' seg--on' : '')}
              onClick={() => setDateType(t)}
              disabled={running}
            >
              {t === 'today' ? '오늘' : t === 'yesterday' ? '어제' : '직접 입력'}
            </button>
          ))}
          {dateType === 'date' && (
            <input
              type="date"
              className="sched__date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              disabled={running}
            />
          )}
        </div>
      </FormRow>

      {/* 시작 시간 */}
      <FormRow label="시작 시간">
        <input
          type="text"
          className="sched__time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          disabled={running}
        />
        <span className="hint">예: 9 = 09:00, 9.5 = 09:30</span>
      </FormRow>

      {/* 일정 입력 */}
      <FormRow
        column
        label={
          <>
            일정 (한 줄에 하나: <code>종료시간 일정명</code>)
          </>
        }
      >
        <textarea
          className="sched__textarea"
          value={scheduleText}
          onChange={(e) => setScheduleText(e.target.value)}
          placeholder={
            '10.5 [순수본] QA\n12.5 [순수본] 장바구니/주문서 V1.2\n15 [FE] 주간회의'
          }
          spellCheck={false}
          disabled={running}
        />
      </FormRow>

      {/* 버튼 */}
      <div className="form-actions">
        <Button onClick={() => run(true)} disabled={running}>
          테스트 (등록 안 함)
        </Button>
        <Button variant="primary" onClick={() => run(false)} disabled={running}>
          {running ? '실행 중…' : '일정 등록'}
        </Button>
        {running && (
          <Button variant="danger" onClick={cancel}>
            중지
          </Button>
        )}
      </div>
      <p className="note">
        ※ 실행하면 자동 조작용 브라우저가 열립니다. 등록이 끝나도 확인용으로 창이
        열려 있으니 확인 후 직접 닫으세요.
      </p>

      {/* 로그 */}
      <label className="form-label">실행 로그</label>
      <pre className="sched__log" ref={logRef}>
        {log || '실행하면 여기에 진행 상황이 표시됩니다.'}
      </pre>
    </div>
  );
}
