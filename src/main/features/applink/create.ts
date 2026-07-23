// applink.kr 딥링크 생성 — 보안상 클라이언트 JS 호출은 막혀 있어 메인(서버측)에서 호출한다.
import type { ApplinkInput } from '../../../shared/types';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from '../../lib/http';

const ENDPOINT = 'https://applink.kr/deeplink/deeplink_create.asp';

/** 딥링크(단축 URL) 생성. 성공 시 생성된 url·short_code 반환 */
export async function createDeeplink(
  apiKey: string,
  input: ApplinkInput,
): Promise<{ url: string; shortCode?: string }> {
  // 필수는 $canonical_url, 나머지는 값이 있을 때만 넣는다 (문서 규약)
  const data: Record<string, string> = {
    $canonical_url: input.canonicalUrl.trim(),
  };
  if (input.ogTitle?.trim()) data.$og_title = input.ogTitle.trim();
  if (input.ogDescription?.trim()) data.$og_description = input.ogDescription.trim();
  if (input.ogImageUrl?.trim()) data.$og_image_url = input.ogImageUrl.trim();
  if (input.desktopUrl?.trim()) data.$desktop_url = input.desktopUrl.trim();

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'X-API-KEY': apiKey,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ data }),
    });
  } catch {
    throw new Error('applink.kr 에 연결할 수 없습니다 — 네트워크를 확인하세요.');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('API 키가 유효하지 않습니다 — 저장된 키를 확인하세요.');
  if (!res.ok) throw new Error(`딥링크 생성 실패 (HTTP ${res.status})`);

  const json = (await res.json()) as {
    url?: string;
    deep_link_url?: string;
    short_code?: string;
    deeplink_idx?: string;
  };
  const url = json.url ?? json.deep_link_url;
  if (!url) throw new Error('응답에 딥링크 URL 이 없습니다.');
  return { url, shortCode: json.short_code ?? json.deeplink_idx };
}
