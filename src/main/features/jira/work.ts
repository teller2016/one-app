// Jira 티켓 하나를 femc 작업 세션으로 넘기기 위한 **맥락 준비**.
//
// 티켓 본문·댓글을 마크다운으로, 첨부(스크린샷 등)를 실제 파일로 내려받아
// `userData/jira-work/<KEY>/` 에 두고, 그 폴더를 읽을 수 있는 femc 실행 명령을 만든다.
//
// ⚠️ **femc 는 Jira 를 직접 못 읽는다** — 사내 Jira 는 Basic Auth 가 필요한데 femc 쪽에는
// 자격증명도 MCP 도 없다(2026-08-12 확인). 그래서 이미 인증된 앱이 받아서 파일로 건네준다.
// 첨부 이미지가 femc 에 전달되는 유일한 경로이기도 하다.
//
// ⚠️ **셸 명령 조립은 여기(main)에서만** 한다 — 렌더러가 티켓 제목·본문이 섞인 프롬프트를
// 명령 문자열에 끼워 넣으면 따옴표·개행 이스케이프가 곧바로 사고가 된다. 렌더러는 결과의
// `command` 를 가공하지 않고 그대로 `terminal:create` 에 넘긴다.
import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  JiraWorkAccount,
  JiraWorkAccountInfo,
  JiraWorkPrepareInput,
  JiraWorkPrepareResult,
  JiraWorkSkill,
} from '../../../shared/types';
import { fetchWithTimeout as fetch } from '../../lib/http';
import { shQuote } from '../../lib/util';
import { getJiraApiConfig } from '../settings/store';
import { listSessions } from '../terminal/pty';

/** 티켓 맥락 폴더 보관 개수 — 넘치면 오래된 것부터 지운다(세션이 살아있는 티켓은 제외) */
const KEEP_TICKETS = 20;
/** 티켓당 내려받을 첨부 수 상한 — 스크린샷 20장짜리 티켓이 femc 컨텍스트를 통째로 먹는 것 방지 */
const MAX_ATTACHMENTS = 12;
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const ISSUE_TIMEOUT_MS = 20_000;
const ATTACHMENT_TIMEOUT_MS = 60_000;

const WORK_FIELDS =
  'summary,status,issuetype,priority,reporter,assignee,created,updated,description,comment,attachment';

type RawAttachment = {
  id?: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  content?: string; // 다운로드 URL (인증 필요)
};

type RawWorkIssue = {
  key?: string;
  fields: {
    summary?: string;
    status?: { name?: string };
    issuetype?: { name?: string };
    priority?: { name?: string };
    reporter?: { displayName?: string };
    assignee?: { displayName?: string };
    created?: string;
    updated?: string;
    attachment?: RawAttachment[];
    comment?: {
      comments?: { id?: string; created?: string; author?: { displayName?: string } }[];
    };
  };
  renderedFields?: {
    description?: string;
    created?: string;
    updated?: string;
    comment?: { comments?: { id?: string; created?: string; body?: string }[] };
  };
};

const workRoot = () => path.join(app.getPath('userData'), 'jira-work');

/** Claude 프로필 디렉터리 — `~/.zshrc` 의 계정 선택이 쓰던 것과 같은 경로 */
const ACCOUNT_DIRS: Record<JiraWorkAccount, string> = {
  personal: '.claude',
  team: '.claude-team',
};

const accountDir = (account: JiraWorkAccount) =>
  path.join(os.homedir(), ACCOUNT_DIRS[account]);

/**
 * 고를 수 있는 Claude 계정 — 프로필 폴더가 있는 것만. 어느 계정인지 헷갈리지 않게
 * 그 안의 `.claude.json` 에서 로그인 이메일을 읽어 함께 준다(없으면 미로그인).
 */
export function listWorkAccounts(): JiraWorkAccountInfo[] {
  const labels: Record<JiraWorkAccount, string> = { personal: 'Personal', team: 'Team' };
  const out: JiraWorkAccountInfo[] = [];
  for (const id of ['personal', 'team'] as JiraWorkAccount[]) {
    const dir = accountDir(id);
    if (!fs.existsSync(dir)) continue;
    let email: string | undefined;
    try {
      const raw = fs.readFileSync(path.join(dir, '.claude.json'), 'utf8');
      const parsed = JSON.parse(raw) as { oauthAccount?: { emailAddress?: string } };
      email = parsed.oauthAccount?.emailAddress;
    } catch {
      /* 미로그인·손상 — 라벨만 보여준다 */
    }
    out.push({ id, label: labels[id], dir, email });
  }
  return out;
}

/**
 * 이슈 키 정규화 — 폴더 이름이 되므로 영문·숫자·하이픈만 남긴다.
 * ⚠️ 키는 렌더러가 넘기는 값이다. 경로 구분자가 섞이면 userData 밖으로 쓰게 된다.
 */
function safeKey(key: string): string {
  return key.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

/** 파일명 정규화 — 경로 구분자 제거 + 과도한 길이 절단(확장자 보존) */
function safeFileName(name: string, fallback: string): string {
  const base = name.replace(/[/\\]/g, '_').replace(/^\.+/, '').trim();
  if (!base) return fallback;
  if (base.length <= 80) return base;
  const ext = path.extname(base).slice(0, 10);
  return base.slice(0, 80 - ext.length) + ext;
}

/**
 * 지금 살아있는 세션이 참조 중인 티켓 키 — 정리에서 제외한다.
 * 세션 제목이 티켓 키로 시작하는지로 판정한다(작업 시작 시 제목을 키로 준다).
 * ⚠️ 사용자가 세션 이름을 바꾸면 보호가 풀린다 — 그래도 KEEP_TICKETS 안에 있으면 남는다.
 */
function ticketKeysInUse(): Set<string> {
  const keys = new Set<string>();
  for (const s of listSessions()) {
    const m = /^[A-Z][A-Z0-9]*-\d+/.exec(s.title.trim().toUpperCase());
    if (m) keys.add(m[0]);
  }
  return keys;
}

/** 오래된 티켓 폴더 정리 — 최근 KEEP_TICKETS 개만 남긴다 */
function pruneOldTickets(protectedKeys: Set<string>): void {
  const root = workRoot();
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return; // 폴더가 아직 없음
  }
  const rows = names
    .map((name) => {
      try {
        const st = fs.statSync(path.join(root, name));
        return st.isDirectory() ? { name, at: st.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter((r): r is { name: string; at: number } => r !== null)
    .sort((a, b) => b.at - a.at); // 최신 순

  for (const row of rows.slice(KEEP_TICKETS)) {
    if (protectedKeys.has(row.name)) continue;
    try {
      fs.rmSync(path.join(root, row.name), { recursive: true, force: true });
    } catch {
      /* 지우지 못해도 진행 — 다음 준비 때 다시 시도한다 */
    }
  }
}

/** HTML 엔티티 되돌리기 — 태그를 다 걷어낸 **뒤에** 부를 것(코드 예제의 &lt;div&gt; 보존) */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[09];/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, '&');
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

/**
 * Jira 가 렌더한 HTML → 마크다운(근사).
 * 라이브러리를 새로 들이지 않고 femc 가 읽기 좋은 수준까지만 변환한다 —
 * 목적은 원문 재현이 아니라 **맥락 전달**이다.
 *
 * `imageFile` 은 이미지 src → 내려받은 첨부 파일명 해석기. 매칭되면 마크다운 이미지
 * 링크로 남겨 femc 가 실제 파일을 읽을 수 있게 한다.
 */
function htmlToMarkdown(
  html: string,
  imageFile: (src: string) => string | null,
): string {
  let s = html;

  // 이미지 — 첨부 파일과 연결되면 링크로, 아니면 자리만 표시
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    const alt = /\salt=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    const file = imageFile(src);
    if (file) return `\n\n![${alt || file}](attachments/${file})\n\n`;
    return `\n\n[이미지${alt ? `: ${alt}` : ''}]\n\n`;
  });

  // 코드 블록 — Jira 는 <pre> 로 렌더한다
  s = s.replace(/<pre\b[^>]*>/gi, '\n\n```\n').replace(/<\/pre>/gi, '\n```\n\n');
  s = s.replace(/<code\b[^>]*>/gi, '`').replace(/<\/code>/gi, '`');

  s = s.replace(
    /<a\b[^>]*\shref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, text: string) => `[${stripTags(text).trim()}](${href})`,
  );
  s = s.replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `);
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(td|th)>/gi, ' | ');
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|h[1-6]|ul|ol|blockquote|table)>/gi, '\n\n');

  s = stripTags(s);
  s = decodeEntities(s);
  // 줄 끝 공백 정리 + 빈 줄 3개 이상은 2개로
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 첨부 다운로드 — 이미지 우선, 상한까지. 반환값은 attachment id → 저장한 파일명 */
async function downloadAttachments(
  attachments: RawAttachment[],
  dir: string,
  authHeader: string,
): Promise<Map<string, string>> {
  const saved = new Map<string, string>();
  // 이미지가 먼저 잘리지 않게 앞으로 — 화면 문제 티켓의 핵심 근거가 스크린샷이다
  const targets = [...attachments]
    .filter((a) => a.content && (a.size ?? 0) <= ATTACHMENT_MAX_BYTES)
    .sort((a, b) => {
      const ai = a.mimeType?.startsWith('image/') ? 0 : 1;
      const bi = b.mimeType?.startsWith('image/') ? 0 : 1;
      return ai - bi;
    })
    .slice(0, MAX_ATTACHMENTS);
  if (targets.length === 0) return saved;

  fs.mkdirSync(dir, { recursive: true });
  const used = new Set<string>();
  await Promise.all(
    targets.map(async (att, i) => {
      const id = att.id ?? String(i);
      let name = safeFileName(att.filename ?? '', `attachment-${id}`);
      // 같은 이름이 여러 개면 id 를 붙여 구분한다
      if (used.has(name)) name = `${id}-${name}`;
      used.add(name);
      try {
        const res = await fetch(
          att.content as string,
          { headers: { Authorization: authHeader } },
          ATTACHMENT_TIMEOUT_MS,
        );
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > ATTACHMENT_MAX_BYTES) return;
        fs.writeFileSync(path.join(dir, name), buf);
        saved.set(id, name);
      } catch {
        /* 실패한 첨부는 건너뛴다 — 본문만으로도 작업은 시작된다 */
      }
    }),
  );
  return saved;
}

/** 실행할 femc 스킬 — 'auto' 는 이슈 타입으로 판정 */
function resolveSkill(skill: JiraWorkSkill, issueType: string): string | null {
  if (skill === 'none') return null;
  if (skill !== 'auto') return `/${skill}`;
  return /버그|bug|결함|장애|defect/i.test(issueType) ? '/bugfix' : '/dev';
}

/** 티켓 맥락 마크다운 — femc 가 읽을 본문 */
function buildTicketMarkdown(params: {
  key: string;
  url: string;
  issue: RawWorkIssue;
  descriptionMd: string;
  comments: { author: string; created: string; body: string }[];
  attachmentFiles: string[];
}): string {
  const f = params.issue.fields;
  const meta = [
    ['상태', f.status?.name],
    ['유형', f.issuetype?.name],
    ['우선순위', f.priority?.name],
    ['보고자', f.reporter?.displayName],
    ['담당자', f.assignee?.displayName],
    // ⚠️ renderedFields 의 시각은 "오늘 9:44 오전" 같은 **상대 표기**라 나중에 읽는
    // 에이전트에게는 기준이 없다. 원본 ISO 를 그대로 준다.
    ['생성', f.created],
    ['갱신', f.updated],
    ['링크', params.url],
  ]
    .filter(([, v]) => !!v)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const parts = [
    `# ${params.key} — ${f.summary ?? '(제목 없음)'}`,
    meta,
    '## 설명',
    params.descriptionMd || '(본문 없음)',
  ];

  if (params.attachmentFiles.length > 0) {
    parts.push(
      '## 첨부',
      params.attachmentFiles.map((n) => `- attachments/${n}`).join('\n'),
    );
  }
  if (params.comments.length > 0) {
    parts.push(`## 댓글 (${params.comments.length})`);
    for (const c of params.comments) {
      parts.push(`### ${c.author}${c.created ? ` · ${c.created}` : ''}\n\n${c.body}`);
    }
  }
  return `${parts.join('\n\n')}\n`;
}

/**
 * 티켓 맥락을 준비하고 femc 실행 명령을 만든다.
 * 같은 티켓을 다시 시작하면 폴더를 **최신 내용으로 덮어쓴다**(그새 댓글이 달렸을 수 있다).
 */
export async function prepareJiraWork(
  input: JiraWorkPrepareInput,
): Promise<JiraWorkPrepareResult> {
  const key = safeKey(input.key ?? '');
  if (!key) return { ok: false, error: '이슈 키가 올바르지 않습니다.' };

  const cfg = getJiraApiConfig();
  if (!cfg) {
    return {
      ok: false,
      error: '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.',
    };
  }
  const authHeader = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;

  let issue: RawWorkIssue;
  try {
    const res = await fetch(
      `${cfg.url}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${WORK_FIELDS}&expand=renderedFields`,
      { headers: { Authorization: authHeader, Accept: 'application/json' } },
      ISSUE_TIMEOUT_MS,
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.' };
    }
    if (res.status === 404) {
      return { ok: false, error: '이슈를 찾을 수 없습니다 — 키 또는 권한을 확인하세요.' };
    }
    if (!res.ok) return { ok: false, error: `Jira 응답 오류 (HTTP ${res.status})` };
    issue = (await res.json()) as RawWorkIssue;
  } catch (err) {
    return {
      ok: false,
      error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  }

  const dir = path.join(workRoot(), key);
  const attachmentsDir = path.join(dir, 'attachments');
  try {
    // 재시작이면 첨부를 통째로 새로 받는다 — 지워진 첨부가 남아 오해를 만들지 않게
    fs.rmSync(attachmentsDir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `작업 폴더를 만들지 못했습니다 — ${(err as Error).message}` };
  }

  const attachments = issue.fields.attachment ?? [];
  const savedById = await downloadAttachments(attachments, attachmentsDir, authHeader);

  // 본문 HTML 의 이미지 src → 내려받은 파일. Jira 는 첨부 id 를 URL 에 담아 렌더한다
  // (`/rest/api/3/attachment/thumbnail/10234`, `/secure/attachment/10234/name.png`).
  const imageFile = (src: string): string | null => {
    const byId = /attachment\/(?:thumbnail\/|content\/)?(\d+)/.exec(src)?.[1];
    if (byId && savedById.has(byId)) return savedById.get(byId) ?? null;
    // id 를 못 읽으면 파일명으로 한 번 더 맞춰 본다
    const tail = decodeURIComponent(src.split('?')[0].split('/').pop() ?? '');
    for (const name of savedById.values()) if (name === tail) return name;
    return null;
  };

  const rendered = issue.renderedFields ?? {};
  const metaComments = issue.fields.comment?.comments ?? [];
  const renderedComments = rendered.comment?.comments ?? [];
  const comments = renderedComments.map((rc, i) => {
    const meta = (rc.id && metaComments.find((mc) => mc.id === rc.id)) || metaComments[i];
    return {
      author: meta?.author?.displayName ?? '(알 수 없음)',
      // 본문 메타와 같은 이유로 원본 ISO 우선 (렌더된 값은 "오늘 10:35 오전")
      created: meta?.created ?? rc.created ?? '',
      body: htmlToMarkdown(rc.body ?? '', imageFile),
    };
  });

  const summary = issue.fields.summary ?? '(제목 없음)';
  const url = `${cfg.url}/browse/${key}`;
  const markdown = buildTicketMarkdown({
    key,
    url,
    issue,
    descriptionMd: htmlToMarkdown(rendered.description ?? '', imageFile),
    comments,
    attachmentFiles: [...savedById.values()],
  });

  const ticketPath = path.join(dir, 'ticket.md');
  try {
    fs.writeFileSync(ticketPath, markdown, 'utf8');
  } catch (err) {
    return { ok: false, error: `티켓 파일을 쓰지 못했습니다 — ${(err as Error).message}` };
  }

  // 이번 티켓과 세션이 물고 있는 티켓은 남기고 오래된 것부터 정리
  const keep = ticketKeysInUse();
  keep.add(key);
  pruneOldTickets(keep);

  const skillCmd = resolveSkill(input.skill, issue.fields.issuetype?.name ?? '');
  const note = input.note?.trim();
  const hasAttachments = savedById.size > 0;

  const head = `${skillCmd ? `${skillCmd} ` : ''}${key} — ${summary}`;
  // ⚠️ `@경로` 파일 참조를 쓰지 않는다 — userData 경로에 **공백이 있어서**
  // (`~/Library/Application Support/One App/…`) `@` 뒤가 공백에서 잘린다.
  // 대신 읽으라고 지시하면 Read 로 절대경로를 그대로 넘겨 공백과 무관하게 열린다.
  const lines = [
    `${head} 티켓을 작업해줘.`,
    '',
    '티켓 내용은 아래 파일에 있다 — 먼저 읽고 시작해줘.',
    `- 티켓: ${ticketPath}`,
  ];
  if (hasAttachments) {
    lines.push(`- 첨부(이미지 포함, 본문에서 참조): ${attachmentsDir}`);
  }
  if (note) lines.push('', `추가 지시: ${note}`);
  const prompt = lines.join('\n');

  // 이미 떠 있는 femc 에 넣을 문구는 **한 줄**이어야 한다 — TUI 에 그대로 쓰면
  // 개행이 곧 전송이라 중간에 잘려 제출된다.
  const paste = [
    `${head} 티켓을 작업해줘.`,
    `티켓 파일을 먼저 읽어줘: ${ticketPath}`,
    hasAttachments ? `첨부: ${attachmentsDir}` : '',
    note ? `추가 지시: ${note}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // ── 실행 명령 — femc 가 **뜨자마자 입력 가능한 상태**여야 한다 (2026-08-12 실측) ──
  // 그냥 `femc --add-dir … "<프롬프트>"` 로 띄우면 게이트 셋을 사람이 넘겨야 했다:
  //  ① `~/.zshrc` 의 femc() 함수가 묻는 **계정 선택** → `command femc` 로 함수를 건너뛰고
  //     그 함수가 하던 일(CLAUDE_CONFIG_DIR 지정)을 앱이 직접 한다.
  //  ② femc 는 **첫 인자가 플래그면 메뉴 루프**(Run/Resume/Git…)로 빠진다 → 프롬프트를
  //     맨 앞에 두면 곧장 claude 로 간다.
  //  ③ 그 메뉴 경로에서만 도는 업데이트 확인 → FEMC_SKIP_UPDATE_CHECK=1 로 한 번 더 막는다.
  // (`--dangerously-skip-permissions` 는 femc 가 자체적으로 붙이므로 권한 창도 없다)
  const configDir = accountDir(input.account ?? 'personal');
  const command = [
    `CLAUDE_CONFIG_DIR=${shQuote(configDir)}`,
    'FEMC_SKIP_UPDATE_CHECK=1',
    'command femc',
    shQuote(prompt),
    '--add-dir',
    shQuote(dir),
  ].join(' ');

  return {
    ok: true,
    command,
    paste,
    title: key,
    dir,
    attachments: savedById.size,
  };
}
