// 변경사항 뷰 — 파일 목록 + unified diff + 커밋·푸시 (터미널 드로어·MO '변경' 탭 공용).
// "AI 작업 → 변경 확인 → 커밋 → 푸시" 루프를 이 화면에서 끝낸다.
// 상태·모드·커밋 목록 로직은 useChanges 훅 — 전체화면(ChangesOverlay)과 공유한다.
import { memo, useMemo, useState } from 'react';
import type {
  ChangedFile,
  ChangedFileKind,
  ChangesDiffResult,
  ChangesTarget,
} from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Collapsible } from '../../../components/Collapsible';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { Segment } from '../../../components/Segment';
import { Textarea } from '../../../components/Textarea';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { relTime } from '../lib/diff';
import { pushConfirmMessage } from '../lib/push';
import { useChanges } from '../lib/useChanges';

export const KIND_CHAR: Record<ChangedFileKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflict: 'U',
};

/** diff 한 줄의 표시 분류 — 색은 SCSS 토큰(--ok/--danger 등)에서 */
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'changes__dline--meta';
  if (line.startsWith('+')) return 'changes__dline--add';
  if (line.startsWith('-')) return 'changes__dline--del';
  if (line.startsWith('@@')) return 'changes__dline--hunk';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'changes__dline--meta';
  return '';
}

const UNIFIED_CHUNK = 1200; // 한 번에 그리는 줄 수 — 초대형 diff DOM 폭주 방지

/**
 * 드로어의 unified diff — memo: useChanges 가 내용이 같으면 같은 result 객체를
 * 유지하므로 5초 폴링에서 재렌더가 0이다. 긴 diff 는 청크로 끊어 그린다.
 */
const UnifiedDiff = memo(function UnifiedDiff({ result }: { result: ChangesDiffResult }) {
  const [limit, setLimit] = useState(UNIFIED_CHUNK);
  const lines = useMemo(
    () => (result.ok && !result.binary ? (result.diff ?? '').split('\n') : []),
    [result]
  );
  return (
    <pre className="changes__diff">
      {!result.ok && (
        <span className="changes__dline--meta">diff 실패: {result.error}</span>
      )}
      {result.ok && result.binary && (
        <span className="changes__dline--meta">
          바이너리 파일 — diff 를 표시할 수 없습니다.
        </span>
      )}
      {result.ok && !result.binary && (
        <>
          {lines.slice(0, limit).map((line, i) => (
            <span key={i} className={`changes__dline ${lineClass(line)}`}>
              {line}
              {'\n'}
            </span>
          ))}
          {lines.length > limit && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLimit((n) => n + UNIFIED_CHUNK * 4)}
            >
              {lines.length - limit}줄 더 보기
            </Button>
          )}
          {result.truncated && (
            <span className="changes__dline--meta">… (너무 길어 잘렸습니다)</span>
          )}
        </>
      )}
    </pre>
  );
});

/** 파일 행 — 드로어·전체화면 공용 (종류 글자 + 경로 + 줄 수) */
export function ChangedFileRow({
  file,
  active,
  onClick,
  onDoubleClick,
}: {
  file: ChangedFile;
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`changes__file${active ? ' changes__file--active' : ''}`}
      title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <span className={`changes__kind changes__kind--${file.kind}`}>
        {KIND_CHAR[file.kind]}
      </span>
      <span className="changes__path">{file.path}</span>
      {(file.additions ?? file.deletions) !== undefined && (
        <span className="changes__counts">
          +{file.additions ?? 0} −{file.deletions ?? 0}
        </span>
      )}
    </button>
  );
}

export function ChangesView({
  target,
  onExpand,
  polling = true,
}: {
  target: ChangesTarget;
  /** 있으면 헤더에 전체화면 확대 버튼이 붙는다 (데스크톱 드로어 전용) */
  onExpand?: () => void;
  /** false 면 폴링 중지 — 전체화면 오버레이가 위에 떠 있는 동안 이중 폴링 방지 */
  polling?: boolean;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const ch = useChanges(target, { enabled: polling });
  const [message, setMessage] = useState('');

  const { status } = ch;

  const doCommit = async () => {
    const r = await ch.commit(message);
    if (r.ok) {
      toast(`커밋 완료${r.hash ? ` (${r.hash})` : ''}`);
      setMessage('');
    } else {
      toast(`커밋 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
    }
  };

  const doPush = async () => {
    if (!status) return;
    const ok = await confirm({
      title: '원격으로 푸시',
      message: pushConfirmMessage(status),
      confirmLabel: '푸시',
    });
    if (!ok) return;
    const r = await ch.push();
    if (r.ok) toast('푸시 완료');
    else toast(`푸시 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
  };

  if (!status) {
    return (
      <div className="changes changes--center">
        <span className="spinner" />
      </div>
    );
  }
  if (!status.repo) {
    return (
      <div className="changes changes--center">
        <EmptyState
          icon="folder"
          message="git 저장소가 아닙니다"
          hint="이 위치에는 변경사항을 표시할 저장소가 없습니다."
        />
      </div>
    );
  }

  const files = ch.files;
  const unpushed = status.unpushed ?? [];
  // upstream 이 없으면 ahead 를 알 수 없다 — 새 브랜치는 항상 푸시 허용
  const canPush = status.upstream ? (status.ahead ?? 0) > 0 : !!status.branch;
  // 모드 토글 — 베이스 브랜치가 있을 때만. branch 모드 에러 시에도 남겨 되돌아올 수 있게
  const showSegment = !!status.baseBranch || ch.mode === 'branch';

  return (
    <div className="changes">
      <div className="changes__head">
        <Icon name="git-branch" size={13} />
        <span
          className="changes__branch"
          title={
            status.branch
              ? status.upstream
                ? `${status.branch} → ${status.upstream}`
                : status.branch
              : undefined
          }
        >
          {status.branch ?? '(브랜치 없음)'}
        </span>
        {(status.behind ?? 0) > 0 && (
          <span className="changes__ab changes__ab--behind">↓{status.behind}</span>
        )}
        <span className="changes__spacer" />
        <div className="changes__actions">
          {onExpand && (
            // 눈에 띄어야 한다 — 13px 글리프로 뒀더니 있는 줄도 몰랐다(2026-08-07 사용자 지적)
            <Tooltip label="전체 화면으로 보기 (파일 더블클릭도 동일)">
              <button
                type="button"
                className="icon-btn changes__expand"
                aria-label="변경사항 전체 화면"
                onClick={onExpand}
              >
                <Icon name="maximize" size={15} />
              </button>
            </Tooltip>
          )}
          <RefreshButton onClick={() => void ch.refresh()} />
          {/* 툴바에서 유일한 primary 필이라 혼자 튀었다(2026-08-07 사용자 지적) — 아이콘 버튼
              크기의 ghost 톤으로 낮추고, 올릴 게 있을 때만 액센트 + 개수로 신호한다 */}
          <Tooltip
            label={canPush ? `커밋 ${status.ahead ?? ''}개 푸시` : '푸시할 커밋이 없습니다'}
          >
            <Button
              size="sm"
              className={'changes__push' + (canPush ? ' changes__push--ready' : '')}
              aria-label="원격으로 푸시"
              loading={ch.pushing}
              disabled={!canPush}
              onClick={() => void doPush()}
            >
              <Icon name="arrow-up-to-line" size={14} />
              {(status.ahead ?? 0) > 0 && status.ahead}
            </Button>
          </Tooltip>
        </div>
      </div>

      {showSegment && (
        <div className="changes__mode">
          <Segment
            options={[
              { value: 'work', label: '변경' },
              { value: 'branch', label: `${status.baseBranch ?? 'main'} 대비` },
            ]}
            value={ch.mode}
            onChange={ch.setMode}
          />
          {ch.commitSel && (
            <span className="changes__mode-commit">
              <Icon name="git-commit" size={12} />
              <code>{ch.commitSel.hash}</code> 커밋을 보는 중
            </span>
          )}
        </div>
      )}

      {!status.ok ? (
        <div className="changes--center">
          <EmptyState icon="alert-triangle" message="상태 조회 실패" hint={status.error} />
        </div>
      ) : (
        <>
          {/* 커밋 작성 — 워킹트리 변경이 있을 때만 (add -A 일괄 커밋) */}
          {ch.mode === 'work' && !ch.commitSel && (status.files?.length ?? 0) > 0 && (
            <div className="changes__commitbox">
              <Textarea
                rows={2}
                placeholder="커밋 메시지"
                aria-label="커밋 메시지"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <Button
                size="sm"
                loading={ch.committing}
                disabled={!message.trim()}
                onClick={() => void doCommit()}
              >
                커밋
              </Button>
            </div>
          )}

          {files === null ? (
            <div className="changes--center">
              <span className="spinner" />
            </div>
          ) : files.length === 0 ? (
            <div className="changes--center">
              <EmptyState
                icon="check"
                message="변경사항이 없습니다"
                hint={
                  unpushed.length > 0
                    ? '커밋이 푸시를 기다리고 있습니다.'
                    : ch.mode === 'branch'
                      ? `${status.baseBranch} 와 차이가 없습니다.`
                      : '워킹트리가 깨끗합니다.'
                }
              />
            </div>
          ) : (
            <div className="changes__files">
              {files.map((f) => (
                <ChangedFileRow
                  key={f.path}
                  file={f}
                  active={ch.selected?.path === f.path}
                  // 같은 파일 다시 클릭 = 닫기 (드로어는 diff 가 아래 붙어 토글이 자연스럽다)
                  onClick={() => ch.selectFile(ch.selected?.path === f.path ? null : f)}
                  // 더블클릭 = 전체 화면 — 아이콘 버튼만으론 진입 경로를 못 찾는다
                  onDoubleClick={onExpand}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* 커밋 목록 — 미푸시는 점으로 표시. 클릭하면 그 커밋의 파일·diff 를 본다 */}
      {ch.log.length > 0 && (
        <Collapsible
          title={`커밋 ${ch.log.length}`}
          icon={<Icon name="git-commit" size={14} />}
          storageKey="changes:logOpen"
          defaultOpen={false}
        >
          <div className="changes__log">
            {ch.log.map((c) => (
              <button
                key={c.hash}
                type="button"
                className={`changes__log-row${
                  ch.commitSel?.hash === c.hash ? ' changes__log-row--active' : ''
                }`}
                title={c.subject}
                onClick={() => ch.selectCommit(ch.commitSel?.hash === c.hash ? null : c)}
              >
                <span
                  className={`changes__log-dot${c.unpushed ? ' changes__log-dot--unpushed' : ''}`}
                  aria-hidden="true"
                />
                <code>{c.hash}</code>
                <span className="changes__log-subject">{c.subject}</span>
                <span className="changes__log-date">{relTime(c.date)}</span>
              </button>
            ))}
          </div>
        </Collapsible>
      )}

      {ch.selected &&
        (ch.diff ? (
          // key=파일 경로 — 파일 전환 시 '더 보기' 상한 리셋 (같은 파일 갱신은 유지)
          <UnifiedDiff key={ch.selected.path} result={ch.diff} />
        ) : (
          <pre className="changes__diff">
            <span className="changes__dline--meta">불러오는 중…</span>
          </pre>
        ))}
    </div>
  );
}
