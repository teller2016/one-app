/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// mobile_window 렌더러(모바일 터미널 페이지)의 전역 상수 — plugin-vite 가 define 으로 주입.
// forge-vite-env 는 MAIN_WINDOW 만 선언하므로 여기서 보강한다. prod 빌드에선 undefined.
declare const MOBILE_WINDOW_VITE_DEV_SERVER_URL: string;
declare const MOBILE_WINDOW_VITE_NAME: string;
