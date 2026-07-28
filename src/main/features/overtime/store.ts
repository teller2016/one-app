// 야근 결재 기본값 저장 — 마지막으로 작성한 업무내용을 다음 입력의 기본값으로 쓴다.
// 민감정보가 없어 평문 JSON (userData/overtime.json)
import type { OvertimeDefaults } from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'overtime.json';

const FALLBACK: OvertimeDefaults = {
  target: '',
  content: '',
  reason: '',
};

export function getOvertimeDefaults(): OvertimeDefaults {
  return { ...FALLBACK, ...readUserJson<Partial<OvertimeDefaults>>(FILE, {}) };
}

export function saveOvertimeDefaults(defaults: OvertimeDefaults): OvertimeDefaults {
  writeUserJson(FILE, defaults);
  return getOvertimeDefaults();
}
