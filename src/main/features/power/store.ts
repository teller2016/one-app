// 잠잘 때 무선(블루투스·Wi-Fi) 끄기 — "우리가 껐다" 플래그.
//
// ⚠️ 이 플래그를 메모리에만 두면 안 된다. 2026-09-16 처럼 발열로 강제 종료되면 무선이
// 꺼진 채 남고, 다음 실행은 그걸 되돌릴 근거를 잃는다(사용자가 직접 꺼둔 것과 구분이 안 된다).
// 그래서 userData JSON 에 적어 재시작 뒤에도 복구할 수 있게 한다.
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'power.json';

/** 잠잘 때 끄는 무선 장치 */
export type RadioKind = 'bluetooth' | 'wifi';

interface StoredPower {
  /** 우리가 블루투스를 끈 시각(ms). 없으면 우리가 끈 적 없다 */
  btOffAt?: number;
  /** 우리가 Wi-Fi 를 끈 시각(ms). 없으면 우리가 끈 적 없다 */
  wifiOffAt?: number;
}

// ⚠️ 블루투스 키 이름(`btOffAt`)은 바꾸지 말 것 — 이미 저장된 파일이 있어 이름이 바뀌면 복구 근거를 잃는다
const KEY: Record<RadioKind, keyof StoredPower> = {
  bluetooth: 'btOffAt',
  wifi: 'wifiOffAt',
};

const read = (): StoredPower => readUserJson<StoredPower>(FILE, {});

/** 우리가 껐다고 기록 */
export function markRadioOff(kind: RadioKind): void {
  writeUserJson(FILE, { ...read(), [KEY[kind]]: Date.now() });
}

/** 되돌렸으니 기록 삭제 */
export function clearRadioOff(kind: RadioKind): void {
  const s = read();
  if (s[KEY[kind]] === undefined) return;
  delete s[KEY[kind]];
  writeUserJson(FILE, s);
}

/** 우리가 꺼서 아직 안 되돌린 상태인가 */
export function didWeTurnRadioOff(kind: RadioKind): boolean {
  return typeof read()[KEY[kind]] === 'number';
}
