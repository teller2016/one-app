// 자동 업데이트 순수 로직 테스트 — 루트 `npm test`(vitest) 가 돌린다.
// Windows 헬퍼는 이 맥에서 실행할 수 없으므로 스크립트 본문의 **순서와 안전장치**를 여기서 지킨다.
import { describe, expect, it } from 'vitest';
import {
  compareVersion,
  macSwapScript,
  pickAsset,
  psq,
  shq,
  winSwapScript,
  type SwapPlan,
} from './updateCore';

describe('compareVersion', () => {
  it('세 자리를 순서대로 비교한다', () => {
    expect(compareVersion('2.1.0', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersion('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersion('1.9.9', '2.0.0')).toBeLessThan(0);
    expect(compareVersion('2.0.10', '2.0.9')).toBeGreaterThan(0); // 문자열 비교였다면 틀린다
  });
  it('자리수가 빠지면 0 으로 친다', () => {
    expect(compareVersion('2.1', '2.1.0')).toBe(0);
  });
});

describe('pickAsset', () => {
  const assets = [
    {
      name: 'OneAppLite-darwin-arm64-2.1.0.zip',
      browser_download_url: 'https://x/mac.zip',
      size: 100,
      digest: 'sha256:abc',
    },
    { name: 'OneAppLite-win32-x64-2.1.0.zip', browser_download_url: 'https://x/win.zip', size: 200 },
    { name: 'notes.txt', browser_download_url: 'https://x/notes.txt', size: 1 },
  ];

  it('플랫폼·아키텍처가 맞는 zip 만 고른다', () => {
    expect(pickAsset(assets, 'darwin', 'arm64')).toEqual({
      name: 'OneAppLite-darwin-arm64-2.1.0.zip',
      url: 'https://x/mac.zip',
      size: 100,
      sha256: 'abc',
    });
    expect(pickAsset(assets, 'win32', 'x64')?.url).toBe('https://x/win.zip');
    expect(pickAsset(assets, 'win32', 'x64')?.sha256).toBeUndefined(); // digest 가 없으면 생략
  });
  it('없는 조합(Intel 맥)이면 undefined', () => {
    expect(pickAsset(assets, 'darwin', 'x64')).toBeUndefined();
  });
  it('이상한 입력은 조용히 undefined', () => {
    expect(pickAsset(null, 'darwin', 'arm64')).toBeUndefined();
    expect(pickAsset([{ name: 42 }], 'darwin', 'arm64')).toBeUndefined();
  });
});

describe('인용', () => {
  it("sh 단일 인용 — ' 를 이스케이프한다", () => {
    expect(shq("a'b")).toBe(`'a'\\''b'`);
  });
  it("PowerShell 단일 인용 — ' 를 두 번 쓴다", () => {
    expect(psq("a'b")).toBe("'a''b'");
  });
});

const plan: SwapPlan = {
  pid: 4242,
  target: '/Applications/OneAppLite.app',
  incoming: '/tmp/stage/OneAppLite.app',
  stage: '/tmp/stage',
  backup: '/Applications/OneAppLite.app.bak',
  launch: '/Applications/OneAppLite.app',
  log: '/tmp/update.log',
};

/** 본문에서 각 표식이 이 순서로 등장하는지 — 앞 표식 **뒤에서부터** 찾는다(같은 문구가 여러 번 나와도 순서를 본다) */
const order = (text: string, marks: string[]) => {
  let from = 0;
  for (const m of marks) {
    const i = text.indexOf(m, from);
    expect(i, `"${m}" 이 앞 표식 뒤에 없다`).toBeGreaterThanOrEqual(0);
    from = i + m.length;
  }
};

describe('macSwapScript', () => {
  const s = macSwapScript(plan);
  it('종료 대기 → 백업 → 교체 → 재실행 → 정리 순서', () => {
    order(s, [
      'kill -0 4242',
      'mv "$TARGET" "$BACKUP"',
      'mv "$INCOMING" "$TARGET"',
      'echo "swapped"',
      'open "$LAUNCH"',
      'rm -rf "$BACKUP"',
      'rm -rf "$STAGE"',
      'echo "done"',
    ]);
  });
  it('교체 실패 시 백업을 되돌리고 원래 앱을 띄운다', () => {
    expect(s).toContain('mv "$BACKUP" "$TARGET"');
    // 실패 분기에도 open 이 있다 (성공·실패 합쳐 최소 3곳: 백업 실패·성공·교체 실패)
    expect(s.split('open "$LAUNCH"').length - 1).toBeGreaterThanOrEqual(3);
  });
  it('볼륨이 달라 mv 가 실패하면 ditto 로 복사한다', () => {
    expect(s).toContain('ditto "$INCOMING" "$TARGET"');
  });
  it('정리는 명시된 stage 만 지운다 — incoming 의 상위 폴더를 유추하지 않는다', () => {
    expect(s).toContain('rm -rf "$STAGE"');
    expect(s).not.toContain('dirname');
  });
  it('경로를 단일 인용으로 박는다', () => {
    expect(s).toContain(`TARGET='/Applications/OneAppLite.app'`);
  });
});

describe('winSwapScript', () => {
  const winPlan: SwapPlan = {
    pid: 777,
    target: 'C:\\Users\\홍길동\\OneAppLite',
    incoming: 'C:\\Users\\홍길동\\AppData\\Local\\Temp\\stage\\OneAppLite-win32-x64',
    stage: 'C:\\Users\\홍길동\\AppData\\Local\\Temp\\stage',
    backup: 'C:\\Users\\홍길동\\OneAppLite.bak',
    launch: 'C:\\Users\\홍길동\\OneAppLite\\OneAppLite.exe',
    log: 'C:\\Users\\홍길동\\AppData\\Local\\Temp\\update.log',
  };
  const s = winSwapScript(winPlan);

  it('종료 대기 → 백업(재시도) → 교체 → 재실행 → 정리 순서', () => {
    order(s, [
      'Get-Process -Id 777',
      'Move-Item -LiteralPath $target -Destination $backup',
      'MoveDir $incoming $target',
      "Log 'swapped'",
      'Relaunch',
      'Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue',
      "Log 'done'",
    ]);
  });
  it('백업 이름 바꾸기를 재시도한다 (백신·인덱서 잠금 대비)', () => {
    expect(s).toMatch(/for \(\$i = 0; \$i -lt 20/);
  });
  it('드라이브가 다르면 복사 후 삭제한다 (Move-Item 은 드라이브 간 폴더 이동 불가)', () => {
    order(s, ['GetPathRoot', 'Copy-Item -LiteralPath $from', 'Remove-Item -LiteralPath $from']);
  });
  it('교체 실패·치명 오류 모두 백업을 되돌리고 원래 앱을 띄운다', () => {
    expect(s.split('Move-Item -LiteralPath $backup -Destination $target').length - 1).toBe(2);
    expect(s.split('Relaunch').length - 1).toBeGreaterThanOrEqual(4); // 정의 1 + 호출 3+
  });
  it('한글 경로를 단일 인용으로 본문에 박는다 (인자 인코딩을 피한다)', () => {
    expect(s).toContain(`$target = 'C:\\Users\\홍길동\\OneAppLite'`);
  });
  it('-LiteralPath 만 쓴다 — 경로의 [ ] 가 와일드카드로 해석되지 않게', () => {
    expect(s).not.toMatch(/-Path\s+\$/);
  });
  it('정리는 명시된 stage 만 지운다 — Split-Path 로 상위를 유추하지 않는다', () => {
    expect(s).toContain("$stage = 'C:\\Users\\홍길동\\AppData\\Local\\Temp\\stage'");
    expect(s).not.toContain('Split-Path');
  });
});
