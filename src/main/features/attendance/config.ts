// 출퇴근(근태) 설정 — 그룹웨어 UI가 바뀌면 selectors 만 수정하면 된다.
// (userMain.do 근태 위젯 분석 결과: fnAttendCheck(1)=출근, fnAttendCheck(4)=퇴근)
export const ATTENDANCE_CONFIG = {
  loginUrl: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',
  mainUrl: 'https://gw.forbiz.co.kr/gw/userMain.do',

  // 그룹웨어 근태 저장 함수의 플래그 값
  flags: { come: 1, leave: 4 },

  selectors: {
    // 로그인 페이지 (일정 매크로와 동일한 그룹웨어)
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',

    // 메인 화면 근태 위젯
    tabIn: '#tab1', // 예: "출근 2026.07.02 09:37:23" / "출근시간 없음"
    tabOut: '#tab2', // 예: "퇴근 2026.07.02 18:31:02" / "퇴근시간 없음"
  },
};
