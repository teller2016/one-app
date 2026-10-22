// 일정 등록 기능 공개 API — 다른 기능(루트 세션 오케스트레이터)은 내부 파일이 아니라 여기서 import 한다.
// ⚠️ main.ts 의 `registerScheduleIpc`(./ipc)는 진입점이 직접 가져가는 파일이라 여기 싣지 않는다.
export { readStartConfig, readWorklog } from './ipc';
