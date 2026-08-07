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
import { rel } from '../lib/relTime';

/** 브랜치명에서 Jira 이슈 키 추출 — 예: bugfix/BBJ-2924 → BBJ-2924 */
const issueKeyOf = (branch: string) =>
  branch.match(/[A-Z][A-Z0-9]{1,9}[-_]\d+/)?.[0]?.replace('_', '-') ?? null;

/** 한 번에 렌더할 최대 옵션 수 — 저장소당 브랜치가 수백 개다 (초과분은 검색으로) */
const OPTION_LIMIT = 50;

/** 생성 성공 결과 — 부모가 목록 갱신 전에 상세를 먼저 띄울 수 있게 방향까지 넘긴다 */
export type CreatedPr = {
  repo: string;
  number: number;
  title: string;
  head: string;
  base: string;
  url?: string;
};

/**
 * 새 PR 모달 — 저장소는 보고 있던 탭으로 고정(저장소별 완전 분리), 원본(head)·대상(base)
 * 브랜치를 고르고 그 사이 커밋을 보여주고 제목/본문을 자동 채운 뒤 생성한다.
 * 브랜치 셀렉트는 둘 다 검색형(전체 브랜치 대상).
 */
export function CreatePrModal({
  repo,
  repoName,
  projectDefault,
  recentBase,
  onClose,
  onCreated,
}: {
  /** 대상 저장소 "owner/repo" — 현재 저장소 탭 (모달에서 바꿀 수 없다) */
  repo: string;
  /** 프로젝트 표시명 — 모달 제목용 */
  repoName: string;
  /** 프로젝트 defaultBranch (빈 값은 develop 폴백) — 초기 대상·타이핑 확인 기준 */
  projectDefault: string;
  /** 이 저장소에서 마지막으로 고른 base (MRU) — 초기 대상 선택값 */
  recentBase?: string;
  onClose: () => void;
  onCreated: (created: CreatedPr) => void;
}) {
  const [recent, setRecent] = useState<PrBranch[] | null>(null); // 최근 push 브랜치 (head 후보 상단)
  const [branchError, setBranchError] = useState('');
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
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

  const effectiveDefault = projectDefault || 'develop';
  const mruBase = recentBase || '';

  // 진입 시 브랜치 후보 3종(최근 push · 주요 · 전체) 로드
  useEffect(() => {
    if (!repo) return;
    let alive = true;
    setRecent(null);
    setBranchError('');
    setCandidates(null);
    setAllNames([]);
    setCommits(null);
    setTyped('');
    setHead('');
    setBase(mruBase || effectiveDefault);
    void window.oneApp.prs.getBranches(repo).then((res) => {
      if (!alive) return;
      const list = res.ok ? res.branches ?? [] : [];
      setRecent(list);
      setBranchError(res.ok ? '' : res.error ?? '브랜치 조회 실패');
      setHead(list[0]?.name ?? '');
    });
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
    // deps 는 repo 만 — mruBase·effectiveDefault 는 모달이 열려 있는 동안 불변
  }, [repo]);

  // base 대비 head 커밋 로드 → 제목/본문 자동 생성 (저장소·브랜치 변경 시 재조회)
  useEffect(() => {
    if (!repo || !head || !base) return;
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
    const recentList = recent ?? [];
    const recentAt = new Map(recentList.map((b) => [b.name, b.committedAt]));
    const names = [
      ...recentList.map((b) => b.name),
      ...allNames.filter((n) => !recentAt.has(n)),
    ];
    if (head && !names.includes(head)) names.unshift(head);
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
  }, [recent, allNames, head, base]);

  // 대상(base) 후보 — 주요 브랜치를 상단에 정렬하고 나머지 전체를 뒤에 붙인다. head 는 제외
  const baseOptions = useMemo(() => {
    const known = new Map<string, PrBaseBranch>(
      (candidates ?? []).map((b) => [b.name, b]),
    );
    for (const name of allNames) if (!known.has(name)) known.set(name, { name });
    if (base && !known.has(base)) known.set(base, { name: base });
    return sortBaseOptions([...known.values()], {
      projectDefault: effectiveDefault,
      recent: mruBase,
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
  }, [candidates, allNames, base, head, effectiveDefault, mruBase]);

  const selected = (candidates ?? []).find((b) => b.name === base);
  const mustConfirm = needsBaseConfirm(base, effectiveDefault, selected);
  const confirmOk = !mustConfirm || typed.trim() === base;
  const noHead = recent !== null && !head; // push 된 브랜치가 없는 저장소

  const create = async () => {
    if (!title.trim() || !confirmOk || !head) return;
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
    onCreated({
      repo,
      number: res.number,
      title: title.trim(),
      head,
      base,
      url: res.url,
    });
  };

  return (
    <Modal wide title={`새 PR — ${repoName}`} onClose={onClose}>
      {/* 원본 → 대상 한 줄. 두 셀렉트 모두 팝오버에서 바로 검색된다 (저장소는 탭에서 확정) */}
      <div className="prs__route">
        <FormRow label="원본">
          <Select
            searchable
            limit={OPTION_LIMIT}
            className="prs__branch-pick"
            aria-label="원본 브랜치 선택"
            searchPlaceholder="브랜치 검색"
            disabled={creating || recent === null}
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

      {branchError && <Banner variant="danger">{branchError}</Banner>}

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

      {recent === null ? (
        <p className="hint">브랜치를 확인하는 중...</p>
      ) : noHead ? (
        <Banner>
          <b>PR 가능한 브랜치가 없습니다</b> — push 를 먼저 했는지 확인하세요.
        </Banner>
      ) : commits === null ? (
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
                <li key={f.path} className={`prs__file prs__file--${f.status}`}>
                  <span className="prs__file-status">
                    {f.status === 'added' ? 'A' : f.status === 'removed' || f.status === 'deleted' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                  </span>
                  <span className="prs__file-path">{f.path}</span>
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
            !title.trim() ||
            !head ||
            commits === null ||
            commits.length === 0 ||
            !confirmOk
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
