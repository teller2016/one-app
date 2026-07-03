// 주간보고(개인별 주간) 설정 — 그룹웨어 UI가 바뀌면 selectors 만 수정하면 된다.
// (개인별 주간 화면 분석 결과:
//   - iframe(#_content)이 /schedule/Views/Common/mCalendar/personalWeekShare 를 로드
//   - 전역 startDate/endDate(YYYYMMDD)가 현재 표시 중인 주, beforeWeek()/nextWeek()로 이동
//   - calendarExcelSave()가 엑셀 생성용 datas(JSON)를 form 으로 제출 → 후킹해 가로챈다)
export const WEEKLY_CONFIG = {
  loginUrl: 'https://gw.forbiz.co.kr/gw/uat/uia/egovLoginUsr.do',
  viewport: { width: 1600, height: 900 },

  selectors: {
    // 로그인 페이지 (출퇴근·일정 매크로와 동일한 그룹웨어)
    userId: '#userId',
    userPw: '#userPw',
    loginSubmit: '.login_submit',

    // 일정 페이지 진입 (일정 매크로와 동일)
    scheduleMenu: '#topMenu300000000',
    chapterText: '[기술부문] FE챕터',

    // 일정 화면 iframe + 개인별 주간 전환 버튼(fullcalendar 커스텀 버튼)
    contentIframe: '#_content',
    personalWeekButton: 'button.fc-personalWeek-button',
    selectWeek: '#selectWeek',
    loadingBar: '#loadingProgressBar',
  },
};
