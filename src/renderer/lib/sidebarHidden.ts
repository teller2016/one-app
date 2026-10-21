// 메뉴 사이드바 숨김 목록 — 눈 버튼으로 끈 섹션은 접힌 사이드바에서 빠진다(펼치면 흐리게 남는다).
// 정본은 main 의 settings.json(sidebarHidden)이다 — localStorage 는 강제 종료 때 날아가고
// 개발 인스턴스와 설치본이 서로 다른 origin 이라 공유되지 않는다. 다만 부팅 직후 IPC 응답 전에
// 숨긴 메뉴가 잠깐 그려졌다 사라지지 않게 미러를 두고 첫 렌더는 그 값으로 한다(lib/theme.ts 와 같은 방식).
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar:hidden-sections';

function readMirror(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeMirror(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

/** [숨긴 섹션 id 목록, 숨김 반전] — 반전은 즉시 화면에 반영하고 main 에 저장한다 */
export function useSidebarHidden(): [string[], (id: string) => void] {
  const [ids, setIds] = useState(readMirror);

  // 정본으로 맞춘다 — 다른 인스턴스(dev ↔ 설치본)에서 바꾼 값도 여기서 따라온다
  useEffect(() => {
    let alive = true;
    window.oneApp.settings
      .get()
      .then((s) => {
        if (!alive) return;
        writeMirror(s.sidebarHidden);
        setIds(s.sidebarHidden);
      })
      .catch(() => {
        // 조회 실패면 미러 값을 그대로 쓴다 — 메뉴는 숨김 여부와 무관하게 동작한다
      });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(
    (id: string) => {
      const next = ids.includes(id)
        ? ids.filter((x) => x !== id)
        : [...ids, id];
      setIds(next);
      writeMirror(next);
      window.oneApp.settings.setSidebarHidden(next).catch(() => {
        // 저장 실패는 이번 실행 동안만 유지된다 — 눈 버튼 하나에 토스트까지 띄우지 않는다
      });
    },
    [ids],
  );

  return [ids, toggle];
}
