// 새 워크스페이스 모달 — git 저장소 폴더를 골라 터미널 전용 워크스페이스로 등록한다.
// (프로젝트 레지스트리와 별개 목록 — main 이 저장 전에 git 저장소인지 검증한다)
import { useState } from 'react';
import type { TerminalWorkspace } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';

export function NewWorkspaceModal({
  onCreated,
  onClose,
}: {
  /** 저장 성공 — 방금 등록된 워크스페이스를 넘긴다 (호출부가 펼침 + 선택) */
  onCreated: (ws: TerminalWorkspace) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const pick = async () => {
    const { path } = await window.oneApp.workspaces.pickDir('저장소 루트 폴더 선택');
    if (!path) return;
    setRepoPath(path);
    // 이름을 손대지 않았으면 폴더명으로 채운다
    setName((cur) => cur.trim() || path.split('/').filter(Boolean).pop() || '');
  };

  const save = async () => {
    setSaving(true);
    try {
      const list = await window.oneApp.workspaces.save({ name, repoPath });
      // main 이 경로를 정규화하므로 원문 일치 → 못 찾으면 방금 추가된 마지막 항목
      const ws = list.find((w) => w.repoPath === repoPath) ?? list[list.length - 1];
      if (ws) onCreated(ws);
      onClose();
    } catch (err) {
      toast(`워크스페이스 추가 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="새 워크스페이스" onClose={onClose}>
      <div className="terminal-new">
        <FormRow label="저장소" column>
          <div className="terminal-new__pick">
            <Button size="sm" variant="ghost" onClick={() => void pick()}>
              폴더 선택
            </Button>
            <code className="terminal-new__path" title={repoPath}>
              {repoPath || 'git 저장소 루트 폴더를 선택하세요'}
            </code>
          </div>
        </FormRow>
        <FormRow label="이름" column>
          <Input
            aria-label="워크스페이스 이름"
            value={name}
            placeholder="표시 이름 (기본: 폴더명)"
            onChange={(e) => setName(e.target.value)}
          />
        </FormRow>
        <div className="form-actions">
          <Button loading={saving} disabled={!repoPath} onClick={() => void save()}>
            추가
          </Button>
        </div>
      </div>
    </Modal>
  );
}
