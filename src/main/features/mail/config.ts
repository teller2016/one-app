// 메일(비즈박스 그룹웨어) 설정 — 그룹웨어가 바뀌면 여기만 수정한다.
//
// 인증코드 서비스를 추가하려면: `shared/types.ts` 의 `AuthCodeServiceId`·`AUTH_CODE_SERVICES` 에
// 항목을 넣고 아래 `authCode.services` 에 같은 키로 메일 패턴을 추가하면 UI 버튼까지 따라온다.
// (로그인·세션은 features/groupware 공용 모듈 담당. 여기엔 메일 고유 항목만 둔다.
//  정찰 결과: 공용 세션 쿠키 → GET /mail2/ 부트스트랩 → 개수·목록·본문을 순수 HTTP 로 처리.)
import type { AuthCodeServiceId } from '../../../shared/types';

/** 인증 메일 식별·코드 추출 규칙 (서비스 하나 분량) */
type AuthCodePatterns = {
  /** 발신자 — 제목과 **함께** 만족해야 인증 메일로 본다 */
  fromPattern: RegExp;
  subjectPattern: RegExp;
  /** 본문 문맥 기반 추출 (캡처 1 또는 2) */
  codeContext: RegExp;
  /** 문맥이 안 잡힐 때의 자릿수 폴백 */
  codeFallback: RegExp;
};

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

  // 메일 전용 계정용 폴백 — 부트스트랩 HTML 에서 계정 주소를 뽑는다.
  // (실측: `/mail2/` 응답에 등장하는 메일 주소는 그 계정 자신의 것 하나뿐 — 2026-08-13)
  emailInHtml: /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,

  // 팀 공용 계정의 인증코드 추출 — 아래는 전부 실계정 실측값이다
  // (피그마 2026-08-13 · 유데미 2026-09-11).
  authCode: {
    // 목록에서 훑는 최근 메일 수. 이 계정엔 피그마 알림이 하루 수십 통 쌓이므로
    // 너무 적게 잡으면 인증 메일이 밀려 안 보인다.
    scanCount: 30,
    // 서비스별 식별·추출 규칙. 표시 이름과 유효시간(분)은 렌더러와 공유해야 해서
    // `shared/types.ts` 의 `AUTH_CODE_SERVICES` 에 있다 — 여기엔 메일 패턴만 둔다.
    services: {
      figma: {
        // 인증 메일 식별 — 발신자·제목을 **모두** 만족해야 한다.
        // ⚠️ 같은 발신자(no-reply@email.figma.com)로 초대·공유 알림도 오므로
        //    발신자만으로는 가를 수 없다. 제목 조건이 핵심이다.
        fromPattern: /no-reply@email\.figma\.com/i,
        subjectPattern:
          /figma\s*계정에\s*로그인|sign\s*in\s*to\s*figma|verification\s*code/i,
        // 본문 문맥 기반 추출 — "…또는 이 코드를 입력하여 로그인을 완료하세요. 0432458"
        // ⚠️ 코드는 7자리이고 **0으로 시작할 수 있다** → 문자열로 다룰 것(숫자 변환 금지).
        codeContext: /코드를\s*입력[^0-9]{0,40}(\d{6,8})|code[^0-9]{0,40}(\d{6,8})/i,
        // 문맥이 안 잡힐 때의 폴백. ⚠️ 본문 하단 피그마 주소의 우편번호(94102)는
        // 5자리라 6자리 하한에 걸리지 않는다 — 하한을 내리면 오탐이 생긴다.
        codeFallback: /\b\d{6,8}\b/,
      },
      udemy: {
        // ⚠️ 인증 메일은 `e.udemymail.com`, 강의 광고는 `alerts.udemy.com` 이다 —
        //    발신자를 `udemy` 로 넓게 잡으면 광고 메일을 집는다.
        fromPattern: /no-reply@e\.udemymail\.com/i,
        // 실측 제목: "Udemy로그인: 요청하신 6자리 인증 코드입니다"(가입 메일은 'Udemy가입')
        subjectPattern: /인증\s*코드|verification\s*code/i,
        // 본문 실측: "아래 코드를 사용해 Udemy 계정에 로그인하세요. 875912"
        // ⚠️ 피그마는 "코드를 **입력**", 유데미는 "코드를 **사용**" 이라 문맥이 다르다.
        codeContext: /코드를\s*사용[^0-9]{0,60}(\d{6})|code[^0-9]{0,60}(\d{6})/i,
        // 유데미 코드는 6자리 고정. ⚠️ 본문 하단 주소(600 Harrison Street … 94107)는
        // 모두 6자리 미만이라 걸리지 않는다.
        codeFallback: /\b\d{6}\b/,
      },
    } satisfies Record<AuthCodeServiceId, AuthCodePatterns>,
  },
};
