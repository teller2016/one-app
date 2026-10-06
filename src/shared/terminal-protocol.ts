// 모바일(MO) 터미널 WS 프로토콜 — main 의 server.ts 와 브라우저의 mobile.ts 가 공용.
// 전부 JSON 텍스트 프레임: node-pty onData 가 UTF-8 경계를 처리한 string 을 주므로
// 바이너리 프레임이 필요 없고, xterm.write(string) 과 바로 연결된다.
import type { TerminalAgentId, TerminalPreset, TerminalSessionInfo } from './types';

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
  /** 타일 색 번호(1~10) — 데스크톱에서 고른 색. 없으면 이름 해시(tileColor) */
  color?: number;
  worktrees: TermWorktreeNode[];
};

/** 클라이언트(모바일) → 서버 */
export type TermClientMsg =
  | { type: 'cwds' } // 새 세션 위치 후보 요청
  | { type: 'workspaces' } // 작업 영역 트리 요청 (git 조회라 시트를 열 때만)
  | { type: 'presets' } // 프리셋 목록 요청
  | { type: 'attach'; id: string; cols: number; rows: number }
  | { type: 'input'; data: string } // attach 된 세션에 키 입력
  | { type: 'resize'; cols: number; rows: number }
  // 폰이 크기를 놓는다(화면 꺼짐·앱 전환·채팅 보기·다른 탭) — 서버가 데스크톱 크기로 되돌린다(pty.releaseRemoteSize)
  | { type: 'release' }
  // 스크롤 위임 — 데스크톱 휠과 **같은 경로**(main 의 scrollSession → tmux 3단 분기)를 탄다.
  // ⚠️ 클라이언트가 휠을 xterm 에 직접 넘기면, 대체 화면에서 xterm 이 그것을 방향키(↑↓)로
  //    바꿔 앱에 보낸다 — claude 는 리렌더마다 마우스 모드를 껐다 켜므로 그 틈에 들어간
  //    휠이 프롬프트 히스토리를 롤링했다(2026-09-09 사용자 신고). 마우스 사용 여부의
  //    진실은 tmux pane 플래그뿐이라 판정을 서버로 넘긴다.
  | { type: 'scroll'; lines: number } // 양수 = 위(과거)로
  | { type: 'scroll-bottom' } // [맨 아래로] — copy-mode 종료
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
  | { type: 'kill'; id: string }
  // ── 채팅 보기 — claude 대화 기록(jsonl)을 말풍선으로 (main `chat.ts`) ──
  | { type: 'chat-open'; id: string } // 이 세션의 대화를 구독 — 응답은 'chat'(reset) 후 증분
  | { type: 'chat-close' }
  // 입력창 전송 — 서버가 붙여넣기 감싸기·Enter 지연까지 처리한다(여러 줄이 줄마다 제출되지 않게)
  | { type: 'chat-send'; id: string; text: string }
  | { type: 'chat-commands'; id: string } // `/` 자동완성 목록 요청 — 입력창에서 / 를 칠 때
  | { type: 'chat-files'; id: string } // `@` 파일 자동완성 목록 요청 — 입력창에서 @ 를 칠 때
  // ── 폰 알림(웹 푸시 — main `push.ts`) ──
  // 폰 화면이 보이는가(visibilitychange) — MO 를 보고 있는 폰이 있으면 서버가 푸시를 생략한다(탭바 배지가 대신한다)
  | { type: 'visibility'; visible: boolean }
  | { type: 'push-key' } // 알림을 허용한 폰이 구독에 쓸 공개키를 요청한다 — 응답 'push-key'
  | { type: 'push-subscribe'; sub: TermPushSubscription }; // 구독 등록 — 접속할 때마다 보낸다(서버가 같은 것은 거른다)

/** 폰의 웹 푸시 구독 — `PushSubscription.toJSON()` 에서 필요한 것만 */
export type TermPushSubscription = { endpoint: string; keys: { p256dh: string; auth: string } };

/** 서버 → 클라이언트 */
export type TermServerMsg =
  | { type: 'sessions'; sessions: TerminalSessionInfo[] }
  | { type: 'cwds'; items: TermCwdOption[] }
  | { type: 'workspaces'; items: TermWorkspaceNode[] }
  | { type: 'presets'; items: TerminalPreset[] }
  | { type: 'created'; id: string } // create 응답 — 클라이언트가 이어서 attach
  | {
      type: 'attached'; // attach 응답 — replay 는 스크롤백, seq 이하 data 는 중복이라 버린다
      id: string;
      replay: string;
      alt?: boolean; // 대체 화면(TUI)이라 replay 생략 — 클라이언트가 ?1049h 를 합성한다
      tmux?: boolean; // tmux 백엔드 = 스크롤백의 주인이 tmux — 스크롤을 서버로 위임할지의 판정
      seq: number;
      cols: number;
      rows: number;
    }
  | { type: 'data'; id: string; data: string; seq: number }
  | { type: 'exit'; id: string; exitCode: number }
  | { type: 'resized'; id: string; cols: number; rows: number }
  // scroll/scroll-bottom 응답 — 위로 올라가 있는지가 [맨 아래로] 버튼의 판정이다
  // (위임 스크롤은 tmux copy-mode 를 움직이므로 xterm 버퍼로는 알 수 없다)
  | { type: 'scrolled'; id: string; scrolledUp: boolean }
  // 채팅 — reset 이면 통째 교체(구독 시작·대화가 바뀜), 아니면 뒤에 덧붙인다.
  // results 는 앞서 보낸 도구 호출의 결과 — 클라이언트가 toolId 로 맞춰 붙인다
  // fresh = claude 는 떠 있지만 대화 파일이 아직 없다(첫 메시지 전) — 빈 대화 + 입력창
  // queued = claude 가 아직 읽지 않은(대기열의) 내 메시지 **전체 목록** — 있을 때만 바꾸고 없으면 그대로 둔다
  | {
      type: 'chat';
      id: string;
      reset: boolean;
      items: ChatItem[];
      results: ChatToolResult[];
      fresh?: boolean;
      queued?: ChatQueued[];
    }
  // 대화 기록을 못 찾았다(claude 가 아닌 세션·아직 시작 전) — 클라이언트는 안내 + 터미널 보기
  | { type: 'chat-unavailable'; id: string; reason: string }
  // claude 가 터미널에서 답을 기다린다(sessions/<pid>.json status 'waiting') — 화면에서 읽은 선택 화면.
  // prompt 가 null 이면 대기가 끝났다. options 가 비면 읽지 못한 것 — '터미널에서 답 필요' 안내만
  | { type: 'chat-prompt'; id: string; prompt: ChatPrompt | null }
  // 작업 중 상태 줄(화면에서 읽음 — `Garnishing… · 7s · ↓ 527 tokens`). null = 일하지 않거나 못 읽음
  | { type: 'chat-status'; id: string; text: string | null }
  | { type: 'chat-commands'; id: string; items: ChatCommand[] }
  | { type: 'chat-files'; id: string; items: string[] }
  | { type: 'push-key'; key: string } // VAPID 공개키(URL-safe base64) — 폰이 pushManager.subscribe 에 쓴다
  | { type: 'error'; message: string };

/** 채팅 보기로 오는 메시지 — 폰(WS)·데스크톱(IPC `terminal:chat`) 공용 */
export type ChatServerMsg = Extract<
  TermServerMsg,
  { type: 'chat' } | { type: 'chat-unavailable' } | { type: 'chat-prompt' } | { type: 'chat-status' }
>;

/** `/` 자동완성 한 줄 — main chatCommands.ts 가 모은다 */
export type ChatCommand = { name: string; description?: string; source: 'project' | 'user' | 'builtin' };

// ── 채팅 항목 ──

/**
 * claude 가 일하는 중에 보내 **대기열에 들어간** 내 메시지 — 아직 읽히지 않았다(회색 말풍선 '대기 중').
 * 대화 기록의 `queue-operation`(enqueue·dequeue·remove)으로 안다. 읽히면 대기열에서 빠지고 보통 말풍선이 된다
 */
/** 대기 중 메시지 — images = 붙인 이미지 수(글의 `[Image #N]` 자리 표시는 서버가 걷는다) */
export type ChatQueued = { key: string; text: string; images?: number; ts?: string };

export type ChatQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
};

export type ChatToolResult = { toolId: string; text: string; isError?: boolean };

/** 터미널의 번호 선택 화면(screenPrompt.ts) — 버튼 = 그 번호 키 */
export type ChatPrompt = {
  header?: string;
  question: string;
  options: { n: number; label: string; description?: string; current?: boolean }[];
  /** 'Type something.' 번호 — 입력창 글은 이 번호로 옮긴 뒤 넣는다 */
  freeText?: number;
  /** 질문이 아닌 선택 화면 — 권한 확인(`Tab to amend`) · 플랜 승인(`ctrl+g`). 질문·검토 화면은 없음 */
  kind?: 'permission' | 'plan';
  /** 권한 확인이 무엇을 허용하는지 — 질문 위 미리보기(도구·명령·파일 이름·내용 앞부분) 몇 줄 */
  preview?: string;
};

export type ChatItem =
  /** ts = 보낸 시각(ISO) — 턴 머리에 HH:MM 으로 */
  | { kind: 'user'; key: string; text: string; images?: number; ts?: string }
  | { kind: 'assistant'; key: string; text: string }
  /** 대화 흐름 표식(중단 등) — 말풍선이 아니라 가운데 회색 줄 */
  | { kind: 'notice'; key: string; text: string }
  /** 슬래시 명령(`/commit` 등) — 사용자가 친 명령 한 줄 */
  | { kind: 'command'; key: string; text: string }
  /** 도구 호출 — summary 는 한 줄 요약, detail 은 펼쳤을 때(입력 전문·diff) */
  | {
      kind: 'tool';
      key: string;
      toolId: string;
      name: string;
      summary: string;
      detail?: string;
      result?: ChatToolResult;
    }
  /** AskUserQuestion 기록 — 답한 뒤에야 기록된다(대기 중 선택지는 chat-prompt 가 화면에서 읽어 보낸다) */
  | { kind: 'ask'; key: string; toolId: string; questions: ChatQuestion[]; result?: ChatToolResult };
