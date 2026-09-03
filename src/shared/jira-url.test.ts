import { describe, expect, it } from 'vitest';
import { normalizeJiraBase } from './jira-url';

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
