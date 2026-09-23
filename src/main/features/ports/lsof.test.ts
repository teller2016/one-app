import { describe, expect, it } from 'vitest';
import type { Project } from '../../../shared/types';
import { buildProcesses, matchProject, parseCwds, parseListeners, portOf } from './lsof';

// 실제 `lsof -nP -iTCP -sTCP:LISTEN -F pcLn` 출력 형태 — 같은 포트가 IPv4/IPv6 로 두 줄씩 온다
const LISTEN_RAW = [
  'p667', 'cControlCenter', 'Lsbjung', 'f9', 'n*:7000', 'f10', 'n*:7000',
  'p898', 'ccom.docker.backend', 'Lsbjung', 'f155', 'n*:80', 'f179', 'n*:54321',
  'p4242', 'cnode', 'Lsbjung', 'f20', 'n127.0.0.1:3000', 'f21', 'n[::1]:3000',
].join('\n');

const CWD_RAW = ['p4242', 'fcwd', 'n/Users/sbjung/projects/metacommerce/metacommerce-fe-store/src'].join('\n');

const PROJECTS = [
  { id: '1', name: 'metacommerce store', localPath: '/Users/sbjung/projects/metacommerce/metacommerce-fe-store' },
  { id: '2', name: 'projects 루트', localPath: '/Users/sbjung/projects' },
] as Project[];

describe('portOf', () => {
  it('마지막 콜론 뒤가 포트다 — IPv6 는 콜론이 여러 개다', () => {
    expect(portOf('*:7000')).toBe(7000);
    expect(portOf('127.0.0.1:3000')).toBe(3000);
    expect(portOf('[::1]:5173')).toBe(5173);
  });

  it('포트가 없으면 0', () => {
    expect(portOf('/tmp/some.sock')).toBe(0);
  });
});

describe('parseListeners', () => {
  it('p 를 만나면 새 프로세스로 끊고 주소를 모은다', () => {
    const procs = parseListeners(LISTEN_RAW);
    expect(procs).toHaveLength(3);
    expect(procs[0]).toMatchObject({ pid: 667, command: 'ControlCenter', user: 'sbjung' });
    expect(procs[0].addresses).toEqual(['*:7000', '*:7000']);
    // 기본 출력이라면 'com.docke' 로 잘렸을 이름이 -F 포맷에서는 온전하다
    expect(procs[1].command).toBe('com.docker.backend');
  });
});

describe('parseCwds', () => {
  it('pid 별 작업 디렉터리를 모은다', () => {
    expect(parseCwds(CWD_RAW).get(4242)).toBe(
      '/Users/sbjung/projects/metacommerce/metacommerce-fe-store/src',
    );
  });
});

describe('matchProject', () => {
  it('하위 경로도 인정하고, 겹치면 더 깊은 쪽을 고른다', () => {
    const cwd = '/Users/sbjung/projects/metacommerce/metacommerce-fe-store/src';
    expect(matchProject(cwd, PROJECTS)).toBe('metacommerce store');
  });

  it('루트나 빈 cwd 는 매칭하지 않는다', () => {
    expect(matchProject('/', PROJECTS)).toBe('');
    expect(matchProject('', PROJECTS)).toBe('');
  });

  it('비슷한 이름의 옆 폴더를 삼키지 않는다', () => {
    expect(matchProject('/Users/sbjung/projects-old/x', PROJECTS)).toBe('');
  });
});

describe('buildProcesses', () => {
  const procs = buildProcesses(
    parseListeners(LISTEN_RAW),
    parseCwds(CWD_RAW),
    PROJECTS,
    99999,
  );

  it('한 프로세스의 여러 포트를 한 줄로 묶는다', () => {
    // docker 는 80·54321 두 포트를 연다 — 예전에는 두 줄이었다
    const docker = procs.find((e) => e.pid === 898);
    expect(docker?.ports).toEqual([80, 54321]);
    expect(procs.filter((e) => e.pid === 898)).toHaveLength(1);
  });

  it('같은 포트의 IPv4/IPv6 는 포트를 중복시키지 않는다', () => {
    const node = procs.find((e) => e.pid === 4242);
    expect(node?.ports).toEqual([3000]); // 127.0.0.1:3000 + [::1]:3000
    expect(node?.addresses).toEqual(['127.0.0.1:3000', '[::1]:3000']);
  });

  it('포트는 오름차순으로 정렬한다', () => {
    expect(procs.find((e) => e.pid === 898)?.ports).toEqual([80, 54321]);
  });

  it('프로젝트가 걸린 것을 맨 위로 올린다', () => {
    expect(procs[0].projectName).toBe('metacommerce store');
    expect(procs[0].pid).toBe(4242);
  });

  it('macOS 구성요소는 보호 표시한다', () => {
    expect(procs.find((e) => e.pid === 667)?.guarded).toBe(true);
    expect(procs.find((e) => e.pid === 4242)?.guarded).toBe(false);
  });

  it('개발 프로세스를 구분한다 — 기본 필터가 이 값으로 거른다', () => {
    expect(procs.find((e) => e.pid === 4242)?.dev).toBe(true); // node + 프로젝트 매칭
    expect(procs.find((e) => e.pid === 898)?.dev).toBe(true); // com.docker.backend
    expect(procs.find((e) => e.pid === 667)?.dev).toBe(false); // ControlCenter
  });

  // ⚠️ 회귀 방지: 단어 경계가 없으면 `go` 가 "Google Chrome" 에 걸린다 (2026-09-23 실측 버그)
  it('짧은 런타임 이름이 다른 낱말에 걸리지 않는다', () => {
    const raw = [
      'p100', 'cGoogle Chrome', 'Lsbjung', 'f1', 'n127.0.0.1:9223',
      'p101', 'cgo', 'Lsbjung', 'f1', 'n*:8080',
      'p102', 'cnodemon-ish-thing', 'Lsbjung', 'f1', 'n*:8081',
    ].join('\n');
    const r = buildProcesses(parseListeners(raw), new Map(), [], 0);
    expect(r.find((e) => e.pid === 100)?.dev).toBe(false); // Google Chrome
    expect(r.find((e) => e.pid === 101)?.dev).toBe(true); // 진짜 go
    expect(r.find((e) => e.pid === 102)?.dev).toBe(false); // node 로 시작하지만 다른 낱말
  });
});
