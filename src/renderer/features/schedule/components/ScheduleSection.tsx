import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { Segment } from '../../../components/Segment';
import { Input } from '../../../components/Input';
import { DatePicker } from '../../../components/DatePicker';
import { TimePicker } from '../../../components/TimePicker';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useCopy } from '../../../lib/useCopy';
import type { ScheduleWorkItem } from '../../../../shared/types';

type DateType = 'today' | 'yesterday' | 'date';

const DATE_OPTIONS: { value: DateType; label: string }[] = [
  { value: 'today', label: '오늘' },
  { value: 'yesterday', label: '어제' },
  { value: 'date', label: '직접 입력' },
];

// 하루 작업 기록 항목 — end 는 "HH:MM" (매크로·노션 텍스트로 변환 시 십진 시간)
type WorkItem = ScheduleWorkItem;

// 점심 규칙 — main/features/schedule/config.ts 의 lunchStartTime/lunchEndTime(12.5/13.5)과 동기.
// 12:30 에 끝나는 일정 다음은 13:30 에 시작한다 (매크로와 동일하게 미리 보여준다).
const LUNCH_START_MIN = 12 * 60 + 30;
const LUNCH_END_MIN = 13 * 60 + 30;
const WORKDAY_MIN = 8 * 60; // 하루 기준 근무시간 — 초과분은 OT 로 표시

const pad = (n: number) => String(n).padStart(2, '0');

// "HH:MM" → 분 (형식이 어긋나면 -1 — 정렬 시 맨 앞)
const timeToMinutes = (t: string): number => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : -1;
};

// 분 → "HH:MM"
const minutesToTime = (m: number): string =>
  `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// "HH:MM" → 노션·매크로용 십진 시간 문자열 (10:30 → "10.5", 11:00 → "11")
const timeToDecimal = (t: string): string =>
  String(Math.round((timeToMinutes(t) / 60) * 100) / 100);

// 소요 분 → "1h 30m" (0 이하면 잘못된 순서 — '—')
const formatDuration = (mins: number): string => {
  if (mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
};

// 합계 분 → 십진 시간 표기 ("7.5h") — 주간보고 T/OT 감각과 동일
const formatHours = (mins: number): string =>
  `${Math.round((mins / 60) * 10) / 10}h`;

// 노션에 붙여넣는 형식 그대로 — "종료시간 일정명" 줄 목록 (매크로 입력과 동일)
const buildNotionText = (items: WorkItem[]): string =>
  items
    .filter((it) => it.title.trim())
    .map((it) => `${timeToDecimal(it.end)} ${it.title.trim()}`)
    .join('\n');

/** 일정 등록 섹션 — 하루 작업을 타임라인으로 기록해 두고, 버튼 한 번으로 매크로 등록한다. */
export function ScheduleSection() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [worklogLoaded, setWorklogLoaded] = useState(false);
  const [newTime, setNewTime] = useState('09:30');
  const [newTitle, setNewTitle] = useState('');
  const [startTime, setStartTime] = useState('09:30');
  const [dateType, setDateType] = useState<DateType>('today');
  const [customDate, setCustomDate] = useState('');
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [log, setLog] = useState('');
  const [credsReady, setCredsReady] = useState<boolean | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const itemsRef = useRef<WorkItem[]>(items);
  const worklogDirtyRef = useRef(false);
  const confirm = useConfirm();
  const copy = useCopy();

  // 매크로 출력/종료 이벤트 구독
  useEffect(() => {
    if (!window.oneApp?.schedule) return;
    const offOutput = window.oneApp.schedule.onOutput(({ data }) => {
      setLog((prev) => prev + data);
      if (data.includes('등록 완료') || data.includes('페이지 이동까지 완료')) {
        setRunning(false);
      }
      // 실제 등록이 끝났을 때만 노션 복사 안내 (테스트 모드는 '등록 완료'를 찍지 않음)
      if (data.includes('등록 완료')) setDone(true);
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

  // 작업 기록 복원 — userData/worklog.json (localStorage 는 강제 종료 시 유실돼 사용 안 함)
  useEffect(() => {
    window.oneApp?.schedule.getWorklog().then((list) => {
      setItems(list);
      setWorklogLoaded(true);
    });
  }, []);

  // 변경 시 저장 — 타이핑 부하를 피해 300ms 디바운스, 언마운트 시 미저장분 flush
  useEffect(() => {
    itemsRef.current = items;
    if (!worklogLoaded) return;
    worklogDirtyRef.current = true;
    const t = setTimeout(() => {
      worklogDirtyRef.current = false;
      window.oneApp?.schedule.setWorklog(items);
    }, 300);
    return () => clearTimeout(t);
  }, [items, worklogLoaded]);

  useEffect(
    () => () => {
      if (worklogDirtyRef.current)
        window.oneApp?.schedule.setWorklog(itemsRef.current);
    },
    [],
  );

  // 로그 자동 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // 타임라인 계산 — 각 항목의 시작은 직전 항목 종료(점심에 끝나면 점심 후)
  const timeline = useMemo(() => {
    let cursor = timeToMinutes(startTime);
    return items.map((item) => {
      const endMin = timeToMinutes(item.end);
      const row = {
        item,
        startMin: cursor,
        durMin: endMin - cursor,
        lunchAfter: endMin === LUNCH_START_MIN,
      };
      cursor = endMin === LUNCH_START_MIN ? LUNCH_END_MIN : endMin;
      return row;
    });
  }, [items, startTime]);

  // 다음 항목이 시작할 시각 (추가 행에 미리 표시)
  const nextStartMin = timeline.length
    ? (() => {
        const last = timeline[timeline.length - 1];
        return last.lunchAfter ? LUNCH_END_MIN : timeToMinutes(last.item.end);
      })()
    : timeToMinutes(startTime);

  const totalMin = timeline.reduce((s, r) => s + Math.max(0, r.durMin), 0);
  const otMin = Math.max(0, totalMin - WORKDAY_MIN);

  // 추가 행의 시간 기본값은 마지막 종료 시각(=다음 시작)을 따라간다 —
  // 항목 추가·수정·삭제로 다음 시작이 바뀌면 함께 갱신 (직접 바꾼 뒤에도 목록이 바뀌면 리셋)
  useEffect(() => {
    setNewTime(minutesToTime(nextStartMin));
  }, [nextStartMin]);

  const sortByEnd = (list: WorkItem[]) =>
    [...list].sort((a, b) => timeToMinutes(a.end) - timeToMinutes(b.end));

  const addItem = () => {
    const title = newTitle.trim();
    if (!title) return;
    const next = sortByEnd([
      ...items,
      { id: crypto.randomUUID(), end: newTime, title },
    ]);
    setItems(next);
    setNewTitle('');
    // 피커를 항상 새 목록의 다음 시작으로 리셋 — 소급 추가처럼 nextStartMin 이
    // 안 바뀌는 경우엔 동기화 효과가 안 돌므로 여기서 직접 맞춘다
    const lastEnd = timeToMinutes(next[next.length - 1].end);
    setNewTime(
      minutesToTime(lastEnd === LUNCH_START_MIN ? LUNCH_END_MIN : lastEnd),
    );
  };

  const updateItem = (id: string, patch: Partial<Omit<WorkItem, 'id'>>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.id === id ? { ...it, ...patch } : it));
      // 종료시간이 바뀌면 시간순 유지 (제목 타이핑 중에는 순서 그대로)
      return patch.end !== undefined ? sortByEnd(next) : next;
    });
  };

  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((it) => it.id !== id));

  const clearAll = async () => {
    if (
      !(await confirm({
        title: '작업 기록 비우기',
        message: '기록한 항목을 모두 삭제합니다. 노션에 옮겨두셨나요?',
        danger: true,
      }))
    )
      return;
    setItems([]);
    setDone(false);
  };

  const copyNotion = () =>
    copy(buildNotionText(items), { success: '노션용 텍스트를 복사했습니다' });

  const run = async (testMode: boolean) => {
    if (!window.oneApp?.schedule) {
      setLog('[오류] 앱 연결(preload)이 되지 않았습니다.\n');
      return;
    }
    const scheduleText = buildNotionText(items);
    if (!scheduleText) {
      setLog('[경고] 작업 기록이 비어 있습니다. 항목을 먼저 추가하세요.\n');
      return;
    }
    if (dateType === 'date' && !customDate) {
      setLog('[경고] 날짜를 선택하세요.\n');
      return;
    }
    setLog('');
    setDone(false);
    setRunning(true);
    const res = await window.oneApp.schedule.run({
      scheduleText,
      startTime: timeToDecimal(startTime),
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

  const hasItems = items.some((it) => it.title.trim());

  return (
    <div className="section">
      <SectionHeader
        icon={<Icon name="calendar" size={18} />}
        title="일정 등록"
        sub="하루 작업을 기록해 두고 비즈박스 그룹웨어에 자동 등록합니다."
      />

      {credsReady === false && (
        <Banner>
          비즈박스 계정 정보가 없습니다. <b>환경설정</b> 탭에서 아이디/비밀번호를
          먼저 저장하세요.
        </Banner>
      )}

      {/* 툴바 — 날짜·시작 시간 (자주 안 바꾸는 설정은 한 줄로 압축) */}
      <div className="sched__toolbar">
        <span className="sched__toolbar-label">날짜</span>
        <Segment<DateType>
          options={DATE_OPTIONS}
          value={dateType}
          onChange={setDateType}
          disabled={running}
        />
        {dateType === 'date' && (
          <DatePicker
            value={customDate}
            onChange={setCustomDate}
            disabled={running}
          />
        )}
        <span className="sched__toolbar-label">시작</span>
        <TimePicker
          value={startTime}
          onChange={setStartTime}
          disabled={running}
        />
      </div>

      {/* 타임라인 카드 — 기록이 주인공 */}
      <div className="sched__card">
        <div className="sched__card-head">
          <span className="sched__card-title">작업 기록</span>
          {items.length > 0 && (
            <span className="sched__card-total">
              합계 {formatHours(totalMin)}
              {otMin > 0 && (
                <>
                  {' · '}
                  <b>OT {formatHours(otMin)}</b>
                </>
              )}
            </span>
          )}
        </div>

        {worklogLoaded && items.length === 0 && (
          <p className="hint sched__empty">
            아직 기록이 없습니다. 작업을 마칠 때마다 아래에서 추가하세요.
          </p>
        )}

        {timeline.map((row) => (
          <Fragment key={row.item.id}>
            <div className="sched__row">
              <span className="sched__row-start">
                {minutesToTime(row.startMin)} →
              </span>
              <TimePicker
                value={row.item.end}
                onChange={(v) => updateItem(row.item.id, { end: v })}
                disabled={running}
              />
              <span
                className={
                  'sched__row-dur' +
                  (row.durMin <= 0 ? ' sched__row-dur--warn' : '')
                }
              >
                {formatDuration(row.durMin)}
              </span>
              <Input
                value={row.item.title}
                onChange={(e) =>
                  updateItem(row.item.id, { title: e.target.value })
                }
                disabled={running}
                spellCheck={false}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="항목 삭제"
                onClick={() => removeItem(row.item.id)}
                disabled={running}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            {row.lunchAfter && (
              <div className="sched__lunch">점심 12:30–13:30</div>
            )}
          </Fragment>
        ))}

        {/* 추가 행 — 다음 시작 시각을 미리 보여준다 */}
        <div className="sched__add">
          <span className="sched__row-start">
            {minutesToTime(nextStartMin)} →
          </span>
          <TimePicker value={newTime} onChange={setNewTime} disabled={running} />
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) addItem();
            }}
            placeholder="일정명 — 예: [순수본] QA + 개선건"
            spellCheck={false}
            disabled={running}
          />
          <Button
            size="sm"
            onClick={addItem}
            disabled={running || !newTitle.trim()}
          >
            <Icon name="plus" size={14} />
            추가
          </Button>
        </div>
      </div>

      {/* 액션 — 좌: 등록 실행 / 우: 노션 복사·비우기 */}
      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => run(false)}
          loading={running}
          disabled={!hasItems}
        >
          일정 등록
        </Button>
        <Button onClick={() => run(true)} disabled={running || !hasItems}>
          테스트 (등록 안 함)
        </Button>
        {running && (
          <Button variant="danger" onClick={cancel}>
            중지
          </Button>
        )}
        <span className="sched__actions-gap" />
        <Button onClick={copyNotion} disabled={running || !hasItems}>
          <Icon name="copy" size={14} />
          노션용 복사
        </Button>
        <Button onClick={clearAll} disabled={running || items.length === 0}>
          비우기
        </Button>
      </div>
      {done && (
        <p className="note">
          ✅ 등록 완료 — [노션용 복사]를 눌러 그대로 노션에 붙여넣을 수 있습니다.
        </p>
      )}
      <p className="note">
        ※ 실행하면 자동 조작용 브라우저가 열립니다. 등록이 끝나도 확인용으로 창이
        열려 있으니 확인 후 직접 닫으세요.
      </p>

      {/* 실행 로그 — 실행 전엔 숨겨 화면을 차지하지 않는다 */}
      {(running || log) && (
        <>
          <label className="form-label">실행 로그</label>
          <pre
            className="panel-sunken panel-sunken--log sched__log"
            ref={logRef}
          >
            {log}
          </pre>
        </>
      )}
    </div>
  );
}
