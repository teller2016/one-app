import { useEffect, useState } from 'react';
import { SectionHeader } from '../../../components/SectionHeader';
import { FormRow } from '../../../components/FormRow';
import { Input } from '../../../components/Input';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { Collapsible } from '../../../components/Collapsible';
import { TextLink } from '../../../components/TextLink';
import { useToast } from '../../../components/Toast';
import { useCopy } from '../../../lib/useCopy';

type Made = { url: string; canonicalUrl: string };

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
    const res = await window.oneApp.applink.create({
      canonicalUrl,
      ogTitle,
      ogDescription,
      ogImageUrl,
      desktopUrl,
    });
    setCreating(false);
    if (!res.ok || !res.url) {
      setError(res.error ?? '딥링크 생성에 실패했습니다.');
      return;
    }
    setMade((prev) => [{ url: res.url as string, canonicalUrl: canonicalUrl.trim() }, ...prev]);
    copy(res.url); // 만들자마자 클립보드로
  };

  return (
    <div className="section applink">
      <SectionHeader
        icon={<Icon name="link" size={18} />}
        title="딥링크"
        sub="applink.kr 디퍼드 딥링크(단축 URL)를 만들어 공유에 사용합니다."
      />

      <p className="applink__admin">
        <TextLink
          small
          external
          onClick={() =>
            void window.oneApp.openExternal(
              'https://appcake.co.kr/appadmin/deeplink/deeplink_view.asp',
            )
          }
          title="딥링크 어드민 페이지 열기"
        >
          딥링크 어드민 열기
        </TextLink>
      </p>

      {/* API 키 — 없으면 입력받고, 있으면 상태만 (변경 가능) */}
      {hasKey === false || editKey ? (
        <div className="applink__key">
          {hasKey === false && (
            <Banner>
              applink.kr API 키를 먼저 저장하세요. (키는 이 기기에 암호화되어
              저장됩니다)
            </Banner>
          )}
          <FormRow label="API 키">
            <Input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="X-API-KEY"
            />
            <Button variant="primary" onClick={saveKey} disabled={!keyInput.trim()}>
              저장
            </Button>
            {editKey && (
              <Button
                onClick={() => {
                  setEditKey(false);
                  setKeyInput('');
                }}
              >
                취소
              </Button>
            )}
          </FormRow>
        </div>
      ) : (
        hasKey && (
          <p className="hint applink__key-status">
            API 키 저장됨{' '}
            <TextLink small onClick={() => setEditKey(true)}>
              변경
            </TextLink>
          </p>
        )
      )}

      {/* 생성 폼 */}
      <FormRow label="대상 URL">
        <Input
          type="text"
          value={canonicalUrl}
          onChange={(e) => setCanonicalUrl(e.target.value)}
          placeholder="https://... (앱에서 열릴 목적지 URL)"
          disabled={creating || hasKey === false}
        />
      </FormRow>

      <Collapsible
        title="공유 정보 (선택)"
        icon={<Icon name="info" size={14} />}
        storageKey="applink:group:og"
      >
        <p className="hint applink__og-desc">
          SNS 공유 시 표시할 제목·설명·이미지. 비우면 표시 안 됩니다.
        </p>
        <FormRow label="공유 제목">
          <Input
            type="text"
            value={ogTitle}
            onChange={(e) => setOgTitle(e.target.value)}
            placeholder="예: 파격할인 이벤트"
            disabled={creating}
          />
        </FormRow>
        <FormRow label="공유 설명">
          <Input
            type="text"
            value={ogDescription}
            onChange={(e) => setOgDescription(e.target.value)}
            placeholder="예: 전상품 20% 할인"
            disabled={creating}
          />
        </FormRow>
        <FormRow label="공유 이미지">
          <Input
            type="text"
            value={ogImageUrl}
            onChange={(e) => setOgImageUrl(e.target.value)}
            placeholder="https:// 이미지 URL"
            disabled={creating}
          />
        </FormRow>
        <FormRow label="PC 링크">
          <Input
            type="text"
            value={desktopUrl}
            onChange={(e) => setDesktopUrl(e.target.value)}
            placeholder="https:// PC 웹브라우저 연결 (비우면 안내 페이지)"
            disabled={creating}
          />
        </FormRow>
      </Collapsible>

      {error && <Banner variant="danger">{error}</Banner>}

      <div className="form-actions">
        <Button
          variant="primary"
          onClick={() => void create()}
          loading={creating}
          disabled={hasKey === false || !canonicalUrl.trim()}
        >
          <Icon name="link" size={14} />
          딥링크 생성
        </Button>
      </div>

      {/* 이번 세션에 만든 딥링크 */}
      {made.length > 0 && (
        <>
          <label className="form-label">생성된 딥링크</label>
          <div className="applink__list">
            {made.map((m, i) => (
              <div className="applink__item" key={m.url + i}>
                <div className="applink__item-main">
                  <TextLink
                    external
                    className="applink__item-url"
                    onClick={() => void window.oneApp.openExternal(m.url)}
                    title="브라우저에서 열기"
                  >
                    {m.url}
                  </TextLink>
                  <span className="applink__item-target">{m.canonicalUrl}</span>
                </div>
                <Button size="sm" onClick={() => copy(m.url)}>
                  <Icon name="copy" size={13} />
                  복사
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
