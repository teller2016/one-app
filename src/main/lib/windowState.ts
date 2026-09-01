// 창 크기·위치 기억 — 다시 켰을 때 마지막으로 두었던 자리·크기에서 시작한다.
// userData/window-state.json 에 저장한다(보존 대상이라 localStorage 를 쓰지 않는다).
import { runtimeFile } from './devInstance';
import { readUserJson, writeUserJson } from './store';
import { screen } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';

// 개발 인스턴스는 별도 파일 — 빌드 앱과 창이 정확히 겹쳐 떠서 어느 쪽인지 모르게 되는 걸 막는다
const FILE = runtimeFile('window-state.json');

/** 창 기본 크기·최소 크기 — createWindow 의 값과 여기가 정본이다 */
export const WINDOW_DEFAULT = { width: 1280, height: 800 };
export const WINDOW_MIN = { width: 900, height: 600 };

type SavedState = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 최대화(맥의 zoom) 상태였는지 — 전체화면은 복원하지 않는다 */
  maximized?: boolean;
};

/** 파일 포맷: 창 키(메인 'main', 팝아웃 'popout:<id>') → 상태 */
type StateFile = Record<string, SavedState>;

function readAll(): StateFile {
  const raw = readUserJson<Record<string, unknown>>(FILE, {});
  // 구포맷(루트에 x/width 가 바로 있던 단일 창 시절) → main 레코드로 해석.
  // 다음 저장 때 새 포맷으로 굳으므로 별도 마이그레이션 저장은 하지 않는다.
  if (typeof raw.width === 'number' || typeof raw.x === 'number') {
    return { main: raw as SavedState };
  }
  return raw as StateFile;
}

/**
 * 저장된 사각형이 지금 연결된 화면에서 실제로 잡을 수 있는 자리인지.
 * 외부 모니터에 두고 껐다가 노트북만으로 켜면 좌표가 화면 밖이라
 * 창이 보이지 않는다(있긴 한데 손이 닿지 않는다) — 그 경우를 걸러낸다.
 */
function isReachable(b: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    const overlapX = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const overlapY = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    // 타이틀바를 잡아 끌 수 있을 만큼은 보여야 한다
    return overlapX >= 120 && overlapY >= 60;
  });
}

/**
 * 저장된 창 상태를 BrowserWindow 옵션으로 — 없거나 화면 밖이면 기본값(중앙 배치).
 * `maximized` 는 창을 만든 뒤 호출부가 처리한다.
 * 메인 창 외의 창(팝아웃)은 `key` 로 갈라 저장하고, 기본·최소 크기가 다르면 `spec` 으로 준다.
 */
export function loadWindowState(
  key = 'main',
  spec: {
    defaults?: typeof WINDOW_DEFAULT;
    min?: typeof WINDOW_MIN;
    /** 이 키의 기억이 없을 때 물려받을 키 — 팝아웃의 '마지막 크기'(popout-last)용.
     *  창 id 는 매번 새로 생기므로 개별 키만으로는 크기가 영영 기억되지 않는다. */
    fallbackKey?: string;
  } = {}
): SavedState & { width: number; height: number } {
  const def = spec.defaults ?? WINDOW_DEFAULT;
  const min = spec.min ?? WINDOW_MIN;
  const all = readAll();
  const saved = all[key] ?? (spec.fallbackKey ? all[spec.fallbackKey] : undefined) ?? {};
  const width = Math.max(min.width, Math.round(saved.width ?? def.width));
  const height = Math.max(min.height, Math.round(saved.height ?? def.height));
  const maximized = saved.maximized === true;

  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    return { width, height, maximized };
  }
  const x = Math.round(saved.x);
  const y = Math.round(saved.y);
  return isReachable({ x, y, width, height })
    ? { x, y, width, height, maximized }
    : { width, height, maximized }; // 좌표만 버리고 크기는 살린다 (기본 중앙 배치)
}

/**
 * 창의 크기·위치 변화를 추적해 저장한다 (창 생성 직후 1회 호출).
 * resize/move 는 드래그 중 초당 수십 번 오므로 디바운스하고, 닫을 때 마지막 상태를
 * 한 번 더 확정한다(디바운스 대기 중 닫으면 마지막 이동이 유실되므로).
 */
export function trackWindowState(win: BrowserWindow, key = 'main'): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const save = () => {
    if (win.isDestroyed()) return;
    // ⚠️ getBounds() 가 아니라 getNormalBounds() — 최대화·전체화면 상태에서는
    // 화면 전체 크기가 잡혀서, 다음 실행 때 창을 되돌릴 크기를 잃는다.
    const b = win.getNormalBounds();
    writeUserJson(FILE, {
      ...readAll(),
      [key]: { ...b, maximized: win.isMaximized() },
    });
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };

  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

/**
 * 크기만 다른 키로 물려준다 — 팝아웃이 닫힐 때 '마지막 팝아웃 크기' 승계용.
 * 좌표는 옮기지 않는다(다음 창이 이전 창 자리에 겹쳐 뜨는 것을 막는다).
 * ⚠️ `to` 는 `popout:` 접두사를 쓰지 말 것 — pruneWindowStates 가 고아로 보고 지운다.
 */
export function inheritWindowSize(from: string, to: string): void {
  const all = readAll();
  const s = all[from];
  if (typeof s?.width !== 'number' || typeof s?.height !== 'number') return;
  all[to] = { width: s.width, height: s.height };
  writeUserJson(FILE, all);
}

/** 창 상태 삭제 — 팝아웃을 사용자가 닫아 레코드가 사라질 때 함께 지운다 */
export function clearWindowState(key: string): void {
  const all = readAll();
  if (!(key in all)) return;
  delete all[key];
  writeUserJson(FILE, all);
}

/**
 * 고아 키 정리 — `keep` 이 false 인 popout:* 키를 지운다 (시작 시 1회).
 * main 키는 건드리지 않는다.
 */
export function pruneWindowStates(keep: (key: string) => boolean): void {
  const all = readAll();
  const next: StateFile = {};
  let changed = false;
  for (const [key, state] of Object.entries(all)) {
    if (key !== 'main' && key.startsWith('popout:') && !keep(key)) {
      changed = true;
      continue;
    }
    next[key] = state;
  }
  if (changed) writeUserJson(FILE, next);
}
