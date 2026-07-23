// 앱 설정 저장 — 비밀번호는 Electron safeStorage(OS 키체인)로 암호화해 저장
import type {
  AppSettingsView,
  SaveSettingsInput,
  ThemePref,
} from '../../../shared/types';
import {
  readUserJson,
  writeUserJson,
  encryptSecret,
  decryptSecret,
} from '../../lib/store';

interface StoredSettings {
  bizboxId: string;
  bizboxPasswordEnc?: string; // safeStorage 로 암호화된 비밀번호(base64)
  notifyDeploy?: boolean; // 배포 완료/실패 알림 (기본 on)
  jiraUrl?: string; // Jira 베이스 URL (커밋 이슈 키 링크화)
  jiraEmail?: string; // Jira 계정 이메일 (내 이슈 API 인증)
  jiraTokenEnc?: string; // safeStorage 로 암호화된 Jira API 토큰
  giteaUrl?: string; // Gitea 베이스 URL (커밋 링크·배포 미리보기)
  giteaTokenEnc?: string; // safeStorage 로 암호화된 Gitea 토큰 (선택)
  theme?: ThemePref; // 테마 (기본 system) — 창 배경색 결정에 main 도 읽음
}

const readStored = (): StoredSettings =>
  readUserJson<StoredSettings>('settings.json', { bizboxId: '' });

const writeStored = (s: StoredSettings) => writeUserJson('settings.json', s);

/** 렌더러에 보낼 안전한 형태 — 비밀번호 값은 보내지 않고 "설정됨" 여부만 */
export function getSettingsForRenderer(): AppSettingsView {
  const s = readStored();
  return {
    bizboxId: s.bizboxId ?? '',
    hasPassword: !!s.bizboxPasswordEnc,
    notifyDeploy: s.notifyDeploy !== false, // 기본값 on
    jiraUrl: s.jiraUrl ?? '',
    jiraEmail: s.jiraEmail ?? '',
    hasJiraToken: !!s.jiraTokenEnc,
    giteaUrl: s.giteaUrl ?? '',
    hasGiteaToken: !!s.giteaTokenEnc,
    theme: s.theme ?? 'system',
  };
}

/** 테마 설정만 저장 (환경설정 세그먼트 — 즉시 적용·즉시 저장) */
export function saveTheme(theme: ThemePref): AppSettingsView {
  writeStored({ ...readStored(), theme });
  return getSettingsForRenderer();
}

/** 저장된 테마 설정 (main 이 창 생성 시 배경색 결정에 사용) */
export function getThemePref(): ThemePref {
  return readStored().theme ?? 'system';
}

export function saveSettings(input: SaveSettingsInput): AppSettingsView {
  const next: StoredSettings = {
    ...readStored(),
    bizboxId: input.bizboxId ?? '',
  };
  // 비밀번호는 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.password && input.password.length > 0) {
    next.bizboxPasswordEnc = encryptSecret(input.password);
  }
  // 알림 토글은 명시적으로 넘어온 경우만 갱신
  if (typeof input.notifyDeploy === 'boolean') {
    next.notifyDeploy = input.notifyDeploy;
  }
  // 연동 주소는 명시적으로 넘어온 경우만 갱신 (끝 슬래시 제거)
  if (typeof input.jiraUrl === 'string') {
    next.jiraUrl = input.jiraUrl.trim().replace(/\/+$/, '');
  }
  if (typeof input.jiraEmail === 'string') {
    next.jiraEmail = input.jiraEmail.trim();
  }
  // Jira API 토큰은 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.jiraToken && input.jiraToken.length > 0) {
    next.jiraTokenEnc = encryptSecret(input.jiraToken);
  }
  if (typeof input.giteaUrl === 'string') {
    next.giteaUrl = input.giteaUrl.trim().replace(/\/+$/, '');
  }
  // Gitea 토큰은 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.giteaToken && input.giteaToken.length > 0) {
    next.giteaTokenEnc = encryptSecret(input.giteaToken);
  }
  writeStored(next);
  return getSettingsForRenderer();
}

/** Gitea 연동 설정 (주소 미설정이면 null). 토큰은 없으면 null — 익명 조회 시도 */
export function getGiteaConfig(): { url: string; token: string | null } | null {
  const s = readStored();
  if (!s.giteaUrl) return null;
  const token = s.giteaTokenEnc ? decryptSecret(s.giteaTokenEnc) : null;
  return { url: s.giteaUrl.replace(/\/+$/, ''), token };
}

/** Jira 내 이슈 API 설정 — 주소·이메일·토큰이 모두 있어야 사용 가능 (아니면 null) */
export function getJiraApiConfig(): {
  url: string;
  email: string;
  token: string;
} | null {
  const s = readStored();
  if (!s.jiraUrl || !s.jiraEmail || !s.jiraTokenEnc) return null;
  const token = decryptSecret(s.jiraTokenEnc);
  if (token == null) return null;
  return { url: s.jiraUrl.replace(/\/+$/, ''), email: s.jiraEmail, token };
}

/** 배포 완료 알림이 켜져 있는지 (기본 on) */
export function isDeployNotifyEnabled(): boolean {
  return readStored().notifyDeploy !== false;
}

/** 매크로 실행용 자격증명 복호화. 없으면 null */
export function getCredentials(): { id: string; password: string } | null {
  const s = readStored();
  if (!s.bizboxId || !s.bizboxPasswordEnc) return null;
  const password = decryptSecret(s.bizboxPasswordEnc);
  if (password == null) return null;
  return { id: s.bizboxId, password };
}
