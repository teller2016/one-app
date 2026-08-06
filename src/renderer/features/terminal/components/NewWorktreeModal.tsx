// 새 워크트리 모달 — 새 브랜치(-b) 또는 기존 브랜치를 원하는 폴더에 체크아웃한다.
// 위치는 매번 직접 선택(부모 폴더 + 폴더명) — 관리 폴더 강제 없음(사용자 결정 2026-08-06).
import { useEffect, useMemo, useState } from 'react';
import type { TerminalWorkspace, WorkspaceBranches } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { Segment } from '../../../components/Segment';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';

type BranchMode = 'new' | 'existing';

/** 브랜치명을 폴더명 기본값으로 — 경로 구분자만 대시로 (feature/BBJ-1 → feature-BBJ-1) */
const dirNameFrom = (branch: string) =>
  branch.trim().replace(/[/\\]+/g, '-').replace(/^-+|-+$/g, '');

export function NewWorktreeModal({
  workspace,
  onCreated,
  onClose,
}: {
  workspace: TerminalWorkspace;
  /** 생성 성공 — 새 워크트리 경로를 넘긴다 (호출부가 목록 갱신 + 선택) */
  onCreated: (path: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [branches, setBranches] = useState<WorkspaceBranches | null>(null);
  const [mode, setMode] = useState<BranchMode>('new');
  const [branch, setBranch] = useState(''); // new: 새 브랜치명 · existing: 선택한 로컬 브랜치
  const [baseRef, setBaseRef] = useState('');
  const [parentDir, setParentDir] = useState('');
  const [dirName, setDirName] = useState('');
  const [dirTouched, setDirTouched] = useState(false); // 사용자가 폴더명을 손댔으면 자동 채움 중단
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void window.oneApp.workspaces.branches(workspace.id).then((b) => {
      setBranches(b);
      const cur = b.ok ? b.current : undefined;
      if (cur) setBaseRef((prev) => prev || cur);
    });
  }, [workspace.id]);

  // 베이스 후보 = 로컬 + 원격 (원격은 `origin/…` 그대로 — 최신 원격 기준 분기용)
  const baseOptions = useMemo(() => {
    if (!branches?.ok) return [];
    return [
      ...branches.locals.map((n) => ({ value: n, label: n, search: n })),
      ...branches.remotes.map((n) => ({ value: n, label: n, search: n })),
    ];
  }, [branches]);

  // 기존 브랜치 체크아웃은 로컬만 — 원격 브랜치는 '새 브랜치'로 받아야 추적이 명확하다
  const localOptions = useMemo(
    () =>
      branches?.ok
        ? branches.locals.map((n) => ({ value: n, label: n, search: n }))
        : [],
    [branches]
  );

  const pickDir = async () => {
    const res = await window.oneApp.workspaces.pickDir('워크트리를 만들 위치 선택');
    if (res.path) setParentDir(res.path);
  };

  const setBranchAndDir = (value: string) => {
    setBranch(value);
    if (!dirTouched) setDirName(dirNameFrom(value));
  };

  const create = async () => {
    setCreating(true);
    try {
      const r = await window.oneApp.workspaces.addWorktree({
        workspaceId: workspace.id,
        parentDir,
        dirName,
        branch,
        createBranch: mode === 'new',
        baseRef: mode === 'new' && baseRef ? baseRef : undefined,
      });
      if (r.ok && r.path) {
        onCreated(r.path);
        onClose();
      } else {
        toast(`워크트리 생성 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
      }
    } catch (err) {
      toast(`워크트리 생성 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setCreating(false);
    }
  };

  const ready = !!(branch.trim() && parentDir && dirName.trim());

  return (
    <Modal title={`새 워크트리 — ${workspace.name}`} onClose={onClose}>
      <div className="terminal-new">
        <FormRow label="브랜치" column>
          <Segment<BranchMode>
            options={[
              { value: 'new', label: '새 브랜치' },
              { value: 'existing', label: '기존 브랜치' },
            ]}
            value={mode}
            onChange={(m) => {
              setMode(m);
              setBranch('');
              if (!dirTouched) setDirName('');
            }}
          />
        </FormRow>

        {mode === 'new' ? (
          <>
            <FormRow label="새 브랜치 이름" column>
              <Input
                aria-label="새 브랜치 이름"
                value={branch}
                placeholder="feature/BBJ-0000"
                onChange={(e) => setBranchAndDir(e.target.value)}
              />
            </FormRow>
            <FormRow label="베이스 브랜치" column>
              <Select
                className="terminal-new__select"
                aria-label="베이스 브랜치"
                value={baseRef}
                onChange={setBaseRef}
                options={baseOptions}
                searchable
                limit={50}
                placeholder={branches ? '브랜치 선택' : '불러오는 중…'}
              />
            </FormRow>
          </>
        ) : (
          <FormRow label="체크아웃할 브랜치" column>
            <Select
              className="terminal-new__select"
              aria-label="체크아웃할 브랜치"
              value={branch}
              onChange={setBranchAndDir}
              options={localOptions}
              searchable
              limit={50}
              placeholder={branches ? '브랜치 선택' : '불러오는 중…'}
            />
          </FormRow>
        )}

        <FormRow label="위치" column>
          <div className="terminal-new__pick">
            <Button size="sm" variant="ghost" onClick={() => void pickDir()}>
              폴더 선택
            </Button>
            <code className="terminal-new__path" title={parentDir}>
              {parentDir || '워크트리를 만들 부모 폴더'}
            </code>
          </div>
        </FormRow>
        <FormRow label="폴더 이름" column>
          <Input
            aria-label="워크트리 폴더 이름"
            value={dirName}
            placeholder="브랜치명으로 자동 설정"
            onChange={(e) => {
              setDirTouched(true);
              setDirName(e.target.value);
            }}
          />
        </FormRow>
        {parentDir && dirName.trim() && (
          <p className="hint">
            생성 위치: <code>{parentDir}/{dirName.trim()}</code>
          </p>
        )}

        {branches && !branches.ok && (
          <p className="hint">브랜치 목록 조회 실패: {branches.error}</p>
        )}

        <div className="form-actions">
          <Button loading={creating} disabled={!ready} onClick={() => void create()}>
            생성
          </Button>
        </div>
      </div>
    </Modal>
  );
}
