// 그룹웨어 결재 자동화 설정 — 화면이 바뀌면 여기 selectors 만 수정하면 된다.
// (2026-07~08 실제 화면 분석 결과. standalone/overtime 판을 One App 본체로 이식)

/** 로그인 (야근·지출결의서·휴가신청서 공용) */
export const GW_CONFIG = {
  loginUrl: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',
  selectors: {
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',
  },
  /** 로그인 화면으로 되돌려졌는지 판정하는 URL 조각 */
  loginUrlMark: 'egovLoginUsr',
};

/** 근무자 표·기안부서의 '소속' 칸 문구 (기안부서 select 값 "FE" 대신 전체 소속 표기) */
export const WORKER_DEPT = '플랫폼서비스사업부문 FE';

/** 야근 결재 — 전자결재 '연장근무내역서' (EAAppDocPop.do?form_id=41) */
export const OVERTIME_CONFIG = {
  // 양식 팝업 — 로그인 세션만 있으면 직접 URL 로 열린다
  formUrl: 'https://gw.forbiz.co.kr/eap/ea/eadocpop/EAAppDocPop.do?form_id=41',
  // 상신된 문서 보기 팝업 (결재 버튼이 있는 화면 — 완료 후 '결재하러 가기' 링크)
  docViewUrl: (docId: string) =>
    `https://gw.forbiz.co.kr/eap/ea/docpop/EAAppDocViewPop.do?doc_id=${docId}&form_id=41`,

  selectors: {
    title: '#txtTitle', // 제목 입력
    editorFrame: '#editorView', // 더존 웹에디터 바깥 iframe (/gw/editorView.do)
    editorInnerFrame: '#dzeditor_0', // 실제 본문(contentEditable) iframe
    draftBtn: '#btnDraft', // [상신] — 클릭 시 fnAppDocSave('20', 0)
    // 상신 가드가 검사하는 비동기 초기화 값 — 채워지기 전에 누르면 경고 후 무시된다
    numberingSelect: '#ddlNumberingID', // 품의번호(기본채번)
    appLineHidden: '#hidAppDocLine', // 결재라인 JSON (비면 "[]")
    // 상신 성공 시 저장 응답의 새 문서 id 가 여기 기록된다 (성공 판정 기준)
    docIdHidden: '#hidDocID',
    // 검증 실패 경고 다이얼로그 (커스텀 — 네이티브 dialog 아님)
    puddMessage: '.PUDD-UI-Message',
  },
};

/**
 * 지출결의서(개인) — 전자결재와 다른 지출 전용 화면(/exp/).
 * 결재양식 목록에서 '지출결의서(개인)' 을 누르면 이 URL 이 열린다(form_id=22).
 */
export const EXPEND_CONFIG = {
  /**
   * ⚠️ 지출결의서는 **결재양식 목록에서 클릭해 팝업으로 띄워야** 한다.
   * URL(ExpendPop.do)을 직접 열면 window.opener 가 없어서,
   * [결재상신] 때 창만 닫히고 결재선·참조 지정 팝업이 열리지 않는다(2026-07 실측).
   */
  formListUrl: 'https://gw.forbiz.co.kr/eap/ea/eadocW/EaForm.do?menu_no=2001010000',
  /** 양식 목록에서 클릭할 항목 이름 */
  formLinkText: '지출결의서(개인)',
  /** 양식이 실제로 열린 뒤의 URL 조각 (리다이렉트 후) */
  formUrlMark: 'ExUserMasterPop',

  selectors: {
    // 문서 상단
    acctDate: '#txtExpendDate', // 회계일자
    reqDate: '#txtExpendReqDate', // 지급요청일
    empCode: '#txtExpendEmpCode', // 사원코드 (자동)
    empName: '#txtExpendEmpName', // 사용자 이름 (자동) — 카드 검색어로 재사용
    addItemBtn: '#btnExpendListAdd', // [항목추가] → 레이어 팝업

    // 항목 레이어 팝업 (#layerExpendList)
    itemLayer: '#layerExpendList',
    itemSave: '#btnListSave',
    itemClose: '#btnListClose',
    summaryCode: '#txtListSummaryCode', // 표준적요 코드 (읽기전용 — 찾기로만 채워짐)
    summaryName: '#txtListSummaryName',
    authCode: '#txtListAuthCode', // 증빙유형 코드
    authName: '#txtListAuthName',
    note: '#txtListNote', // 적요
    authDate: '#txtListAuthDate', // 증빙일자
    cardCode: '#txtListCardCode', // 카드 코드
    cardName: '#txtListCardName',
    amount: '#txtListAmt', // 공급대가
  },

  /**
   * '찾기' 도움창 — window.open('') 로 창을 띄우고 POST 폼(USER_cmmPop)으로 채운다.
   * 부모에서 fnOpenCommonCodePop('Y', codeType) 을 호출하면
   * 해당 이름 입력칸(txtList{codeType}Name)의 값이 검색어로 넘어간다.
   */
  popup: {
    urlMark: 'UserCmmCodePop',
    searchInput: '#cmmTxtSearchStr',
    searchBtn: '#btnSearch',
    acceptBtn: '#cmmBtnAccept',
    resultTable: '#tbl_codePopTbl',
  },
  popupFormUrl: '/exp/ex/expend/code/UserCmmCodePop.do',

  /** 찾기 codeType (fnOpenCommonCodePop 인자) */
  codeType: {
    summary: 'Summary', // 표준적요
    auth: 'Auth', // 증빙유형
    card: 'Card', // 카드
  },

  /** 고정 선택값 */
  authTypeName: '개인카드', // 증빙유형
  summaryParking: '주차요금(기타)', // 표준적요 — 주차
  summaryDinner: '석식대', // 표준적요 — 석식
};

/**
 * 휴가신청서 — 전자결재가 아니라 **근태 서브시스템**(/attend/)의 신청 화면이다.
 * 결재양식 목록의 '휴가신청서' 를 누르면 이 URL 이 열린다(2026-08 실측).
 *
 * 화면 흐름
 *   Step01 기본정보(신청자·제목·일정등록) → Step02 신청정보(근태구분·신청일자·신청일수·연차차감·비고)
 *   → [내역추가](addAnnualLeave) → Step03 신청내역 그리드에 한 줄 추가
 *   → [결재상신](save) → 근태신청 저장(ajax) + 전자결재 문서 창 window.open + self.close()
 *
 * ⚠️ save() 가 **자기 창을 닫으면서 새 창을 열기** 때문에 자동화 창에 outlivesOpener 가 필수다
 *    (browser.ts 의 windowOpenHandler 가 처리 — 없으면 전자결재 창이 떴다가 즉시 사라진다).
 */
export const VACATION_CONFIG = {
  /** 양식 목록에서 클릭할 항목 이름 */
  formLinkText: '휴가신청서',
  /** 양식이 열린 뒤의 URL 조각 */
  formUrlMark: 'eaPop.do',
  /** 목록을 거치지 않고 직접 열 수 있는 URL (processId 는 휴가신청서 고정값) */
  formUrl:
    'https://gw.forbiz.co.kr/attend/Views/Common/pop/eaPop.do?processId=ATTProc18&form_id=18&form_tp=ATTProc18&doc_width=900',

  selectors: {
    applicantText: '#names', // 신청자 표시 — "[(주)포비즈코리아/FE] 정수범"
    title: '#eaTitle', // 제목
    scheduleCombo: '#sch_sel', // 일정등록 (kendoComboBox — mcalSeq/calTitle)
    attDivCombo: '#gt_sel', // 근태구분 (kendoComboBox — attDivCode/attDivName)
    fromDate: '#from_date', // 시작일자 (kendoDatePicker)
    toDate: '#to_date', // 종료일자 (kendoDatePicker)
    dayCount: '#dayCnt', // 신청일수 (근무일 조회로 자동계산)
    useDayCount: '#useDayCnt', // 연차차감 (자동계산)
    remark: '#reqRemark', // 비고 (선택)
    grid: '#grid', // Step03 신청내역 (Kendo Grid)
    sendBtn: '#send_btn', // [결재상신] — save()
    // 연차 현황 (읽기 전용 — 앱에 보여주면 유용하다)
    totalAnnv: '#person_basicAnnvDayCnt', // 총 연차일수
    usedAnnv: '#person_useDayCnt', // 사용일수
    restAnnv: '#person_restAnnvDayCnt', // 잔여연차
    progressAnnv: '#person_useDayCntPro', // 결재 진행 연차
  },

  /** [내역추가] 버튼 — id 가 없어 텍스트로 찾는다 */
  addBtnText: '내역추가',

  /** 기본 일정등록 캘린더 — 부재 공유 캘린더(전사) */
  defaultCalendarText: '부재공유',

  /** 근태구분 — 화면 combo 의 attDivName 과 같은 문구여야 한다 */
  attDivNames: [
    '연차',
    '오전반차',
    '오후반차',
    '시차_1시간',
    '시차_2시간',
    '공가',
    '대체휴가',
  ] as const,

  /**
   * 근태구분(콤보 문구) → 전자결재 본문 '종류' 체크 항목 문구.
   * 본문 체크박스는 id 가 없어 **라벨 문구로 찾는다** — 표기가 달라서 이 표가 필요하다
   * (콤보는 '오전반차', 본문은 '반차(오전)').
   * 표에 없는 근태구분은 '기타' 에 체크하고 괄호에 원래 문구를 넣는다.
   */
  attDivToDocKind: {
    연차: '연차',
    오전반차: '반차(오전)',
    오후반차: '반차(오후)',
    시차_1시간: '시차(1시간)',
    시차_2시간: '시차(2시간)',
    대체휴가: '대체휴가',
  } as Record<string, string>,

  /** 본문 '사유' 체크 항목 — 화면 문구 그대로 */
  docReasons: [
    '휴식',
    '여행',
    '가정대소사 또는 가족모임',
    '가족건강문제',
    '개인건강문제(병원, 약국)',
    '기타',
  ] as const,

  /** 본문(에디터) 표의 행 머리글 — 공백 제거 후 비교한다 */
  docRowHeads: {
    kind: '종류',
    reason: '사유',
    period: '기간',
    emergency: '비상연락망',
    handover: '인수인계',
  },

  /**
   * [결재상신] 이후 열리는 전자결재 문서 창.
   *
   * save() 는 **빈 창을 먼저 열고**(window.open('', '_blank')) 아래 순서로 채운다 —
   *   InsertEaAttReq(근태신청 저장) → docApprove() → eadocmake.do(전자결재 문서 생성)
   *   → updateEaAttDoc() → 빈 창의 location 을 `/eap/ea/interface/eadocpop.do?…docId=…` 로 이동
   *   → 작성 창은 self.close()
   * 즉 팝업이 잡히는 시점엔 아직 about:blank 다 — URL 로 판정하지 말고 **요소가 나타날 때까지** 기다린다.
   */
  eaDoc: {
    urlMark: 'eadocpop.do',
    title: '#txtTitle',
    draftBtn: '#btnDraft',
    docIdHidden: '#hidDocID',
    numberingSelect: '#ddlNumberingID',
    appLineHidden: '#hidAppDocLine',
    editorFrame: '#editorView',
    editorInnerFrame: '#dzeditor_0',
    puddMessage: '.PUDD-UI-Message',
  },
};
