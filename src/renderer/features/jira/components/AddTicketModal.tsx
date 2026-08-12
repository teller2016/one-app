// 티켓 추가 — 담당으로 안 날아온 이슈를 주소·번호로 내 목록에 끌어온다.
//
// 저장 전에 Jira 에서 실제로 찾아보고(존재·권한) 제목까지 보여준 뒤 확정한다 —
// 잘못된 키를 넣으면 목록에 조용히 안 나오는 게 아니라 그 자리에서 알 수 있어야 한다.
import { useState } from 'react';
import type { JiraValidateResult } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Modal } from '../../../components/Modal';
import { useToast } from '../../../components/Toast';

export function AddTicketModal({
  onAdded,
  onClose,
}: {
  /** 추가 성공 — 목록 새로고침은 부모가 한다 */
  onAdded: (key: string) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [input, setInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [found, setFound] = useState<JiraValidateResult | null>(null);
  const [error, setError] = useState('');

  // 입력이 바뀌면 이전 확인 결과는 무효 — 확정 버튼이 낡은 티켓을 추가하지 않게
  const changeInput = (v: string) => {
    setInput(v);
    setFound(null);
    setError('');
  };

  const check = async () => {
    const value = input.trim();
    if (!value) return;
    setChecking(true);
    setError('');
    try {
      const res = await window.oneApp.jira.added.validate(value);
      if (res.ok) setFound(res);
      else setError(res.error ?? '티켓을 찾지 못했습니다.');
    } finally {
      setChecking(false);
    }
  };

  const add = async () => {
    if (!found?.key) return;
    setAdding(true);
    try {
      const res = await window.oneApp.jira.added.add(found.key);
      if (!res.ok) {
        setError(res.error ?? '추가하지 못했습니다.');
        return;
      }
      toast(`${found.key} 를 목록에 추가했습니다`);
      onAdded(found.key);
      onClose();
    } finally {
      setAdding(false);
    }
  };

  // Enter 한 번으로 확인 → 확인된 상태면 추가까지
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (found) void add();
    else void check();
  };

  return (
    <Modal title="티켓 추가" onClose={onClose}>
      <div className="jira-add">
        <FormRow label="Jira 주소 또는 티켓 번호" column>
          <Input
            autoFocus // 모달이 뜨자마자 붙여넣을 수 있게
            value={input}
            placeholder="https://…/browse/BBJ-1234"
            onChange={(e) => changeInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
        </FormRow>

        {error && <Banner variant="danger">{error}</Banner>}

        {found && (
          <div className="jira-add__found">
            <div className="jira-add__found-head">
              <Icon name="check" size={14} className="jira-add__found-icon" />
              <span className="jira-add__found-key">{found.key}</span>
              <span className="jira-add__found-title">{found.summary}</span>
            </div>
            <div className="jira-add__found-meta">
              {[found.issueType, found.status, found.reporter && `보고자 ${found.reporter}`]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {found.already && (
              <p className="hint">이미 추가된 티켓입니다 — 추가해도 중복되지 않습니다.</p>
            )}
          </div>
        )}

        <div className="form-actions">
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          {found ? (
            <Button loading={adding} onClick={() => void add()}>
              추가
            </Button>
          ) : (
            <Button loading={checking} disabled={!input.trim()} onClick={() => void check()}>
              확인
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
