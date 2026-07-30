// 메일(비즈박스 그룹웨어) 설정 — 그룹웨어가 바뀌면 여기만 수정한다.
// (로그인·세션은 features/groupware 공용 모듈 담당. 여기엔 메일 고유 항목만 둔다.
//  정찰 결과: 공용 세션 쿠키 → GET /mail2/ 부트스트랩 → 개수·목록·본문을 순수 HTTP 로 처리.)
export const MAIL_CONFIG = {
  origin: 'https://gw.forbiz.co.kr',
  // 메일 웹 화면 열기 링크 — bizboxMail.do 는 top-level 로 열면 포털 홈으로 튕겨서
  // 메일 SPA 진입점(?ssoType=GW)을 직접 연다. (정찰 결과: 이 URL 만 메일함이 바로 뜬다)
  webUrl: 'https://gw.forbiz.co.kr/mail2/?ssoType=GW',

  endpoints: {
    // /gw/ — 포털 위젯 API. 메일 세션 부트스트랩 없이 로그인 직후 바로 동작 (이메일 파악용)
    portlet: 'https://gw.forbiz.co.kr/gw/portletEmailList.do',
    // /mail2/ — 메일 SPA. 아래 호출들은 부트스트랩(GET bootstrap) 이후에만 동작
    bootstrap: 'https://gw.forbiz.co.kr/mail2/?ssoType=GW',
    boxCount: 'https://gw.forbiz.co.kr/mail2/getMailBoxCount.do',
    list: 'https://gw.forbiz.co.kr/mail2/getMailList.do?',
    readMeta: 'https://gw.forbiz.co.kr/mail2/readMail.do',
    readCont: 'https://gw.forbiz.co.kr/mail2/readMailCont.do',
  },

  // 폴더명 (getMailBoxCount 로 mboxSeq 동적 확인, 실패 시 폴백 — 2026-07-21 정찰값)
  inboxName: 'INBOX',
  inboxSeqFallback: 1977,
  spamName: 'SPAM',
  spamSeqFallback: 1981,
  // 안읽음 뱃지 집계에서 제외할 폴더 — 스팸은 제외하지 않는다(사용자 요청으로 포함).
  // 서버의 allunseen 은 스팸을 빼고 집계하므로(allexist = INBOX+SENT 로 확인, 2026-07-30)
  // 뱃지는 여기 없는 폴더들의 unseen 합으로 직접 계산한다.
  unreadExcludedBoxes: ['SENT', 'DRAFTS', 'TRASH'],
};
