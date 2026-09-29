// 결재 3종(야근·휴가·지출결의서) 공용 실행 잠금.
//
// ⚠️ 세 흐름은 같은 자동화 파티션(`gw-approval`)을 쓰고, `openPage` 가 시작할 때마다 그 파티션의
// 저장소를 비운다(`clearStorageData`). 모듈마다 따로 막으면 휴가 작성 도중 출퇴근 위젯의 야근
// 모달에서 [작성 시작]을 눌렀을 때 휴가 쪽 세션이 지워져 중간에 깨진다 — 휴가의 근태신청 저장이
// 이미 들어갔다면 결재 문서 없는 근태신청만 남는다. 그래서 잠금은 결재 전체에 하나다.

let owner: string | null = null;

/** 지금 잠금을 쥔 결재 종류 (없으면 null) */
export function approvalLockOwner(): string | null {
  return owner;
}

/**
 * 잠금을 잡고 해제 함수를 돌려준다. 이미 다른 결재가 돌고 있으면 throw.
 * 해제 함수는 여러 번 불러도 안전하다(finally·조기 실패 양쪽에서 부르기 쉽게).
 */
export function acquireApprovalLock(kind: string): () => void {
  if (owner) {
    throw new Error(
      owner === kind
        ? `이미 ${kind} 작업이 진행 중입니다.`
        : `${owner} 작업이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.`,
    );
  }
  owner = kind;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    owner = null;
  };
}
