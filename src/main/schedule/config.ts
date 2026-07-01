// 비즈박스 일정 매크로 설정값 (Day_Schedule_Macro/src/config.js 이식)
// 그룹웨어 UI가 바뀌면 selectors 만 수정하면 된다.
export const SCHEDULE_CONFIG = {
  bizboxURL: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',

  defaultWorkStartTime: 9.5, // 기본 업무 시작 시간 (0.5 = 30분)
  lunchStartTime: 12.5, // 점심 시작 (이 시간에 끝나는 일정 다음은 점심 후 시작)
  lunchEndTime: 13.5, // 점심 종료

  scheduleDelayMs: 500, // 일정 등록 사이 대기 시간(ms)
  viewport: { width: 1920, height: 1080 },
  closeBrowserOnFinish: false, // 완료 후 브라우저 자동 종료 여부

  // 비즈박스 그룹웨어 DOM 셀렉터 (UI가 바뀌면 이 부분만 수정)
  selectors: {
    // 로그인 페이지
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',

    // 일정 페이지 진입
    scheduleMenu: '#topMenu300000000',
    chapterText: '[기술부문] FE챕터', // 이동할 챕터/부서 (텍스트 정확히 일치)
    dayViewButton: '.fc-agendaDay-button',
    worklistSelect: '#worklist_sel',

    // iframe / 로딩
    iframe: 'iframe',
    loadingBar: '#loadingProgressBar',

    // 일정 등록 폼 (iframe 내부)
    contentIframe: '#_content',
    titleInput: '#inputTitleInsert',
    saveButton: '#pupupInsert',
  },
};
