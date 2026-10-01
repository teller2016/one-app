// 채팅 입력창의 쓰던 글·첨부 이미지 — 세션별로 메모리에 둔다(데스크톱 pane·폰 공용).
// 보기를 터미널로 바꾸면 채팅 화면(ChatView)이 언마운트돼 state 가 사라진다 — 그러면 붙여 둔 이미지 칩이
// 없어지는데 claude 쪽엔 남아 있는 어긋남이 생겼다(2026-10-01 사용자 신고). 화면 밖에 두면 돌아와도 그대로다.
// 앱을 다시 켜면 비어도 되는 값이라 저장소(userData)에 쓰지 않는다.

/** 첨부 한 장 — path 는 claude 에 붙여넣을 경로, url 은 미리보기(붙여넣은 이미지만 — 끌어다 놓은 파일은 없음) */
export type ChatAttachment = { path: string; name: string; url?: string };

export type ChatDraft = { text: string; attachments: ChatAttachment[] };

const drafts = new Map<string, ChatDraft>();
const EMPTY: ChatDraft = { text: '', attachments: [] };

export const getChatDraft = (key: string | undefined): ChatDraft => (key ? (drafts.get(key) ?? EMPTY) : EMPTY);

export function setChatDraft(key: string | undefined, draft: ChatDraft) {
  if (!key) return;
  if (!draft.text && !draft.attachments.length) drafts.delete(key);
  else drafts.set(key, draft);
}
