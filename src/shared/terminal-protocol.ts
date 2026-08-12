// 모바일(MO) 터미널 WS 프로토콜 — main 의 server.ts 와 브라우저의 mobile.ts 가 공용.
// 전부 JSON 텍스트 프레임: node-pty onData 가 UTF-8 경계를 처리한 string 을 주므로
// 바이너리 프레임이 필요 없고, xterm.write(string) 과 바로 연결된다.
import type {
  TerminalAgentId,
  TerminalAgentInfo,
  TerminalPreset,
  TerminalSessionInfo,
} from './types';

/** 새 세션을 열 수 있는 위치 후보 (프로젝트 레지스트리 파생 — MO 의 위치 선택용) */
export type TermCwdOption = { name: string; path: string };

/**
 * MO 작업 영역 트리 — 데스크톱 LNB(워크스페이스 ▸ 워크트리)의 폰 판.
 * ±변경량은 싣지 않는다 — 폰 시트에 표시할 자리가 없고 워크스페이스마다
 * `git diff --shortstat` 을 돌리는 값이라 접속·조회 때마다 물릴 이유가 없다.
 */
export type TermWorktreeNode = {
  path: string;
  name: string; // 표시명 (주 워크트리는 'local')
  branch?: string;
  isMain: boolean;
};

export type TermWorkspaceNode = {
  id: string;
  name: string;
  worktrees: TermWorktreeNode[];
};

/** 클라이언트(모바일) → 서버 */
export type TermClientMsg =
  | { type: 'list' } // 세션 목록 요청
  | { type: 'cwds' } // 새 세션 위치 후보 요청
  | { type: 'agents' } // 에이전트 후보 요청 (설치 감지 결과 포함)
  | { type: 'workspaces' } // 작업 영역 트리 요청 (git 조회라 시트를 열 때만)
  | { type: 'presets' } // 프리셋 목록 요청
  | { type: 'attach'; id: string; cols: number; rows: number }
  | { type: 'detach' }
  | { type: 'input'; data: string } // attach 된 세션에 키 입력
  | { type: 'resize'; cols: number; rows: number }
  // cwd 없으면 홈 디렉터리. command/title 은 프리셋 실행용 — 데스크톱 프리셋 칩과
  // 같은 동작(그 위치의 새 세션에서 명령 자동 실행)을 폰에서도 하기 위한 필드다.
  // ⚠️ cols/rows 를 함께 보내 **처음부터 클라이언트 크기로** 만든다 — 안 보내면 80x24 로
  //    생성됐다가 곧바로 오는 attach 가 리사이즈를 일으키고, 그 SIGWINCH 재출력이
  //    자동 실행 중인 명령줄과 겹쳐 글자가 섞여 보인다(폰은 rows 가 100 넘어 특히 심하다).
  | {
      type: 'create';
      cwd?: string;
      agentId?: TerminalAgentId;
      command?: string;
      title?: string;
      cols?: number;
      rows?: number;
    }
  | { type: 'kill'; id: string };

/** 서버 → 클라이언트 */
export type TermServerMsg =
  | { type: 'sessions'; sessions: TerminalSessionInfo[] }
  | { type: 'cwds'; items: TermCwdOption[] }
  | { type: 'agents'; items: TerminalAgentInfo[] }
  | { type: 'workspaces'; items: TermWorkspaceNode[] }
  | { type: 'presets'; items: TerminalPreset[] }
  | { type: 'created'; id: string } // create 응답 — 클라이언트가 이어서 attach
  | {
      type: 'attached'; // attach 응답 — replay 는 스크롤백, seq 이하 data 는 중복이라 버린다
      id: string;
      replay: string;
      alt?: boolean; // 대체 화면(TUI)이라 replay 생략 — 클라이언트가 ?1049h 를 합성한다
      seq: number;
      cols: number;
      rows: number;
    }
  | { type: 'data'; id: string; data: string; seq: number }
  | { type: 'exit'; id: string; exitCode: number }
  | { type: 'resized'; id: string; cols: number; rows: number }
  | { type: 'error'; message: string };
