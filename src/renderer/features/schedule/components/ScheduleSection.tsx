import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { FormRow } from '../../../components/FormRow';
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

// 시작 시간 — 자주 쓰는 9시/9시 반은 바로 선택, 그 외엔 직접 입력
type TimeType = '9' | '9.5' | 'custom';

const TIME_OPTIONS: { value: TimeType; label: string }[] = [
  { value: '9', label: '09:00' },
  { value: '9.5', label: '09:30' },
  { value: 'custom', label: '직접 입력' },
];

// 하루 작업 기록 항목 — end 는 "HH:MM" (매크로·노션 텍스트로 변환 시 십진 시간)
type WorkItem = ScheduleWorkItem;

// "HH:MM" → 분 (형식이 어긋나면 -1 — 정렬 시 맨 앞)
const timeToMinutes = (t: string): number => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : -1;
};

// "HH:MM" → 노션·매크로용 십진 시간 문자열 (10:30 → "10.5", 11:00 → "11")
const timeToDecimal = (t: string): string =>
  String(Math.round((timeToMinutes(t) / 60) * 100) / 100);

// 현재 시각을 30분 단위로 반올림한 "HH:MM" — 새 항목의 종료시간 기본값
const roundedNow = (): string => {
  const now = new Date();
  const mins = Math.min(
    Math.round((now.getHours() * 60 + now.getMinutes()) / 30) * 30,
    23 * 60 + 30,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
};

// 노션에 붙여넣는 형식 그대로 — "종료시간 일정명" 줄 목록 (매크로 입력과 동일)
const buildNotionText = (items: WorkItem[]): string =>
  items
    .filter((it) => it.title.trim())
    .map((it) => `${timeToDecimal(it.end)} ${it.title.trim()}`)
    .join('\n');

/** 일정 등록 섹션 — 하루 작업을 기록해 두고, 버튼을 누르면 앱 내부 매크로가 실행된다. */
export function ScheduleSection() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [worklogLoaded, setWorklogLoaded] = useState(false);
  const [newTime, setNewTime] = useState(roundedNow);
  const [newTitle, setNewTitle] = useState('');
  const [timeType, setTimeType] = useState<TimeType>('9.5');
  const [customTime, setCustomTime] = useState('');
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

  const sortByEnd = (list: WorkItem[]) =>
    [...list].sort((a, b) => timeToMinutes(a.end) - timeToMinutes(b.end));

  const addItem = () => {
    const title = newTitle.trim();
    if (!title) return;
    setItems((prev) =>
      sortByEnd([
        ...prev,
        { id: crypto.randomUUID(), end: newTime, title },
      ]),
    );
    setNewTitle('');
    setNewTime(roundedNow());
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
    // 커스텀 시간("HH:MM")은 매크로가 쓰는 십진 시간(10.5 = 10:30)으로 변환
    const startTime =
      timeType === 'custom' ? timeToDecimal(customTime) : timeType;
    if (!startTime || startTime === 'NaN') {
      setLog('[경고] 시작 시간을 선택하세요.\n');
      return;
    }
    setLog('');
    setDone(false);
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

      {/* 날짜 */}
      <FormRow label="날짜">
        <div className="sched__segment">
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
        </div>
      </FormRow>

      {/* 시작 시간 — 9시/9시 반은 바로 선택, 그 외엔 직접 입력 */}
      <FormRow label="시작 시간">
        <div className="sched__segment">
          <Segment<TimeType>
            options={TIME_OPTIONS}
            value={timeType}
            onChange={setTimeType}
            disabled={running}
          />
          {timeType === 'custom' && (
            <TimePicker
              value={customTime}
              onChange={setCustomTime}
              disabled={running}
            />
          )}
        </div>
      </FormRow>

      {/* 작업 기록 — 중간중간 추가해 두는 하루 일정 목록 (종료시간순 자동 정렬) */}
      <FormRow column label="작업 기록 (항목: 종료시간 + 일정명 — 시작은 직전 항목 종료로 계산)">
        <div className="sched__worklog">
          {worklogLoaded && items.length === 0 && (
            <p className="hint sched__worklog-empty">
              아직 기록이 없습니다. 작업을 마칠 때마다 아래에서 추가하세요.
            </p>
          )}
          {items.map((it) => (
            <div className="sched__worklog-row" key={it.id}>
              <TimePicker
                value={it.end}
                onChange={(v) => updateItem(it.id, { end: v })}
                disabled={running}
              />
              <Input
                value={it.title}
                onChange={(e) => updateItem(it.id, { title: e.target.value })}
                disabled={running}
                spellCheck={false}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label="항목 삭제"
                onClick={() => removeItem(it.id)}
                disabled={running}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
          <div className="sched__worklog-add">
            <TimePicker
              value={newTime}
              onChange={setNewTime}
              disabled={running}
            />
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
            <Button size="sm" onClick={addItem} disabled={running || !newTitle.trim()}>
              <Icon name="plus" size={14} />
              추가
            </Button>
          </div>
        </div>
      </FormRow>

      {/* 버튼 — 좌: 등록 실행 / 우: 노션 복사·비우기 */}
      <div className="form-actions">
        <Button onClick={() => run(true)} disabled={running || !hasItems}>
          테스트 (등록 안 함)
        </Button>
        <Button
          variant="primary"
          onClick={() => run(false)}
          loading={running}
          disabled={!hasItems}
        >
          일정 등록
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

      {/* 로그 */}
      <label className="form-label">실행 로그</label>
      <pre className="panel-sunken panel-sunken--log sched__log" ref={logRef}>
        {log || '실행하면 여기에 진행 상황이 표시됩니다.'}
      </pre>
    </div>
  );
}
