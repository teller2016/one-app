// 입력 대기 알림 카드 — 공용 토스트 틀 안에 그린다(`toast(…, { render })`, 앱 셸 AppToastBridge 가 연다).
// 2026-10-06 시안 C '질문·권한에 바로 답하기'(캔버스 '입력 대기 알림 시안')를 사용자가 골랐다.
//
// 머리 = 저장소 색 타일 · '저장소 · 작업 제목' · 종류 뱃지 · ✕
// 몸통 = ① 번호 선택 화면이면 질문(+ 권한 확인이면 무엇을 허용하는지 미리보기) + 번호 버튼 — 누르면 main 이 **화면이 같은
//        질문일 때만** 그 번호 키를 보낸다(waitCard.ts). 이어지는 질문이 있으면 카드가 그 질문으로 바뀌고, 없으면 닫힌다.
//        ② 아니면 claude 의 마지막 답변 두 줄.
// 꼬리 = 안내 한 줄 + [세션으로 이동]
import { useState } from 'react';
import type { ChatPrompt } from '../../../../shared/terminal-protocol';
import { promptKey, type TerminalWaitCard } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { initials, tileColor } from '../lib/workspace';

/** 이미 답한 질문을 눌렀을 때 안내를 보여 준 뒤 닫기까지 */
const STALE_CLOSE_MS = 2500;

/** 종류 뱃지 — 질문·플랜 승인은 파랑(액센트), 권한 확인·일반 입력 대기는 주황(탭 점과 같은 주의색) */
function kindBadge(prompt: ChatPrompt | null): { label: string; variant: 'busy' | 'accent' } {
  if (!prompt) return { label: '입력 대기', variant: 'busy' };
  if (prompt.kind === 'permission') return { label: '권한 확인', variant: 'busy' };
  if (prompt.kind === 'plan') return { label: '플랜 승인', variant: 'accent' };
  return { label: '질문', variant: 'accent' };
}

export function WaitingToast({
  card,
  sessionId,
  onOpen,
  onClose,
}: {
  card: TerminalWaitCard;
  sessionId: string;
  /** 그 세션 터미널로 간다(팝아웃이면 그 창) — 카드도 닫는다 */
  onOpen: () => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<ChatPrompt | null>(card.prompt);
  const [sending, setSending] = useState(false);
  /** 버튼으로 더 답할 수 없을 때의 안내 — 있으면 버튼을 잠근다 */
  const [note, setNote] = useState<string | null>(null);

  const answer = async (n: number) => {
    const api = window.oneApp?.terminal?.answerPrompt;
    if (!prompt || !api) return onOpen();
    const sent = promptKey(prompt);
    setSending(true);
    try {
      const res = await api(sessionId, sent, n);
      if (res.ok) {
        if (!res.next) return onClose(); // 답이 끝났다 — claude 가 일을 이어 간다
        if (promptKey(res.next) === sent) {
          // 키는 보냈는데 화면이 그대로다 — 다시 누르면 두 번 답할 수 있어 버튼을 잠근다
          setNote('보냈지만 화면이 그대로입니다 — 터미널에서 확인해 주세요');
        } else {
          setPrompt(res.next); // 이어지는 질문(여러 질문 → 검토 화면)
        }
      } else if (res.reason === 'gone') {
        onClose();
      } else if (res.reason === 'invalid') {
        setNote('이 선택지는 터미널에서 직접 답해야 합니다');
      } else if (res.prompt) {
        // 그새 화면이 다른 질문으로 바뀌었다 — 지금 질문을 보여 주되 한 번 더 확인하게 한다
        setPrompt(res.prompt);
        setNote(null);
      } else {
        setNote('이미 답했거나 질문이 사라졌습니다');
        window.setTimeout(onClose, STALE_CLOSE_MS);
      }
    } catch {
      setNote('보내지 못했습니다 — 터미널에서 답해 주세요');
    } finally {
      setSending(false);
    }
  };

  const ws = card.workspace;
  const badge = kindBadge(prompt);
  const locked = sending || !!note;
  return (
    <div className="wait-toast">
      <div className="wait-toast__head">
        {ws ? (
          <span className={`terminal__ws-tile terminal__ws-tile--c${tileColor(ws)}`} aria-hidden="true">
            {initials(ws.name, 2)}
          </span>
        ) : (
          <span className="terminal__ws-tile" aria-hidden="true">
            <Icon name="folder" size={11} />
          </span>
        )}
        <span className="wait-toast__where">
          {ws?.name ?? '기타'} · {card.title}
        </span>
        <Badge variant={badge.variant} dot={false}>
          {badge.label}
        </Badge>
        <button type="button" className="toast__close" aria-label="닫기" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>

      {prompt ? (
        <>
          {prompt.header && <div className="wait-toast__step">{prompt.header}</div>}
          {prompt.question && <div className="wait-toast__q">{prompt.question}</div>}
          {prompt.preview && <pre className="wait-toast__preview">{prompt.preview}</pre>}
          <div className="wait-toast__opts">
            {prompt.options.map((o) =>
              o.n === prompt.freeText ? (
                <div key={o.n} className="wait-toast__opt wait-toast__opt--free">
                  <span className="wait-toast__num">{o.n}</span>
                  <span className="wait-toast__label">직접 답하기 — 터미널에서</span>
                </div>
              ) : (
                <button
                  key={o.n}
                  type="button"
                  className={'wait-toast__opt' + (o.current ? ' wait-toast__opt--current' : '')}
                  disabled={locked}
                  onClick={() => void answer(o.n)}
                >
                  <span className="wait-toast__num">{o.n}</span>
                  <span className="wait-toast__label">
                    {o.label}
                    {o.description && <span className="wait-toast__desc">{o.description}</span>}
                  </span>
                </button>
              ),
            )}
          </div>
        </>
      ) : (
        card.reply && <div className="wait-toast__reply">{card.reply}</div>
      )}

      <div className="wait-toast__foot">
        <span className="wait-toast__note">{note ?? (sending ? '보내는 중…' : '')}</span>
        <Button variant={prompt ? 'plain' : 'primary'} size="xs" onClick={onOpen}>
          세션으로 이동
        </Button>
      </div>
    </div>
  );
}
