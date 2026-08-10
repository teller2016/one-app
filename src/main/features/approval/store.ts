// 결재 입력 기본값 저장 — 마지막으로 작성한 내용을 다음 입력의 기본값으로 쓴다.
// 민감정보가 없어 평문 JSON (userData/approval.json). 계정은 환경설정의 비즈박스 공용.
import type {
  ExpendDefaults,
  OvertimeDefaults,
  VacationDefaults,
} from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'approval.json';
/** 예전 야근 결재 전용 저장본 — 처음 한 번 읽어 승격한다 */
const LEGACY_OVERTIME_FILE = 'overtime.json';

type Stored = {
  overtime?: OvertimeDefaults;
  expend?: ExpendDefaults;
  vacation?: VacationDefaults;
};

const FALLBACK_OVERTIME: OvertimeDefaults = { target: '', content: '', reason: '' };
const FALLBACK_EXPEND: ExpendDefaults = { manCount: 0, halfCount: 0 };
const FALLBACK_VACATION: VacationDefaults = {
  emergencyContact: '',
  handovers: [],
};

const read = (): Stored => readUserJson<Stored>(FILE, {});

export function getOvertimeDefaults(): OvertimeDefaults {
  const stored = read().overtime;
  if (stored) return { ...FALLBACK_OVERTIME, ...stored };
  // 결재 섹션으로 합치기 전(overtime.json)에 저장해 둔 값이 있으면 그대로 이어 쓴다
  const legacy = readUserJson<Partial<OvertimeDefaults>>(LEGACY_OVERTIME_FILE, {});
  return { ...FALLBACK_OVERTIME, ...legacy };
}

export function saveOvertimeDefaults(defaults: OvertimeDefaults): OvertimeDefaults {
  writeUserJson(FILE, { ...read(), overtime: defaults });
  return getOvertimeDefaults();
}

export function getExpendDefaults(): ExpendDefaults {
  return { ...FALLBACK_EXPEND, ...(read().expend ?? {}) };
}

export function saveExpendDefaults(expend: ExpendDefaults): ExpendDefaults {
  writeUserJson(FILE, { ...read(), expend });
  return getExpendDefaults();
}

export function getVacationDefaults(): VacationDefaults {
  return { ...FALLBACK_VACATION, ...(read().vacation ?? {}) };
}

export function saveVacationDefaults(
  vacation: VacationDefaults,
): VacationDefaults {
  writeUserJson(FILE, { ...read(), vacation });
  return getVacationDefaults();
}
