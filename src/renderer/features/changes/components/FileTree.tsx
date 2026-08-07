// 변경 파일 리스트 (전체화면 좌측) — 평면 목록. 파일명을 앞세우고 디렉터리는 뒤에
// 흐리게 붙인다(폴더 트리는 한 자식 폴더가 계단처럼 쌓여 폭만 먹었다 — 2026-08-07 사용자 요청).
import { memo } from 'react';
import type { ChangedFile } from '../../../../shared/types';
import { KIND_CHAR } from './ChangesView';

export const FileTree = memo(function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: ChangedFile[];
  selectedPath?: string;
  onSelect: (file: ChangedFile) => void;
}) {
  return (
    <div className="ftree">
      {files.map((f) => {
        const cut = f.path.lastIndexOf('/');
        const name = f.path.slice(cut + 1);
        const dir = cut >= 0 ? f.path.slice(0, cut) : '';
        return (
          <button
            key={f.path}
            type="button"
            className={'ftree__file' + (selectedPath === f.path ? ' ftree__file--active' : '')}
            title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
            onClick={() => onSelect(f)}
          >
            <span className={`changes__kind changes__kind--${f.kind}`}>
              {KIND_CHAR[f.kind]}
            </span>
            <span className="ftree__label">
              <span className="ftree__name">{name}</span>
              {/* ⚠️ LRM(U+200E)로 감싼다 — 경로는 앞쪽 말줄임(CSS direction:rtl)이라
                  '.claude/rules' 처럼 중립 문자로 시작·끝나면 그 문자가 반대편으로
                  밀려 'claude/rules.' 로 보인다(2026-08-07 실측) */}
              {dir && <span className="ftree__dir">{`\u200E${dir}\u200E`}</span>}
            </span>
            {(f.additions ?? f.deletions) !== undefined && (
              <span className="ftree__counts">
                <span className="ftree__add">+{f.additions ?? 0}</span>
                <span className="ftree__del">−{f.deletions ?? 0}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
