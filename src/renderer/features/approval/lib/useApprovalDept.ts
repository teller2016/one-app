// 환경설정 '결재 소속' 값 — 야근 결재(근무자 표)·휴가신청서(제목)가 함께 쓴다.
//
// 기본값이 없으므로(2026-09-03 사용자 결정) 비어 있으면 main 이 작성을 막는다.
// 폼은 그 전에 배너로 알려 [작성 시작]을 눌러 보고 실패하는 일을 줄인다.
import { useEffect, useState } from 'react';

/** 저장된 결재 소속 문구. 아직 못 읽었거나 비어 있으면 빈 문자열 */
export function useApprovalDept(): string {
  const [dept, setDept] = useState('');
  useEffect(() => {
    void window.oneApp.settings
      .get()
      .then((s) => setDept(s.approvalDept))
      .catch(() => undefined); // 못 읽어도 폼은 그대로 쓴다 — 실패는 main 이 안내한다
  }, []);
  return dept;
}

/** 소속이 없을 때 배너에 띄우는 문구 (두 폼 공용) */
export const NO_DEPT_HINT =
  '환경설정 → 비즈박스 계정에서 결재 소속을 먼저 저장하세요 — 근무자 표의 소속 칸과 휴가 제목에 그대로 들어갑니다.';
