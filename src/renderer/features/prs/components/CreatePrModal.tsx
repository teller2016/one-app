import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DeployCommit,
  PrBaseBranch,
  PrBranch,
  PrChangedFile,
} from '../../../../shared/types';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { Textarea } from '../../../components/Textarea';
import { FormRow } from '../../../components/FormRow';
import { baseTagOf, needsBaseConfirm, sortBaseOptions } from '../lib/baseBranches';

/** 브랜치명에서 Jira 이슈 키 추출 — 예: bugfix/BBJ-2924 → BBJ-2924 */
const issueKeyOf = (branch: string) =>
  branch.match(/[A-Z][A-Z0-9]{1,9}[-_]\d+/)?.[0]?.replace('_', '-') ?? null;

/** "5분 전" 형태 상대 시간 */
const rel = (ts?: number) => {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

/** 한 번에 렌더할 최대 옵션 수 — 저장소당 브랜치가 수백 개다 (초과분은 검색으로) */
const OPTION_LIMIT = 50;

/**
 * PR 생성 모달 — 원본(head)·대상(base) 브랜치를 고르고, 그 사이 커밋을 보여주고
 * 제목/본문을 자동 채운 뒤 생성한다. 두 셀렉트 모두 검색형(전체 브랜치 대상).
 */
export function CreatePrModal({
  repo,
  head: initialHead,
  base: initialBase,
  recentBranches,
  projectDefault,
  onClose,
  onCreated,
}: {
  repo: string;
  /** 초기 원본 브랜치 — 가장 최근 push 된 브랜치 */
  head: string;
  /** 초기 대상 브랜치 — 최근 사용값(MRU) 또는 프로젝트 기본 브랜치 */
  base: string;
  /** 최근 push 브랜치 (목록에서 이미 조회한 것 — head 후보 상단) */
  recentBranches: PrBranch[];
  /** 프로젝트 레지스트리에 설정된 기본 브랜치 — 정렬 1순위이자 타이핑 확인 면제 기준 */
  projectDefault?: string;
  onClose: () => void;
  /** 생성 성공 — 번호를 넘겨 머지 모달로 이어가고, 고른 base 를 기억한다 */
  onCreated: (number: number, title: string, base: string) => void;
}) {
  const [head, setHead] = useState(initialHead);
  const [base, setBase] = useState(initialBase);
  const [candidates, setCandidates] = useState<PrBaseBranch[] | null>(null);
  const [allNames, setAllNames] = useState<string[]>([]); // 검색용 전체 목록
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [typed, setTyped] = useState(''); // 주요 브랜치 base 확인용 타이핑
  const [commits, setCommits] = useState<DeployCommit[] | null>(null);
  const [files, setFiles] = useState<PrChangedFile[]>([]);
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // 사용자가 손댄 제목·본문은 브랜치를 바꿔도 덮어쓰지 않는다
  const titleDirty = useRef(false);
  const bodyDirty = useRef(false);

  // base 후보(주요 브랜치) + 검색용 전체 목록을 함께 로드 — 열자마자 검색 가능하게
  useEffect(() => {
    let alive = true;
    void window.oneApp.prs.getBaseBranches(repo).then((res) => {
      // 후보 조회가 실패해도 PR 생성은 막지 않는다 (초기 base 로 진행)
      if (alive) setCandidates(res.ok ? res.branches ?? [] : []);
    });
    void window.oneApp.prs.getAllBranches(repo).then((res) => {
      if (alive && res.ok) setAllNames(res.names ?? []);
    });
    return () => {
      alive = false;
    };
  }, [repo]);

  // base 대비 head 커밋 로드 → 제목/본문 자동 생성 (브랜치 변경 시 재조회)
  useEffect(() => {
    let alive = true;
    setCommits(null);
    setLoadError('');
    window.oneApp.prs.getBranchCommits(repo, base, head).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setLoadError(res.error ?? '커밋 조회 실패');
        setCommits([]);
        return;
      }
      const list = res.commits ?? [];
      setCommits(list);
      setFiles(res.files ?? []);
      setStats(res.stats ?? null);
      const key = issueKeyOf(head);
      const firstTitle = list[0]?.message.split('\n')[0] ?? head;
      if (!titleDirty.current)
        setTitle(`${key ? `[${key}] ` : ''}${firstTitle}`.slice(0, 100));
      if (!bodyDirty.current)
        setBody(list.map((c) => `- ${c.message.split('\n')[0]}`).join('\n'));
    });
    return () => {
      alive = false;
    };
  }, [repo, head, base]);

  // 원본(head) 후보 — 최근 push 8개를 위로, 나머지 전체 브랜치는 이름순. base 는 제외
  const headOptions = useMemo(() => {
    const recentAt = new Map(recentBranches.map((b) => [b.name, b.committedAt]));
    const names = [
      ...recentBranches.map((b) => b.name),
      ...allNames.filter((n) => !recentAt.has(n)),
    ];
    if (!names.includes(head)) names.unshift(head);
    return names
      .filter((n) => n !== base)
      .map((name) => ({
        value: name,
        search: name,
        label: (
          <span className="prs__base-option">
            <span className="prs__base-name">{name}</span>
            {recentAt.get(name) != null && (
              <span className="prs__base-when">{rel(recentAt.get(name))}</span>
            )}
          </span>
        ),
      }));
  }, [recentBranches, allNames, head, base]);

  // 대상(base) 후보 — 주요 브랜치를 상단에 정렬하고 나머지 전체를 뒤에 붙인다. head 는 제외
  const baseOptions = useMemo(() => {
    const known = new Map<string, PrBaseBranch>(
      (candidates ?? []).map((b) => [b.name, b]),
    );
    for (const name of allNames) if (!known.has(name)) known.set(name, { name });
    if (!known.has(base)) known.set(base, { name: base });
    return sortBaseOptions([...known.values()], {
      projectDefault,
      recent: initialBase,
    })
      .filter((b) => b.name !== head)
      .map((b) => {
        const tag = baseTagOf(b);
        return {
          value: b.name,
          search: b.name,
          label: (
            <span className="prs__base-option">
              <span className="prs__base-name">{b.name}</span>
              {tag && <span className="prs__base-tag">{tag}</span>}
            </span>
          ),
        };
      });
  }, [candidates, allNames, base, head, projectDefault, initialBase]);

  const selected = (candidates ?? []).find((b) => b.name === base);
  const mustConfirm = needsBaseConfirm(base, projectDefault, selected);
  const confirmOk = !mustConfirm || typed.trim() === base;

  const create = async () => {
    if (!title.trim() || !confirmOk) return;
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
    onCreated(res.number, title.trim(), base);
  };

  return (
    <Modal wide title={`PR 생성 — ${repo.split('/').pop()}`} onClose={onClose}>
      {/* 원본 → 대상 한 줄. 두 셀렉트 모두 팝오버에서 바로 검색된다 */}
      <div className="prs__route">
        <FormRow label="원본">
          <Select
            searchable
            limit={OPTION_LIMIT}
            className="prs__branch-pick"
            aria-label="원본 브랜치 선택"
            searchPlaceholder="브랜치 검색"
            disabled={creating}
            value={head}
            onChange={setHead}
            options={headOptions}
          />
        </FormRow>
        <span className="prs__route-arrow" aria-hidden="true">
          <Icon name="arrow-right" size={14} />
        </span>
        <FormRow label="대상">
          <Select
            searchable
            limit={OPTION_LIMIT}
            className="prs__branch-pick"
            aria-label="대상 브랜치 선택"
            searchPlaceholder="브랜치 검색"
            disabled={creating}
            value={base}
            onChange={(value) => {
              setBase(value);
              setTyped('');
            }}
            options={baseOptions}
          />
        </FormRow>
      </div>

      {/* 주요 브랜치(main 등)로 PR 을 만들 때는 브랜치명 타이핑 확인 — 오PR 방지.
          커밋 목록이 길어도 눈에 들어오도록 브랜치 선택 바로 아래에 둔다 */}
      {mustConfirm && (
        <div className="prs__base-confirm">
          <Banner variant="warning">
            프로젝트 기본 브랜치가 아닌 <b>{base}</b> 로 PR 을 만듭니다.
          </Banner>
          <label className="form-label">
            확인을 위해 브랜치명(<code>{base}</code>)을 입력하세요
          </label>
          <Input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={base}
            disabled={creating}
          />
        </div>
      )}

      {commits === null ? (
        <p className="hint">{base} 대비 커밋을 확인하는 중...</p>
      ) : loadError ? (
        <Banner variant="danger">{loadError}</Banner>
      ) : commits.length === 0 ? (
        <Banner>
          <b>{base} 와 커밋 차이가 없습니다</b> — push 를 먼저 했는지, 브랜치가 맞는지
          확인하세요.
        </Banner>
      ) : (
        <>
          <p className="hint prs__create-count">
            포함될 커밋 {commits.length}개 · 변경 파일 {files.length}개
            {stats && (
              <>
                {' · '}
                <span className="prs__stat-add">+{stats.additions}</span>{' '}
                <span className="prs__stat-del">−{stats.deletions}</span>
              </>
            )}
          </p>
          {files.length > 0 && (
            <ul className="prs__create-files">
              {files.map((f) => (
                <li key={f.path} className={`prs__create-file prs__create-file--${f.status}`}>
                  <span className="prs__create-file-status">
                    {f.status === 'added' ? 'A' : f.status === 'removed' || f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                  </span>
                  <span className="prs__create-file-path">{f.path}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <FormRow label="제목">
        <Input
          type="text"
          value={title}
          onChange={(e) => {
            titleDirty.current = true;
            setTitle(e.target.value);
          }}
          disabled={creating}
        />
      </FormRow>
      <FormRow column label="본문">
        <Textarea
          code
          className="prs__create-body"
          value={body}
          onChange={(e) => {
            bodyDirty.current = true;
            setBody(e.target.value);
          }}
          disabled={creating}
        />
      </FormRow>

      {createError && <Banner variant="danger">{createError}</Banner>}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void create()}
          loading={creating}
          disabled={
            !title.trim() || commits === null || commits.length === 0 || !confirmOk
          }
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
