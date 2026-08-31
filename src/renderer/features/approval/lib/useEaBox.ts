import { useState } from 'react';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';

/**
 * 전자결재 상신함 열기 — 올린 문서의 진행 상태를 확인하는 경로(작성 창과 별개 창).
 * 결재 홈과 완료 화면(DoneCard)이 같은 동작을 쓰므로 여기 한 곳에만 둔다.
 * main 이 창 하나를 재사용하므로 이미 열려 있으면 새로 열지 않고 앞으로 가져온다.
 */
export function useEaBox() {
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  const openEaBox = async () => {
    setOpening(true);
    // invoke 거부도 잡는다 — finally 가 없으면 opening 스피너가 영영 남는다
    try {
      const res = await window.oneApp.approval.openEaBox();
      if (!res.ok) toast(res.error ?? '전자결재 상신함을 열지 못했습니다.', 'fail');
    } catch (err) {
      toast(errMsg(err, '전자결재 상신함을 열지 못했습니다.'), 'fail');
    } finally {
      setOpening(false);
    }
  };

  return { opening, openEaBox };
}
