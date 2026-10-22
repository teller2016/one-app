// 일정 등록 섹션 밖(루트 세션)에서 "작업 기록에 이 항목들을 더하고 날짜·시작 시각을 맞춰 달라"는 요청을 넘기는 통로.
//
// 섹션이 작업 기록(worklog.json)을 직접 들고 300ms 디바운스로 저장하므로, main 이 파일만 고치면 떠 있는 섹션이 옛 값으로 덮는다 —
// 그래서 배포의 `deployRequest.ts` 와 같은 패턴으로 요청을 넘기고 **섹션이 자기 상태에** 더한다.
// ⚠️ 여기서는 등록하지 **않는다** — [일정 등록]·[노션에 기록]은 사용자가 누른다.
import type { ScheduleFill } from '../../../../shared/types';
import { createSectionRequest } from '../../../lib/sectionRequest';

const channel = createSectionRequest<ScheduleFill>('schedule');

/** 일정 등록 섹션으로 이동하며 작업 기록에 더해 달라고 요청한다 */
export const requestScheduleFill = channel.request;
/** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다 · 30초 지난 것은 버린다) */
export const takeScheduleRequest = channel.take;
/** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
export const onScheduleRequest = channel.on;
