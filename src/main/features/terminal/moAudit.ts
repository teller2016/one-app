// 폰(MO)에서 실행한 쓰기 동작의 감사 기록 + PC 알림.
//
// 폰에서는 push·배포·PR 머지·출퇴근 찍기까지 되는데 무엇을 했는지 남는 곳이 없었다 — 토큰이
// 새면 PC 주인은 알 방법이 없다. `handleShared(채널, fn, { audit })` 로 이름을 단 채널만
// `userData/mo-audit.log` 에 남기고, PC 에는 마지막 1건을 고정 토스트로 띄운다(쌓이지 않게 교체).
// ⚠️ 폰 터미널(`/term`)의 셸 입력은 RPC 가 아니라 여기에 남지 않는다.
import { pad2 } from '../../../shared/date';
import { appendUserLog } from '../../lib/errorLog';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';
import { sendToast } from '../notify/notify';
import { formatAuditLine } from './moAuditFormat';

/** 기록 파일 — 개발 인스턴스(포트+1 의 MO 서버)와 설치본은 userData 를 공유하므로 이름을 가른다 */
export const MO_AUDIT_LOG = IS_DEV_INSTANCE ? 'mo-audit-dev.log' : 'mo-audit.log';

/**
 * 폰에서 감사 대상 채널을 부른 결과를 기록하고 PC 에 알린다 — error 가 null 이면 성공.
 * ⚠️ 절대 던지지 않는다 — 동작은 이미 끝났으므로 기록 실패가 폰에 '실패'로 돌아가면 안 된다.
 */
export function recordMoAction(
  label: string,
  channel: string,
  args: unknown[],
  error: string | null,
): void {
  try {
    const at = new Date();
    appendUserLog(MO_AUDIT_LOG, formatAuditLine(at, label, channel, args, error));
    const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
    sendToast({
      title: '폰에서 실행한 동작',
      message: `${time} ${label} — ${error ? `실패: ${error}` : '완료'}`,
      variant: error ? 'fail' : 'info',
      sticky: true,
      dedupeKey: 'mo-action',
    });
  } catch (err) {
    console.error('[mo:audit] 기록 실패', err);
  }
}
