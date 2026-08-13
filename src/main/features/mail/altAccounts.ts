// 팀 공용 메일 계정(인증코드 조회용) 저장 — 비밀번호는 safeStorage 로 암호화해 userData 에만 둔다.
//
// 환경설정의 비즈박스 계정과는 별개다: 그 계정은 앱 전반의 그룹웨어 접근(메일·근태·결재)에 쓰이고,
// 여기 계정들은 **인증코드를 읽는 용도로만** 쓴다. 그래서 저장 파일도 분리한다.
import {
  decryptSecret,
  encryptSecret,
  readUserJson,
  writeUserJson,
} from '../../lib/store';
import type { AltMailAccount } from '../../../shared/types';

const FILE = 'alt-mail-accounts.json';

type StoredAccount = { loginId: string; passwordEnc: string };
type Stored = { accounts: StoredAccount[] };

function read(): Stored {
  const raw = readUserJson<Stored>(FILE, { accounts: [] });
  return { accounts: Array.isArray(raw.accounts) ? raw.accounts : [] };
}

/** 렌더러 노출용 목록 — 비밀번호는 암호문조차 내보내지 않는다 */
export function listAltAccounts(): AltMailAccount[] {
  return read().accounts.map((a) => ({ loginId: a.loginId }));
}

/** 로그인에 쓸 계정 정보(복호화) — 없거나 복호화에 실패하면 null */
export function getAltAccountCred(
  loginId: string,
): { id: string; password: string } | null {
  const found = read().accounts.find((a) => a.loginId === loginId);
  if (!found) return null;
  const password = decryptSecret(found.passwordEnc);
  return password == null ? null : { id: found.loginId, password };
}

/**
 * 계정 추가·수정. 같은 `loginId` 면 비밀번호만 갱신한다.
 * 비밀번호가 빈 문자열이면 **기존 값을 유지**한다 — 이미 등록한 계정을 다시 저장할 때
 * 비밀번호를 다시 입력하게 만들지 않기 위함이다(빈 값으로 덮으면 로그인이 깨진다).
 */
export function saveAltAccount(
  loginId: string,
  password: string,
): AltMailAccount[] {
  const id = loginId.trim();
  if (!id) throw new Error('계정 ID를 입력하세요.');

  const stored = read();
  const idx = stored.accounts.findIndex((a) => a.loginId === id);
  if (idx < 0) {
    if (!password) throw new Error('비밀번호를 입력하세요.');
    stored.accounts.push({ loginId: id, passwordEnc: encryptSecret(password) });
  } else if (password) {
    stored.accounts[idx].passwordEnc = encryptSecret(password);
  }
  writeUserJson(FILE, stored);
  return listAltAccounts();
}

/** 계정 삭제 */
export function removeAltAccount(loginId: string): AltMailAccount[] {
  const stored = read();
  stored.accounts = stored.accounts.filter((a) => a.loginId !== loginId);
  writeUserJson(FILE, stored);
  return listAltAccounts();
}
