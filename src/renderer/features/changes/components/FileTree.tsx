// 변경 파일 트리 (전체화면 좌측) — 2026-09-30 목업: 폴더 행 + 깊이마다 14px 들여쓰기.
// ⚠️ 자식이 폴더 하나뿐인 폴더는 한 줄로 합친다(`src/features/cart`) — 예전 평면 목록으로 바꿨던
//    이유가 "한 자식 폴더가 계단처럼 쌓여 폭만 먹는다"(2026-08-07 사용자 요청)였다. 합치면 계단이 없다.
import { memo, useMemo } from 'react';
import type { ChangedFile } from '../../../../shared/types';
import { Icon } from '../../../components/Icon';
import { KIND_CHAR } from './ChangesView';

type Dir = { name: string; dirs: Map<string, Dir>; files: ChangedFile[] };
type Row =
  | { kind: 'dir'; key: string; name: string; depth: number }
  | {
      kind: 'file';
      key: string;
      file: ChangedFile;
      name: string;
      depth: number;
    };

function buildRows(files: ChangedFile[]): Row[] {
  const root: Dir = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let d = root;
    for (const p of parts.slice(0, -1)) {
      let next = d.dirs.get(p);
      if (!next) {
        next = { name: p, dirs: new Map(), files: [] };
        d.dirs.set(p, next);
      }
      d = next;
    }
    d.files.push(f);
  }
  const rows: Row[] = [];
  const walk = (d: Dir, depth: number, prefix: string) => {
    for (const child of [...d.dirs.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      // 한 자식 폴더 체인 합치기
      let node = child;
      let label = child.name;
      while (node.files.length === 0 && node.dirs.size === 1) {
        node = [...node.dirs.values()][0];
        label += `/${node.name}`;
      }
      const key = `${prefix}${label}/`;
      rows.push({ kind: 'dir', key, name: label, depth });
      walk(node, depth + 1, key);
    }
    for (const f of d.files) {
      rows.push({
        kind: 'file',
        key: f.path,
        file: f,
        name: f.path.slice(f.path.lastIndexOf('/') + 1),
        depth,
      });
    }
  };
  walk(root, 0, '');
  return rows;
}

export const FileTree = memo(function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: ChangedFile[];
  selectedPath?: string;
  onSelect: (file: ChangedFile) => void;
}) {
  const rows = useMemo(() => buildRows(files), [files]);
  return (
    <div className="ftree">
      {rows.map((r) =>
        r.kind === 'dir' ? (
          <div
            key={r.key}
            className="ftree__dirrow"
            style={{ '--ftree-depth': r.depth } as React.CSSProperties}
          >
            <Icon name="folder" size={13} />
            <span className="ftree__dirname">{r.name}</span>
          </div>
        ) : (
          <button
            key={r.key}
            type="button"
            className={
              'ftree__file' +
              (selectedPath === r.file.path ? ' ftree__file--active' : '') +
              (r.file.kind === 'deleted' ? ' ftree__file--deleted' : '')
            }
            style={{ '--ftree-depth': r.depth } as React.CSSProperties}
            title={
              r.file.origPath
                ? `${r.file.origPath} → ${r.file.path}`
                : r.file.path
            }
            onClick={() => onSelect(r.file)}
          >
            <span className={`changes__kind changes__kind--${r.file.kind}`}>
              {KIND_CHAR[r.file.kind]}
            </span>
            <span className="ftree__name">{r.name}</span>
            {(r.file.additions ?? r.file.deletions) !== undefined && (
              <span className="ftree__counts">
                {(r.file.additions ?? 0) > 0 && (
                  <span className="ftree__add">+{r.file.additions}</span>
                )}
                {(r.file.deletions ?? 0) > 0 && (
                  <span className="ftree__del">−{r.file.deletions}</span>
                )}
              </span>
            )}
          </button>
        ),
      )}
    </div>
  );
});
