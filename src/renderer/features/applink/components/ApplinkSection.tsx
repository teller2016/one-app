import { useEffect, useState } from 'react';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { TopbarSlot } from '../../../components/TopbarSlot';
import { useToast } from '../../../components/Toast';
import { useCopy } from '../../../lib/useCopy';
import { errMsg } from '../../../lib/errMsg';

type Made = { url: string; canonicalUrl: string };

/** 공유 정보 접이식의 열림 상태 — 예전 Collapsible storageKey 와 같은 키('1'/'0') */
const OG_OPEN_KEY = 'applink:group:og';

/**
 * 딥링크 — applink.kr 디퍼드 딥링크 생성 (프로젝트 작업용).
 * 대상 URL(+선택 공유 정보)을 넣으면 단축 딥링크를 만들어 복사할 수 있다.
 */
export function ApplinkSection() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [editKey, setEditKey] = useState(false);

  const [canonicalUrl, setCanonicalUrl] = useState('https://boncaremall.com/');
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImageUrl, setOgImageUrl] = useState('');
  const [desktopUrl, setDesktopUrl] = useState('');

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState<Made[]>([]); // 이번 세션에 만든 링크들 (최신 먼저)
  const toast = useToast();

  useEffect(() => {
    window.oneApp.applink.getKeyStatus().then((s) => setHasKey(s.hasKey));
  }, []);

  const saveKey = async () => {
    if (!keyInput.trim()) return;
    const s = await window.oneApp.applink.setKey(keyInput.trim());
    setHasKey(s.hasKey);
    setKeyInput('');
    setEditKey(false);
    toast('API 키가 저장되었습니다');
  };

  const copy = useCopy();

  const create = async () => {
    if (!/^https?:\/\//i.test(canonicalUrl.trim())) {
      setError('대상 URL 을 http(s):// 형태로 입력하세요.');
      return;
    }
    setCreating(true);
    setError('');
    let res: Awaited<ReturnType<typeof window.oneApp.applink.create>>;
    try {
      res = await window.oneApp.applink.create({
        canonicalUrl,
        ogTitle,
        ogDescription,
        ogImageUrl,
        desktopUrl,
      });
    } catch (e) {
      // 예외로 끝나면 creating 이 풀리지 않아 버튼이 로딩에 갇힌다
      setError(errMsg(e, '딥링크 생성에 실패했습니다.'));
      return;
    } finally {
      setCreating(false);
    }
    if (!res.ok || !res.url) {
      setError(res.error ?? '딥링크 생성에 실패했습니다.');
      return;
    }
    setMade((prev) => [{ url: res.url as string, canonicalUrl: canonicalUrl.trim() }, ...prev]);
    copy(res.url); // 만들자마자 클립보드로
  };

  // 공유 정보 접이식 — 목업은 테두리 상자 + 가라앉은 머리(38). 공용 Collapsible(카드 룩)과 모양이 달라
  // 여기서 직접 그린다. 열림 상태는 예전 Collapsible 과 같은 키·형식('1'/'0')을 쓴다(사용자 상태 유지)
  const [ogOpen, setOgOpen] = useState(() => localStorage.getItem(OG_OPEN_KEY) !== '0');
  const toggleOg = () =>
    setOgOpen((v) => {
      localStorage.setItem(OG_OPEN_KEY, v ? '0' : '1');
      return !v;
    });

  // API 키 입력 줄 — 미저장이면 경고 띠와 함께, 변경 모드면 [취소]가 붙는다
  const keyForm = (
    <div className="applink__key-form">
      <span className="applink__key-label">API 키</span>
      <Input
        small
        type="password"
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        placeholder="X-API-KEY"
        aria-label="API 키"
      />
      <Button variant="primary" size="xs" onClick={saveKey} disabled={!keyInput.trim()}>
        저장
      </Button>
      {editKey && (
        <Button
          variant="plain"
          size="xs"
          onClick={() => {
            setEditKey(false);
            setKeyInput('');
          }}
        >
          취소
        </Button>
      )}
    </div>
  );

  return (
    <div className="section applink">
      {/* 목업 Applink: 섹션 제목 없이 [딥링크 어드민 열기]는 탑바 오른쪽 끝 */}
      <TopbarSlot
        right={
          <Button
            onClick={() =>
              void window.oneApp.openExternal(
                'https://appcake.co.kr/appadmin/deeplink/deeplink_view.asp',
              )
            }
            title="딥링크 어드민 페이지 열기"
          >
            <Icon name="arrow-up-right" size={14} />
            딥링크 어드민 열기
          </Button>
        }
      />

      {/* API 키 — 없으면 입력받고, 있으면 상태 줄만 (변경 가능) */}
      {hasKey === false || editKey ? (
        <div className="applink__key applink__key--edit">
          {hasKey === false && (
            <Banner>
              applink.kr API 키를 먼저 저장하세요. (키는 이 기기에 암호화되어
              저장됩니다)
            </Banner>
          )}
          {keyForm}
        </div>
      ) : (
        hasKey && (
          <div className="applink__key">
            <span className="applink__key-icon">
              <Icon name="lock" size={14} />
            </span>
            <span className="applink__key-text">API 키 저장됨</span>
            <Button variant="plain" size="xs" onClick={() => setEditKey(true)}>
              변경
            </Button>
          </div>
        )
      )}

      {/* 생성 폼 */}
      <div className="applink__panel">
        <div className="applink__field">
          <label htmlFor="applink-url">대상 URL</label>
          <Input
            id="applink-url"
            type="text"
            className="applink__mono"
            value={canonicalUrl}
            onChange={(e) => setCanonicalUrl(e.target.value)}
            placeholder="https://... (앱에서 열릴 목적지 URL)"
            disabled={creating || hasKey === false}
          />
        </div>

        <div className="applink__og">
          <button
            type="button"
            className="applink__og-head"
            aria-expanded={ogOpen}
            onClick={toggleOg}
          >
            <Icon name={ogOpen ? 'chevron-down' : 'chevron-right'} size={14} />
            <span>공유 정보 (선택)</span>
          </button>
          {ogOpen && (
            <div className="applink__og-body">
              <p className="hint applink__og-desc">
                SNS 공유 시 표시할 제목·설명·이미지. 비우면 표시 안 됩니다.
              </p>
              <div className="applink__field">
                <label htmlFor="applink-og-title">공유 제목</label>
                <Input
                  id="applink-og-title"
                  type="text"
                  value={ogTitle}
                  onChange={(e) => setOgTitle(e.target.value)}
                  placeholder="예: 파격할인 이벤트"
                  disabled={creating}
                />
              </div>
              <div className="applink__field">
                <label htmlFor="applink-og-desc">공유 설명</label>
                <Input
                  id="applink-og-desc"
                  type="text"
                  value={ogDescription}
                  onChange={(e) => setOgDescription(e.target.value)}
                  placeholder="예: 전상품 20% 할인"
                  disabled={creating}
                />
              </div>
              <div className="applink__field">
                <label htmlFor="applink-og-image">공유 이미지</label>
                <Input
                  id="applink-og-image"
                  type="text"
                  className="applink__mono"
                  value={ogImageUrl}
                  onChange={(e) => setOgImageUrl(e.target.value)}
                  placeholder="https:// 이미지 URL"
                  disabled={creating}
                />
              </div>
              <div className="applink__field">
                <label htmlFor="applink-pc">PC 링크</label>
                <Input
                  id="applink-pc"
                  type="text"
                  className="applink__mono"
                  value={desktopUrl}
                  onChange={(e) => setDesktopUrl(e.target.value)}
                  placeholder="https:// PC 웹브라우저 연결 (비우면 안내 페이지)"
                  disabled={creating}
                />
              </div>
            </div>
          )}
        </div>

        {error && <Banner variant="danger">{error}</Banner>}

        <div className="applink__actions">
          <Button
            variant="primary"
            size="lg"
            onClick={() => void create()}
            loading={creating}
            disabled={hasKey === false || !canonicalUrl.trim()}
          >
            <Icon name="link" size={14} />
            딥링크 생성
          </Button>
        </div>
      </div>

      {/* 이번 세션에 만든 딥링크 */}
      {made.length > 0 && (
        <div className="applink__list">
          <div className="applink__list-head">
            <span className="applink__list-title">생성된 딥링크</span>
            <span className="applink__list-count">{made.length}</span>
          </div>
          {made.map((m, i) => (
            <div className="applink__item" key={m.url + i}>
              <div className="applink__item-main">
                <button
                  type="button"
                  className="applink__item-url"
                  onClick={() => void window.oneApp.openExternal(m.url)}
                  title="브라우저에서 열기"
                >
                  {m.url}
                  <Icon name="arrow-up-right" size={11} />
                </button>
                <span className="applink__item-target">{m.canonicalUrl}</span>
              </div>
              <Button size="xs" onClick={() => copy(m.url)}>
                <Icon name="copy" size={13} />
                복사
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
