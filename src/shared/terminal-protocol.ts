// 모바일(MO) 터미널 WS 프로토콜 — main 의 server.ts 와 브라우저의 mobile.ts 가 공용.
// 전부 JSON 텍스트 프레임: node-pty onData 가 UTF-8 경계를 처리한 string 을 주므로
// 바이너리 프레임이 필요 없고, xterm.write(string) 과 바로 연결된다.
import type { TerminalSessionInfo } from './types';

/** 클라이언트(모바일) → 서버 */
export type TermClientMsg =
  | { type: 'list' } // 세션 목록 요청
  | { type: 'attach'; id: string; cols: number; rows: number }
  | { type: 'detach' }
  | { type: 'input'; data: string } // attach 된 세션에 키 입력
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'create'; cwd?: string }
  | { type: 'kill'; id: string };

/** 서버 → 클라이언트 */
export type TermServerMsg =
  | { type: 'sessions'; sessions: TerminalSessionInfo[] }
  | { type: 'created'; id: string } // create 응답 — 클라이언트가 이어서 attach
  | {
      type: 'attached'; // attach 응답 — replay 는 스크롤백, seq 이하 data 는 중복이라 버린다
      id: string;
      replay: string;
      seq: number;
      cols: number;
      rows: number;
    }
  | { type: 'data'; id: string; data: string; seq: number }
  | { type: 'exit'; id: string; exitCode: number }
  | { type: 'resized'; id: string; cols: number; rows: number }
  | { type: 'error'; message: string };
