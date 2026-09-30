// 본문 서체 — IBM Plex Sans KR 을 앱에 번들한다 (@fontsource, OFL-1.1).
// 오프라인·VPN 끊김에도 같은 글꼴로 그려야 해서 웹폰트 CDN 대신 번들을 쓴다.
// 한글은 unicode-range 로 잘게 나뉘어 있어 실제로 쓰는 글자 묶음만 로드된다.
// 고정폭(JetBrains Mono NL)은 _base.scss 의 @font-face 가 따로 번들한다.
// 진입점 3곳(renderer · mobile-app · standalone/lite)이 이 파일을 import 한다.
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/500.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import '@fontsource/ibm-plex-sans-kr/700.css';
