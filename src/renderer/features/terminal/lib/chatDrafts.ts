// 채팅 입력창(폰)의 쓰던 글 — 세션별로 메모리에 둔다.
// 보기를 터미널로 바꾸면 채팅 화면(ChatView)이 언마운트돼 state 가 사라진다 — 화면 밖에 두면 돌아와도 그대로다.
// 앱을 다시 켜면 비어도 되는 값이라 저장소(userData)에 쓰지 않는다.

const drafts = new Map<string, string>();

export const getChatDraft = (key: string | undefined): string => (key ? (drafts.get(key) ?? '') : '');

export function setChatDraft(key: string | undefined, text: string) {
  if (!key) return;
  if (!text) drafts.delete(key);
  else drafts.set(key, text);
}
