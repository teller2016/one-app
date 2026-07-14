import { useEffect, useState } from 'react';
import type { DeployCommit } from '../../../../shared/types';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Input } from '../../../components/Input';
import { Textarea } from '../../../components/Textarea';
import { FormRow } from '../../../components/FormRow';

/** 브랜치명에서 Jira 이슈 키 추출 — 예: bugfix/BBJ-2924 → BBJ-2924 */
const issueKeyOf = (branch: string) =>
  branch.match(/[A-Z][A-Z0-9]{1,9}[-_]\d+/)?.[0]?.replace('_', '-') ?? null;

/**
 * PR 생성 모달 — develop 대비 커밋을 보여주고 제목/본문을 자동 채운 뒤 생성한다.
 * (push 해둔 브랜치 → develop 흐름 전용)
 */
export function CreatePrModal({
  repo,
  head,
  onClose,
  onCreated,
}: {
  repo: string;
  head: string;
  onClose: () => void;
  /** 생성 성공 — 번호를 넘겨 머지 모달로 이어간다 */
  onCreated: (number: number, title: string) => void;
}) {
  const base = 'develop';
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [commits, setCommits] = useState<DeployCommit[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // develop 대비 커밋 로드 → 제목/본문 자동 생성 (편집 가능)
  useEffect(() => {
    let alive = true;
    window.oneApp.prs.getBranchCommits(repo, base, head).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setLoadError(res.error ?? '커밋 조회 실패');
        setCommits([]);
        return;
      }
      const list = res.commits ?? [];
      setCommits(list);
      const key = issueKeyOf(head);
      const firstTitle = list[0]?.message.split('\n')[0] ?? head;
      setTitle(`${key ? `[${key}] ` : ''}${firstTitle}`.slice(0, 100));
      setBody(list.map((c) => `- ${c.message.split('\n')[0]}`).join('\n'));
    });
    return () => {
      alive = false;
    };
  }, [repo, head]);

  const create = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setCreateError('');
    const res = await window.oneApp.prs.create({
      repo,
      head,
      base,
      title: title.trim(),
      body,
    });
    setCreating(false);
    if (!res.ok || res.number == null) {
      setCreateError(res.error ?? 'PR 생성에 실패했습니다.');
      return;
    }
    onCreated(res.number, title.trim());
  };

  return (
    <Modal title={`PR 생성 — ${repo.split('/').pop()}`} onClose={onClose}>
      <p className="prs__create-route">
        <code>{head}</code> → <code>{base}</code>
      </p>

      {commits === null ? (
        <p className="hint">develop 대비 커밋을 확인하는 중...</p>
      ) : loadError ? (
        <Banner variant="danger">{loadError}</Banner>
      ) : commits.length === 0 ? (
        <Banner>
          <b>develop 과 커밋 차이가 없습니다</b> — push 를 먼저 했는지 확인하세요.
        </Banner>
      ) : (
        <p className="hint prs__create-count">포함될 커밋 {commits.length}개</p>
      )}

      <FormRow label="제목">
        <Input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={creating}
        />
      </FormRow>
      <FormRow column label="본문">
        <Textarea
          code
          className="prs__create-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={creating}
        />
      </FormRow>

      {createError && <Banner variant="danger">{createError}</Banner>}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void create()}
          loading={creating}
          disabled={!title.trim() || commits === null || commits.length === 0}
        >
          PR 생성
        </Button>
        <Button onClick={onClose} disabled={creating}>
          취소
        </Button>
      </div>
    </Modal>
  );
}
