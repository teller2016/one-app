// 클립보드 복사 + 결과 토스트 공용 훅 — 문구는 기본값 제공, 필요 시 오버라이드
import { useCallback } from 'react';
import { useToast } from '../components/Toast';

/**
 * 폴백 복사 — 폰(MO) 셸은 평문 http 로 서빙되는 insecure context 라
 * `navigator.clipboard` 가 아예 없다. 그 환경에서도 복사가 되도록 execCommand 를 쓴다.
 */
function copyViaTextarea(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length); // iOS 는 select() 만으로는 부족하다
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (
      text: string,
      opts?: { success?: string; fail?: string },
    ): Promise<boolean> => {
      try {
        if (!navigator.clipboard) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        toast(opts?.success ?? '복사되었습니다');
        return true;
      } catch {
        // 창이 포커스를 잃은 상태, 또는 insecure context(폰 MO) — 폴백을 시도한다
        if (copyViaTextarea(text)) {
          toast(opts?.success ?? '복사되었습니다');
          return true;
        }
        toast(opts?.fail ?? '복사에 실패했습니다', 'fail');
        return false;
      }
    },
    [toast],
  );
}
