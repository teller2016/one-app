// 변경사항 전체 화면 — Superset 의 diff 뷰어처럼 좌측 패널(커밋 작성·파일·커밋 목록)
// + 우측 사이드-바이-사이드 diff. 터미널 드로어의 ⤢ 버튼이 연다 (데스크톱 전용).
// 상태 로직은 드로어와 같은 useChanges 훅 — 화면 형태만 다르다.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { ChangesTarget } from '../../../../shared/types';
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
import { useChanges } from '../lib/useChanges';
import { KIND_CHAR } from './ChangesView';
import { FileTree } from './FileTree';
import { SplitDiff } from './SplitDiff';

// 좌측 패널 폭·좌우 diff 비율 (UI 상태라 localStorage 로 충분 — 유실돼도 기본값)
const SIDE_MIN = 200;
const SIDE_MAX = 640;
const RATIO_MIN = 20;
const RATIO_MAX = 80;

const savedSide = (() => {
  const n = Number(localStorage.getItem('changes:sideWidth'));
  return Number.isFinite(n) && n >= SIDE_MIN && n <= SIDE_MAX ? n : 320;
})();
const savedRatio = (() => {
  const n = Number(localStorage.getItem('changes:splitRatio'));
  return Number.isFinite(n) && n >= RATIO_MIN && n <= RATIO_MAX ? n : 50;
})();

export function ChangesOverlay({
  target,
  onClose,
}: {
  target: ChangesTarget;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  // fullDiff — 분할 뷰가 hunk 조각이 아니라 '변경 전 파일 | 변경 후 파일' 전체가 되게
  const ch = useChanges(target, { fullDiff: true });
  const [message, setMessage] = useState('');

  // Escape 로 닫기 — 공용 Modal 과 같은 규칙
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 파일 목록이 오면 첫 파일 자동 선택 — 우측 diff 가 비어 보이지 않게 (Superset 동일)
  const files = ch.files;
  const { selected, selectFile } = ch;
  useEffect(() => {
    if (files && files.length > 0 && !selected) selectFile(files[0]);
  }, [files, selected, selectFile]);

  // ── 드래그 리사이즈 (터미널 패널 grip 과 같은 규칙: 포인터 캡처 + 놓는 순간 1회 저장) ──
  const [sideWidth, setSideWidth] = useState(savedSide);
  const [ratio, setRatio] = useState(savedRatio); // 좌(변경 전) 비율 %
  const sideRef = useRef(sideWidth);
  const ratioRef = useRef(ratio);
  const diffWrapRef = useRef<HTMLDivElement>(null);

  /** 공통 드래그 — move 에서 값 갱신, up 에서 localStorage 1회 저장 */
  const startDrag = (
    e: ReactPointerEvent<HTMLDivElement>,
    onMove: (ev: PointerEvent) => void,
    onEnd: () => void
  ) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const up = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onEnd();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', up);
  };

  const onSideGrip = (e: ReactPointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startW = sideRef.current;
    startDrag(
      e,
      (ev) => {
        const w = Math.round(Math.min(SIDE_MAX, Math.max(SIDE_MIN, startW + ev.clientX - startX)));
        sideRef.current = w;
        setSideWidth(w);
      },
      () => localStorage.setItem('changes:sideWidth', String(sideRef.current))
    );
  };

  const onSplitGrip = (e: ReactPointerEvent<HTMLDivElement>) => {
    startDrag(
      e,
      (ev) => {
        const box = diffWrapRef.current?.getBoundingClientRect();
        if (!box || box.width === 0) return;
        const pct = Math.round(
          Math.min(RATIO_MAX, Math.max(RATIO_MIN, ((ev.clientX - box.left) / box.width) * 100))
        );
        ratioRef.current = pct;
        setRatio(pct);
      },
      () => localStorage.setItem('changes:splitRatio', String(ratioRef.current))
    );
  };

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
    const s = ch.status;
    if (!s) return;
    const ok = await confirm({
      title: '원격으로 푸시',
      message: s.upstream
        ? `${s.branch} → ${s.upstream} 로 커밋 ${s.unpushed?.length ?? 0}개를 푸시합니다.`
        : `'${s.branch}' 는 원격에 없는 새 브랜치입니다 — origin 에 브랜치를 만들며 푸시합니다.`,
      confirmLabel: '푸시',
    });
    if (!ok) return;
    const r = await ch.push();
    if (r.ok) toast('푸시 완료');
    else toast(`푸시 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
  };

  const status = ch.status;
  const canPush = status?.upstream ? (status.ahead ?? 0) > 0 : !!status?.branch;

  return createPortal(
    <div className="changes-full" role="dialog" aria-modal="true" aria-label="변경사항 전체 화면">
      <header className="changes-full__head">
        <Icon name="git-branch" size={14} />
        <span className="changes-full__branch" title={status?.upstream}>
          {status?.branch ?? ''}
        </span>
        {status && (status.behind ?? 0) > 0 && (
          <span className="changes__ab changes__ab--behind">↓{status.behind}</span>
        )}
        {(status?.baseBranch || ch.mode === 'branch') && (
          <Segment
            options={[
              { value: 'work', label: '변경' },
              { value: 'branch', label: `${status?.baseBranch ?? 'main'} 대비` },
            ]}
            value={ch.mode}
            onChange={ch.setMode}
          />
        )}
        <span className="changes__spacer" />
        <div className="changes__actions">
          <RefreshButton onClick={() => void ch.refresh()} />
          <Tooltip
            label={canPush ? `커밋 ${status?.ahead ?? ''}개 푸시` : '푸시할 커밋이 없습니다'}
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
              {status && (status.ahead ?? 0) > 0 && status.ahead}
            </Button>
          </Tooltip>
          <Tooltip label="닫기 (Esc)">
            <button
              type="button"
              className="icon-btn"
              aria-label="전체 화면 닫기"
              onClick={onClose}
            >
              <Icon name="x" size={15} />
            </button>
          </Tooltip>
        </div>
      </header>

      <div className="changes-full__body">
        <aside className="changes-full__side" style={{ width: sideWidth }}>
          {!status ? (
            <div className="changes--center">
              <span className="spinner" />
            </div>
          ) : !status.repo ? (
            <EmptyState icon="folder" message="git 저장소가 아닙니다" />
          ) : !status.ok ? (
            <EmptyState icon="alert-triangle" message="상태 조회 실패" hint={status.error} />
          ) : (
            <>
              {ch.mode === 'work' && !ch.commitSel && (status.files?.length ?? 0) > 0 && (
                <div className="changes__commitbox">
                  <Textarea
                    rows={3}
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

              {ch.commitSel && (
                <div className="changes__mode-commit">
                  <Icon name="git-commit" size={12} />
                  <code>{ch.commitSel.hash}</code> 커밋을 보는 중
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="커밋 보기 해제"
                    onClick={() => ch.selectCommit(null)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              )}

              <div className="changes-full__files">
                {files === null ? (
                  <span className="spinner" />
                ) : files.length === 0 ? (
                  <EmptyState icon="check" message="변경사항이 없습니다" />
                ) : (
                  <FileTree
                    files={files}
                    selectedPath={ch.selected?.path}
                    onSelect={(f) => ch.selectFile(f)}
                  />
                )}
              </div>

              {ch.log.length > 0 && (
                <Collapsible
                  title={`커밋 ${ch.log.length}`}
                  icon={<Icon name="git-commit" size={14} />}
                  storageKey="changes:logOpenFull"
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
                        onClick={() =>
                          ch.selectCommit(ch.commitSel?.hash === c.hash ? null : c)
                        }
                      >
                        <span
                          className={`changes__log-dot${
                            c.unpushed ? ' changes__log-dot--unpushed' : ''
                          }`}
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
            </>
          )}
        </aside>

        <div
          className="changes-full__grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="파일 목록 너비 조절"
          tabIndex={0}
          onPointerDown={onSideGrip}
        />

        <main className="changes-full__main">
          {ch.selected ? (
            <>
              <div className="changes-full__file-head">
                <span className={`changes__kind changes__kind--${ch.selected.kind}`}>
                  {KIND_CHAR[ch.selected.kind]}
                </span>
                <span className="changes-full__file-path" title={ch.selected.path}>
                  {ch.selected.origPath
                    ? `${ch.selected.origPath} → ${ch.selected.path}`
                    : ch.selected.path}
                </span>
                {(ch.selected.additions ?? ch.selected.deletions) !== undefined && (
                  <span className="changes__counts">
                    +{ch.selected.additions ?? 0} −{ch.selected.deletions ?? 0}
                  </span>
                )}
              </div>
              <div className="changes-full__diffwrap" ref={diffWrapRef}>
                <div className="changes-full__diff">
                  {!ch.diff && <span className="spinner" />}
                  {ch.diff && !ch.diff.ok && (
                    <EmptyState
                      icon="alert-triangle"
                      message="diff 실패"
                      hint={ch.diff.error}
                    />
                  )}
                  {ch.diff?.ok && ch.diff.binary && (
                    <EmptyState
                      icon="info"
                      message="바이너리 파일"
                      hint="diff 를 표시할 수 없습니다."
                    />
                  )}
                  {ch.diff?.ok && !ch.diff.binary && (
                    <>
                      {/* key=파일 경로 — 파일 전환 시 '더 보기' 상한 리셋 (같은 파일 갱신은 유지) */}
                      <SplitDiff
                        key={ch.selected.path}
                        diff={ch.diff.diff ?? ''}
                        leftRatio={ratio}
                      />
                      {ch.diff.truncated && (
                        <p className="sdiff__empty">… (너무 길어 잘렸습니다)</p>
                      )}
                    </>
                  )}
                </div>
                {/* 변경 전/후 비율 손잡이 — diff 위에 떠 있어 스크롤과 무관하게 제자리 */}
                {ch.diff?.ok && !ch.diff.binary && (
                  <div
                    className="changes-full__split-grip"
                    style={{ left: `${ratio}%` }}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="변경 전/후 영역 너비 조절"
                    tabIndex={0}
                    onPointerDown={onSplitGrip}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="changes--center">
              <EmptyState icon="folder-git" message="파일을 선택하세요" />
            </div>
          )}
        </main>
      </div>
    </div>,
    document.body
  );
}
