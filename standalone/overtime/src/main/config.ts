// 그룹웨어 화면 설정 — 화면이 바뀌면 여기 selectors 만 수정하면 된다.
// (2026-07 실제 화면 분석 결과. 야근 결재 부분은 One App 본체와 같은 내용을 유지한다)

/** 로그인 (야근·지출결의서 공용) */
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

  /** 소속 기본값 — 설정 화면에서 사람마다 수정한다 */
  defaultDept: '플랫폼서비스사업부문 FE',
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
