// ⌘P 명령 팔레트의 명령 등록소.
//
// 명령의 주인은 각 기능(상태바 위젯 등)이다 — 출근 찍기·VPN 연결 같은 동작은 그 위젯의
// 상태와 확인창 흐름을 그대로 써야 하므로, 팔레트가 동작을 다시 구현하지 않고 위젯이
// 떠 있는 동안 자기 명령을 **등록**한다. 팔레트는 열릴 때(그리고 입력할 때마다) 모은다.
// `sectionNav.ts` 와 같은 얇은 모듈 등록소다.
//
// ⚠️ 등록하는 것은 명령 배열이 아니라 **만드는 함수**다 — 위젯의 핸들러는 렌더마다 새로
// 만들어지므로 배열을 등록하면 매 렌더 재등록이 된다. ref 로 최신 함수만 바꿔 끼운다.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { IconName } from '../components/Icon';

export type CommandGroup = '이동' | '명령' | '배포';

export type Command = {
  /** 등록소 안에서 고유 — 팔레트 선택 유지·key 에 쓴다 */
  id: string;
  group: CommandGroup;
  label: string;
  /** 오른쪽 보조 문구 (현재 상태·대상 등) */
  hint?: string;
  /** 검색에만 쓰는 추가 단어 (영문 별칭 등) */
  keywords?: string;
  icon?: IconName;
  run: () => void;
};

const sources = new Map<string, { current: () => Command[] }>();

/**
 * 컴포넌트가 떠 있는 동안 명령을 등록한다 — 언마운트하면 빠진다.
 * `build` 는 매 렌더 새 함수여도 된다(ref 로 최신만 쓴다).
 */
export function useRegisterCommands(sourceId: string, build: () => Command[]): void {
  const ref = useRef(build);
  useLayoutEffect(() => {
    ref.current = build;
  });
  useEffect(() => {
    sources.set(sourceId, ref);
    return () => {
      // 같은 id 로 다른 인스턴스가 다시 등록했으면 그쪽을 지우지 않는다
      if (sources.get(sourceId) === ref) sources.delete(sourceId);
    };
  }, [sourceId]);
}

/** 지금 등록된 명령 전부 — 팔레트가 열릴 때·입력할 때 부른다 */
export function collectCommands(): Command[] {
  const out: Command[] = [];
  for (const r of sources.values()) out.push(...r.current());
  return out;
}
