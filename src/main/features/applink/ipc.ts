import { ipcMain } from 'electron';
import { hasApiKey, getApiKey, saveApiKey } from './store';
import { createDeeplink } from './create';
import type {
  ApplinkInput,
  ApplinkResult,
  ApplinkKeyStatus,
} from '../../../shared/types';

/** 딥링크(applink.kr) IPC 핸들러 등록 */
export function registerApplinkIpc() {
  // API 키 저장 여부
  ipcMain.handle('applink:key:status', (): ApplinkKeyStatus => ({
    hasKey: hasApiKey(),
  }));

  // API 키 저장 (암호화)
  ipcMain.handle('applink:key:set', (_e, key: string): ApplinkKeyStatus => {
    if (typeof key === 'string' && key.trim()) saveApiKey(key.trim());
    return { hasKey: hasApiKey() };
  });

  // 딥링크 생성
  ipcMain.handle(
    'applink:create',
    async (_e, input: ApplinkInput): Promise<ApplinkResult> => {
      const key = getApiKey();
      if (!key)
        return { ok: false, error: 'API 키가 없습니다. 먼저 키를 저장하세요.' };
      if (!/^https?:\/\//i.test(input?.canonicalUrl?.trim() ?? ''))
        return { ok: false, error: '대상 URL 을 http(s):// 형태로 입력하세요.' };
      try {
        const { url, shortCode } = await createDeeplink(key, input);
        return { ok: true, url, shortCode };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
