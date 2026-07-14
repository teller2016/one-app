import { useEffect, useState } from 'react';
import type { PrMergeMethod } from '../../../../shared/types';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Segment } from '../../../components/Segment';

const METHOD_OPTIONS: { value: PrMergeMethod; label: string }[] = [
  { value: 'merge', label: 'Merge' },
  { value: 'squash', label: 'Squash' },
  { value: 'rebase', label: 'Rebase' },
];

/** PR 머지 모달 — 컨플릭트 여부(mergeable)를 확인한 뒤 방식 선택 후 머지 */
export function MergeModal({
  repo,
  number,
  title,
  onClose,
  onMerged,
}: {
  repo: string;
  number: number;
  title: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [mergeable, setMergeable] = useState<boolean | null>(null);
  const [infoError, setInfoError] = useState('');
  const [method, setMethod] = useState<PrMergeMethod>('merge');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');

  useEffect(() => {
    let alive = true;
    window.oneApp.prs.getMergeInfo(repo, number).then((res) => {
      if (!alive) return;
      if (!res.ok) setInfoError(res.error ?? '상태 확인 실패');
      else setMergeable(!!res.mergeable);
    });
    return () => {
      alive = false;
    };
  }, [repo, number]);

  const merge = async () => {
    setMerging(true);
    setMergeError('');
    const res = await window.oneApp.prs.merge(repo, number, method);
    setMerging(false);
    if (!res.ok) {
      setMergeError(res.error ?? '머지에 실패했습니다.');
      return;
    }
    onMerged();
  };

  return (
    <Modal title={`머지 — ${repo.split('/').pop()} #${number}`} onClose={onClose}>
      <p className="prs__merge-title">{title}</p>

      {mergeable === null && !infoError && (
        <p className="hint">머지 가능 여부를 확인하는 중...</p>
      )}
      {infoError && <Banner variant="danger">{infoError}</Banner>}
      {mergeable === false && (
        <Banner variant="danger">
          <b>머지할 수 없습니다</b> — 컨플릭트 또는 보호 규칙을 확인하세요.
        </Banner>
      )}
      {mergeable === true && (
        <Banner variant="info">컨플릭트 없음 — 머지할 수 있습니다.</Banner>
      )}

      <div className="prs__merge-method">
        <span className="form-label">머지 방식</span>
        <Segment<PrMergeMethod>
          options={METHOD_OPTIONS}
          value={method}
          onChange={setMethod}
          disabled={merging}
        />
      </div>

      {mergeError && <Banner variant="danger">{mergeError}</Banner>}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void merge()}
          loading={merging}
          disabled={mergeable !== true}
        >
          머지
        </Button>
        <Button onClick={onClose} disabled={merging}>
          취소
        </Button>
      </div>
    </Modal>
  );
}
