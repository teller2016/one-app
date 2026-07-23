// 클립보드 복사 + 결과 토스트 공용 훅 — 문구는 기본값 제공, 필요 시 오버라이드
import { useCallback } from 'react';
import { useToast } from '../components/Toast';

export function useCopy() {
  const toast = useToast();
  return useCallback(
    async (
      text: string,
      opts?: { success?: string; fail?: string },
    ): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        toast(opts?.success ?? '복사되었습니다');
        return true;
      } catch {
        // 창이 포커스를 잃은 상태 등 클립보드 접근 실패
        toast(opts?.fail ?? '복사에 실패했습니다', 'fail');
        return false;
      }
    },
    [toast],
  );
}
