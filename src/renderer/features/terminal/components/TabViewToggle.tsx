// 세션 탭 안의 작은 보기 토글(터미널 ↔ 채팅) — 사용자 요청 2026-10-01 "탭에 토글 아주 작게 각자".
// 탭 렌더 함수 안에서는 훅을 못 부르므로 작은 컴포넌트로 뺐다. 보기는 lib/chatViews(세션별 기억, 기본 터미널).
import { memo } from 'react';
import { Icon } from '../../../components/Icon';
import { Tooltip } from '../../../components/Tooltip';
import { toggleChatView, useChatView } from '../lib/chatViews';

export const TabViewToggle = memo(function TabViewToggle({ id, title }: { id: string; title: string }) {
  const chat = useChatView(id) === 'chat';
  const label = chat ? '터미널로 보기' : '채팅으로 보기 (claude 대화)';
  return (
    <Tooltip label={`${label} (⌘E)`}>
      <button
        type="button"
        className={'terminal__tab-view' + (chat ? ' terminal__tab-view--on' : '')}
        aria-label={`'${title}' ${label}`}
        aria-pressed={chat}
        onClick={(e) => {
          e.stopPropagation(); // 탭 선택(클릭)과 겹치지 않게 — 보기만 바꾼다
          toggleChatView(id);
        }}
      >
        <Icon name={chat ? 'terminal' : 'message-square'} size={12} />
      </button>
    </Tooltip>
  );
});
