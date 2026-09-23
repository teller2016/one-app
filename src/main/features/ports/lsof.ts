// `lsof` 출력 파싱 — 순수 함수만 둔다(실행은 ipc.ts). 표본과 규칙은 lsof.test.ts.
import type { PortProcess, Project } from '../../../shared/types';

/** `-F` 필드 포맷의 한 프로세스 블록 */
type RawProcess = {
  pid: number;
  command: string;
  user: string;
  addresses: string[];
};

/**
 * `lsof -nP -iTCP -sTCP:LISTEN -F pcLn` 출력을 프로세스 단위로 끊는다.
 *
 * 필드는 줄 첫 글자로 구분된다 — `p`(pid)·`c`(명령)·`L`(로그인)은 프로세스 단위,
 * `f`(fd)·`n`(주소)은 그 프로세스의 파일마다 반복된다. `p` 를 만나면 새 블록이다.
 */
export function parseListeners(raw: string): RawProcess[] {
  const out: RawProcess[] = [];
  let cur: RawProcess | null = null;
  for (const line of raw.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      const pid = Number(value);
      cur = Number.isFinite(pid) ? { pid, command: '', user: '', addresses: [] } : null;
      if (cur) out.push(cur);
    } else if (!cur) {
      continue;
    } else if (tag === 'c') {
      cur.command = value;
    } else if (tag === 'L') {
      cur.user = value;
    } else if (tag === 'n') {
      cur.addresses.push(value);
    }
  }
  return out;
}

/** `lsof -a -p <pids> -d cwd -F pn` 출력 → pid 별 작업 디렉터리 */
export function parseCwds(raw: string): Map<number, string> {
  const out = new Map<number, string>();
  let pid = 0;
  for (const line of raw.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1)) || 0;
    else if (line[0] === 'n' && pid) out.set(pid, line.slice(1));
  }
  return out;
}

/**
 * 주소에서 포트를 떼어 낸다 — `*:3000` · `127.0.0.1:3000` · `[::1]:5173` 모두 **마지막 콜론 뒤**가 포트다.
 * (IPv6 주소에는 콜론이 여러 개라 첫 콜론으로 자르면 안 된다)
 */
export function portOf(address: string): number {
  const at = address.lastIndexOf(':');
  if (at < 0) return 0;
  const port = Number(address.slice(at + 1));
  return Number.isInteger(port) && port > 0 ? port : 0;
}

/**
 * 죽이면 곤란한 프로세스 — macOS 구성요소(AirPlay 수신 7000·5000 등)와 시스템 데몬.
 * 목록에서 감추지는 않는다. "왜 7000 이 잡혀 있지" 를 확인하는 것도 이 화면의 쓸모다.
 */
const GUARDED_COMMANDS = new Set([
  'ControlCenter', // AirPlay 수신 (7000·5000)
  'rapportd', // 연속성·손쉬운 사용
  'sharingd', // 파일 공유·핸드오프
  'AirPlayXPCHelper',
  'remoted',
  'launchd',
  'mDNSResponder',
  'netbiosd',
  'sshd',
  'cupsd',
]);

/** 이름이 시스템 것이거나, 루트/시스템 계정(`_` 로 시작) 소유거나, One App 자신인가 */
function isGuarded(p: RawProcess, selfPid: number): boolean {
  if (p.pid === selfPid) return true;
  if (p.command === 'One App') return true;
  if (GUARDED_COMMANDS.has(p.command)) return true;
  return p.user === 'root' || p.user.startsWith('_');
}

/**
 * cwd 가 어느 프로젝트 안인가 — **하위 경로까지 인정**한다(개발 서버는 보통 하위 폴더에서 뜬다).
 * 여러 개가 걸리면 가장 깊은(구체적인) 것을 고른다 — 상위 폴더도 프로젝트로 등록돼 있을 수 있다.
 */
export function matchProject(cwd: string, projects: Project[]): string {
  if (!cwd || cwd === '/') return '';
  let best = '';
  let bestLen = 0;
  for (const p of projects) {
    const base = p.localPath.replace(/\/+$/, '');
    if (!base) continue;
    if ((cwd === base || cwd.startsWith(`${base}/`)) && base.length > bestLen) {
      best = p.name;
      bestLen = base.length;
    }
  }
  return best;
}

/**
 * 내가 띄운 개발 서버로 보이는가 — 기본 필터가 이 값으로 거른다.
 *
 * 프로젝트가 매칭됐거나, 명령이 개발 런타임이거나, 컨테이너 런타임이면 개발로 본다.
 * ⚠️ 완벽한 분류는 불가능하다(언어 서버·IDE 헬퍼도 node 로 뜬다) — 그래서 **감추는 게 아니라
 * 기본 필터일 뿐**이고, 화면은 '전체' 로 언제든 되돌릴 수 있어야 한다.
 */
// ⚠️ 끝에 `\b`(단어 경계)가 **반드시** 있어야 한다 — 없으면 `go` 가 **"Google Chrome"** 의 Go 에
// 걸려 브라우저가 개발 서버로 분류된다(2026-09-23 실측). 짧은 이름(go·mvn)일수록 위험하다.
const DEV_COMMAND =
  /^(node|deno|bun|java|python\d?|ruby|go|php|dotnet|rails|vite|esbuild|webpack|gradle|mvn|uvicorn|gunicorn|next-server|nginx|postgres|mysqld|redis-server|mongod)\b/i;

function isDev(command: string, projectName: string): boolean {
  if (projectName) return true;
  if (/docker|containerd|colima|podman/i.test(command)) return true;
  return DEV_COMMAND.test(command);
}

/**
 * 프로세스 블록들을 **PID 단위**로 묶어 화면용 목록을 만든다.
 * 같은 프로세스가 여러 포트를 열고, 같은 포트가 IPv4·IPv6 로 두 줄씩 오므로 둘 다 묶는다.
 *
 * 정렬은 프로젝트가 걸린 것 먼저(내가 띄운 서버가 위로), 그다음 가장 낮은 포트 오름차순.
 */
export function buildProcesses(
  procs: RawProcess[],
  cwds: Map<number, string>,
  projects: Project[],
  selfPid: number,
): PortProcess[] {
  const byPid = new Map<number, PortProcess>();
  for (const p of procs) {
    for (const address of p.addresses) {
      const port = portOf(address);
      if (!port) continue;
      let hit = byPid.get(p.pid);
      if (!hit) {
        const cwd = cwds.get(p.pid) ?? '';
        const projectName = matchProject(cwd, projects);
        hit = {
          pid: p.pid,
          command: p.command,
          user: p.user,
          ports: [],
          addresses: [],
          cwd,
          projectName,
          guarded: isGuarded(p, selfPid),
          dev: isDev(p.command, projectName),
        };
        byPid.set(p.pid, hit);
      }
      if (!hit.ports.includes(port)) hit.ports.push(port);
      if (!hit.addresses.includes(address)) hit.addresses.push(address);
    }
  }
  const out = [...byPid.values()];
  for (const e of out) e.ports.sort((a, b) => a - b);
  return out.sort((a, b) => {
    if (!!a.projectName !== !!b.projectName) return a.projectName ? -1 : 1;
    return (a.ports[0] ?? 0) - (b.ports[0] ?? 0) || a.pid - b.pid;
  });
}
