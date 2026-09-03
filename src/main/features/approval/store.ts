// 결재 입력 기본값 저장 — 마지막으로 작성한 내용을 다음 입력의 기본값으로 쓴다.
// 민감정보가 없어 평문 JSON (userData/approval.json). 계정은 환경설정의 비즈박스 공용.
import type {
  ExpendDefaults,
  OvertimeDefaults,
  VacationDefaults,
} from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';
import { getApprovalDeptSetting } from '../settings/store';

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

/**
 * 근무자 표·제목에 쓰는 소속 문구 — **환경설정의 '결재 소속' 이 유일한 출처**다.
 * 야근(근무자 표)·휴가(제목)가 함께 쓴다.
 *
 * ⚠️ 기본값을 되살리지 말 것(2026-09-03 사용자 요청으로 제거) — 코드에 사내 부문명을
 * 박아 두면 다른 챕터 동료가 단독판을 쓸 때 조용히 남의 소속으로 결재가 올라간다.
 * 비어 있으면 `ipc.ts` 가 야근·휴가 작성을 막고 설정을 채우라고 안내한다.
 */
export function getWorkerDept(): string {
  return getApprovalDeptSetting();
}
