// 세 컨텍스트(main·preload·renderer) 공용 타입

/** 마지막 작성 내용 — 다음 실행의 기본값으로 재사용 */
export type OvertimeDefaults = {
  target: string; // 업무 대상 (예: A프로젝트)
  content: string; // 수행 내용
  reason: string; // 연장근무 사유
};

export type OvertimeSubmitInput = OvertimeDefaults & {
  date: string; // 연장근무일 "YYYY-MM-DD"
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  /** true 면 상신하지 않고 작성된 양식 창만 띄운다 (내용 확인용) */
  previewOnly?: boolean;
};

export type OvertimeSubmitResult = {
  ok: boolean;
  title?: string; // 상신된(또는 작성된) 문서 제목
  docUrl?: string; // 문서 보기(결재 버튼) 팝업 URL — '결재하러 가기' 링크
  preview?: boolean; // 미리보기였음 — 실제 상신은 하지 않았다
  error?: string;
};

export type OvertimeProgress = { step: string };

/** 어떤 결재를 올릴지 — 시작 화면에서 고른다 */
export type DraftKind = 'overtime' | 'expend';

/** 지출결의서 — 석식대 한 줄 (연장근로 석식비) */
export type ExpendDinner = {
  date: string; // 증빙일자 "YYYY-MM-DD"
  amount: number; // 공급대가
};

export type ExpendInput = {
  /** 주차요금 대상 월 "YYYY-MM" — 적요의 'N월'·증빙일자(그 달 말일)에 쓰인다 */
  month: string;
  /** 주차요금 (주차권 매수) — 넣지 않으면 null */
  parking: { manCount: number; halfCount: number } | null;
  /** 석식대 (여러 건) */
  dinners: ExpendDinner[];
};

/** 지출결의서 기본값 — 주차권 매수는 매달 비슷하므로 저장해 재사용한다 */
export type ExpendDefaults = {
  manCount: number; // 만원권 매수
  halfCount: number; // 5천원권 매수
};

export type ExpendResult = {
  ok: boolean;
  added?: number; // 실제로 작성된 항목 수
  itemCount?: number; // 작성하려던 항목 수
  error?: string;
};

/** 렌더러에 보내는 계정 정보 — 비밀번호 값은 보내지 않고 저장 여부만 */
export type AccountView = {
  id: string;
  hasPassword: boolean;
  dept: string; // 근무자 표의 '소속' 칸 문구 (예: 플랫폼서비스사업부문 FE)
  showBrowser: boolean; // 자동화 브라우저 창 표시 (문제 확인용)
};

export type SaveAccountInput = {
  id: string;
  /** 빈 값이면 기존 비밀번호 유지 */
  password?: string;
  dept: string;
  showBrowser?: boolean;
};
