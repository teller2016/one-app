// 푸시 확인 다이얼로그 문구 — 드로어(ChangesView)·전체화면(ChangesOverlay) 공용.
import type { ChangesStatus } from '../../../../shared/types';

/**
 * upstream 이 현재 브랜치와 다른 이름을 가리키면(--no-track 이전 워크트리 브랜치가
 * origin/main 을 추적) 실제 목적지인 origin/<브랜치> 로 안내한다 — main 의
 * pushChanges 가 같은 판정으로 -u origin HEAD 푸시를 하며 추적을 바로잡는다.
 */
export function pushConfirmMessage(s: ChangesStatus): string {
  if (!s.upstream) {
    return `'${s.branch}' 는 원격에 없는 새 브랜치입니다 — origin 에 브랜치를 만들며 푸시합니다.`;
  }
  const count = s.unpushed?.length ?? 0;
  const upstreamBranch = s.upstream.split('/').slice(1).join('/');
  const dest = upstreamBranch === s.branch ? s.upstream : `origin/${s.branch}`;
  return `${s.branch} → ${dest} 로 커밋 ${count}개를 푸시합니다.`;
}
