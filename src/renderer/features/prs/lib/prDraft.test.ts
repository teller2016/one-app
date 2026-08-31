import { describe, expect, it } from 'vitest';
import type { DeployCommit } from '../../../../shared/types';
import { draftPr } from './prDraft';

const commit = (message: string, extra?: Partial<DeployCommit>): DeployCommit => ({
  id: message, // 테스트에선 메시지로 구분하면 충분
  message,
  author: '테스터',
  ...extra,
});

describe('draftPr', () => {
  it('작업 유형 우선순위로 대표 커밋을 고른다 (동순위면 오래된 쪽)', () => {
    const { title, body } = draftPr('BBJ-1', [
      commit('chore: 설정 정리'),
      commit('feat: 장바구니 추가'),
      commit('feat: 장바구니 뱃지'),
    ]);
    expect(title).toBe('[BBJ-1] feat: 장바구니 추가');
    expect(body.split('\n')).toHaveLength(3);
  });

  it('머지 커밋은 제목 후보·본문에서 뺀다', () => {
    const { title, body } = draftPr('BBJ-2', [
      commit("Merge pull request 'x' from develop", { isMerge: true }),
      commit('fix: 오탈자'),
    ]);
    expect(title).toBe('[BBJ-2] fix: 오탈자');
    expect(body).toBe('- fix: 오탈자');
  });

  it('다른 주요 브랜치에 이미 머지된 커밋(alreadyIn)은 제목·본문에서 뺀다', () => {
    // main 머지를 거친 브랜치를 develop 으로 PR 하는 시나리오 —
    // main 에서 딸려온 남의 옛 feat 가 제목이 되면 안 된다 (2026-08-31 사용자 신고)
    const { title, body } = draftPr('BBJ-3', [
      commit('feat: 남의 옛 작업', { alreadyIn: 'main' }),
      commit('chore: 남의 옛 정리', { alreadyIn: 'main' }),
      commit('fix: 이번 작업'),
    ]);
    expect(title).toBe('[BBJ-3] fix: 이번 작업');
    expect(body).toBe('- fix: 이번 작업');
  });

  it('새 커밋이 하나도 없으면 제목은 라벨만, 본문은 비머지 전체를 싣는다', () => {
    const { title, body } = draftPr('BBJ-4', [
      commit("Merge branch 'main'", { isMerge: true }),
      commit('feat: 이미 반영된 작업', { alreadyIn: 'main' }),
    ]);
    expect(title).toBe('[BBJ-4]');
    expect(body).toBe('- feat: 이미 반영된 작업');
  });
});
