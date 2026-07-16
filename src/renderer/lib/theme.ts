// 테마 적용 유틸 — data-theme 속성이 _base.scss 의 다크 토큰 블록을 켠다.
// 설정의 정본은 main 의 settings.json(theme 필드)이지만, 부팅 플래시를 막기 위해
// localStorage 에 미러를 두고 렌더러는 이 값으로 즉시 적용한다.
// (변경 시 window.oneApp.settings.setTheme 로 main 에도 저장 — 다음 실행 창 배경색용)
import { useSyncExternalStore } from 'react';
import type { ThemePref } from '../../shared/types';

const STORAGE_KEY = 'one-app:theme-pref';
const EVENT = 'one-app:themechange';

const media = window.matchMedia('(prefers-color-scheme: dark)');

/** 저장된 테마 설정 (기본 system) */
export function getThemePref(): ThemePref {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** 설정 → 실제 모드 해석 (system 은 macOS 화면 모드) */
function resolve(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return media.matches ? 'dark' : 'light';
  return pref;
}

/** 테마 적용 + localStorage 미러 갱신 + 변경 이벤트 발행 (차트 등 구독자용) */
export function applyThemePref(pref: ThemePref) {
  localStorage.setItem(STORAGE_KEY, pref);
  document.documentElement.dataset.theme = resolve(pref);
  window.dispatchEvent(new Event(EVENT));
}

/** 부팅 시 1회 — React 마운트 전에 호출해 첫 페인트부터 올바른 테마로 */
export function initTheme() {
  applyThemePref(getThemePref());
  // system 설정일 때 macOS 화면 모드 전환을 실시간 반영
  media.addEventListener('change', () => {
    if (getThemePref() === 'system') applyThemePref('system');
  });
}

// ── 테마 변경 구독 훅 (chart.js 처럼 토큰을 스냅숏으로 읽는 코드의 재생성 트리거용) ──
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};
const getSnapshot = () => document.documentElement.dataset.theme ?? 'light';

/** 현재 적용된 모드('light'|'dark') — 값이 바뀌면 리렌더된다 */
export function useThemeMode(): string {
  return useSyncExternalStore(subscribe, getSnapshot);
}
