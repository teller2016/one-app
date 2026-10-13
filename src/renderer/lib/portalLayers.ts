/**
 * body 로 portal 된 떠 있는 레이어 — 모달(확인창 포함)·피커 팝오버·토스트.
 * 패널·팝오버의 '바깥 클릭 닫힘' 판정에서 이 안의 클릭은 제외한다: 좌표·DOM 상으로는 바깥이지만
 * 그 패널이 띄운 모달 안을 누른 것이다(예: Jira 상세 패널 → [작업] 모달 안 클릭에 패널이 닫혔다).
 */
export const PORTAL_LAYERS = '.modal-overlay, .picker__pop, .toasts';
