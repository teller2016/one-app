// 그룹웨어(비즈박스) 로그인 공통 설정 — 로그인 화면이 바뀌면 여기만 수정한다.
// 기능별 설정(mail/attendance/weekly/overtime config)에는 그 기능 고유의 URL·셀렉터만 둔다.
export const GROUPWARE_CONFIG = {
  loginUrl: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',
  // 로그인 직후 세션 안정화용 포털 메인 (로그인 페이지로 튕기면 실패 판정)
  mainUrl: 'https://gw.forbiz.co.kr/gw/userMain.do',

  selectors: {
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',
  },

  // 확보한 세션(쿠키) 재사용 유효시간. 지나면 재로그인.
  // 서버에서 먼저 만료되면 페이지가 로그인 화면으로 튕기므로 그때 재로그인으로 복구한다.
  sessionTtlMs: 20 * 60 * 1000,
};
