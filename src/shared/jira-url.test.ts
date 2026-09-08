import { describe, expect, it } from 'vitest';
import { issueKeysIn, jiraIssueUrl, normalizeJiraBase } from './jira-url';

describe('normalizeJiraBase', () => {
  it('정상 사이트 주소는 그대로 둔다 (끝 슬래시만 정리)', () => {
    expect(normalizeJiraBase('https://acme.atlassian.net')).toBe('https://acme.atlassian.net');
    expect(normalizeJiraBase('https://acme.atlassian.net/')).toBe('https://acme.atlassian.net');
    expect(normalizeJiraBase('  https://acme.atlassian.net  ')).toBe('https://acme.atlassian.net');
  });

  it('Cloud 주소는 경로를 모두 떼고 origin 만 남긴다', () => {
    // 실제 사고 원인 — 티켓 주소를 붙여넣으면 REST 가 HTML 200 을 받는다
    expect(normalizeJiraBase('https://acme.atlassian.net/browse/FEMC-1234')).toBe(
      'https://acme.atlassian.net',
    );
    expect(normalizeJiraBase('https://acme.atlassian.net/jira/your-work')).toBe(
      'https://acme.atlassian.net',
    );
    expect(
      normalizeJiraBase('https://acme.atlassian.net/jira/software/projects/FEMC/boards/1'),
    ).toBe('https://acme.atlassian.net');
  });

  it('설치형은 앱 경로만 떼고 서브패스 배포는 지킨다', () => {
    expect(normalizeJiraBase('https://jira.acme.co.kr/browse/ABC-1')).toBe(
      'https://jira.acme.co.kr',
    );
    expect(normalizeJiraBase('https://acme.co.kr/jira/browse/ABC-1')).toBe(
      'https://acme.co.kr/jira',
    );
    expect(normalizeJiraBase('https://acme.co.kr/jira')).toBe('https://acme.co.kr/jira');
  });

  it('빈 값·URL 이 아닌 값은 손대지 않는다', () => {
    expect(normalizeJiraBase('')).toBe('');
    expect(normalizeJiraBase('   ')).toBe('');
    expect(normalizeJiraBase('acme.atlassian.net')).toBe('acme.atlassian.net');
  });
});

describe('jiraIssueUrl', () => {
  it('베이스 뒤에 /browse/키 를 붙인다 (끝 슬래시 정리)', () => {
    expect(jiraIssueUrl('https://acme.atlassian.net', 'BBJ-1')).toBe(
      'https://acme.atlassian.net/browse/BBJ-1',
    );
    expect(jiraIssueUrl('https://acme.co.kr/jira/', 'ABC-12')).toBe(
      'https://acme.co.kr/jira/browse/ABC-12',
    );
  });
});

describe('issueKeysIn', () => {
  it('제목 속 이슈 키를 등장 순서대로 중복 없이 뽑는다', () => {
    expect(issueKeysIn('[BBJ-2924] 로그인 수정 (BBJ-2924, CNM-907)')).toEqual([
      'BBJ-2924',
      'CNM-907',
    ]);
  });

  it('키가 없으면 빈 배열', () => {
    expect(issueKeysIn('fix: 오타 수정')).toEqual([]);
    expect(issueKeysIn('')).toEqual([]);
  });

  it('소문자·글자에 붙어 쓴 것은 키로 보지 않는다', () => {
    expect(issueKeysIn('bbj-1 xBBJ-2')).toEqual([]);
  });
});
