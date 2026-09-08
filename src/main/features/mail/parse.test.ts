// 메일 응답 파서 — mail2 의 JSON 세션 만료 통지(code:-2)를 "빈 메일함"과 구분하는지 확인
import { describe, expect, it } from 'vitest';
import { AuthError } from './session';
import { isAuthFailureJson, looksLikeLogin, parseJson } from './parse';

// 2026-09-08 쿠키 없이 실측한 mail2 응답 — HTTP 200 text/plain
const EXPIRED =
  '{"code":-2,"gwUrl":"https:\\/\\/gw.forbiz.co.kr\\/gw\\/userMain.do","Records":[]}';

const res = (text: string) => new Response(text);

describe('isAuthFailureJson', () => {
  it('code:-2 또는 gwUrl 이 있으면 세션 만료 통지다', () => {
    expect(isAuthFailureJson(JSON.parse(EXPIRED))).toBe(true);
    expect(isAuthFailureJson({ gwUrl: 'https://gw.forbiz.co.kr/gw/userMain.do' })).toBe(true);
  });

  it('정상 데이터 응답(빈 목록 포함)은 만료가 아니다', () => {
    expect(isAuthFailureJson({ Records: [], TotalRecordCount: 0 })).toBe(false);
    expect(isAuthFailureJson({ mailboxList: [], allunseen: 0 })).toBe(false);
    expect(isAuthFailureJson({ code: 0 })).toBe(false);
    expect(isAuthFailureJson(null)).toBe(false);
    expect(isAuthFailureJson('text')).toBe(false);
  });
});

describe('parseJson', () => {
  it('세션 만료 JSON 은 빈 목록이 아니라 AuthError 로 던진다', async () => {
    await expect(parseJson(res(EXPIRED))).rejects.toBeInstanceOf(AuthError);
  });

  it('로그인 HTML 도 AuthError', async () => {
    await expect(
      parseJson(res('<html><title>그룹웨어 로그인</title></html>')),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('JSON 도 로그인 페이지도 아니면 일반 오류', async () => {
    await expect(parseJson(res('<html>502 Bad Gateway</html>'))).rejects.toThrow(
      '해석하지 못했습니다',
    );
  });

  it('정상 JSON 은 그대로 돌려준다 (빈 목록도 정상)', async () => {
    await expect(parseJson(res('{"Records":[],"TotalRecordCount":0}'))).resolves.toEqual({
      Records: [],
      TotalRecordCount: 0,
    });
  });
});

describe('looksLikeLogin', () => {
  it('HTML 본문을 기대하는 곳에 온 JSON 만료 통지도 잡는다', () => {
    expect(looksLikeLogin(EXPIRED)).toBe(true);
    expect(looksLikeLogin('  ' + EXPIRED)).toBe(true);
  });

  it('보통의 메일 본문 HTML 은 만료가 아니다', () => {
    expect(looksLikeLogin('<div>안녕하세요 {"code":-2} 라는 문자열이 본문에 있어도</div>')).toBe(false);
    expect(looksLikeLogin('{"code":0,"html":"..."}')).toBe(false);
  });
});
