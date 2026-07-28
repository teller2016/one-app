// 야근 결재(연장근무내역서) 설정 — 그룹웨어 화면이 바뀌면 selectors 만 수정하면 된다.
// (전자결재 양식 팝업 EAAppDocPop.do?form_id=41 분석 결과 — 2026-07 확인)
export const OVERTIME_CONFIG = {
  loginUrl: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',

  // 연장근무내역서 양식 팝업 — 로그인 세션만 있으면 직접 URL 로 열린다
  formUrl: 'https://gw.forbiz.co.kr/eap/ea/eadocpop/EAAppDocPop.do?form_id=41',
  // 상신된 문서 보기 팝업 (결재 버튼이 있는 화면 — 완료 후 '결재하러 가기' 링크)
  docViewUrl: (docId: string) =>
    `https://gw.forbiz.co.kr/eap/ea/docpop/EAAppDocViewPop.do?doc_id=${docId}&form_id=41`,

  // 근무자 표의 '소속' 칸 문구 (기안부서 select 값 "FE" 대신 전체 소속 표기)
  workerDept: '플랫폼서비스사업부문 FE',

  selectors: {
    // 로그인 페이지 (일정·출퇴근 매크로와 동일한 그룹웨어)
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',

    // 양식 팝업
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
