import { describe, expect, it } from 'vitest';
import type { JiraReportIssue } from '../../../../shared/types';
import {
  DEFAULT_TEMPLATE,
  renderReport,
  renderTemplateLine,
  TEMPLATE_PRESETS,
  TEMPLATE_VARS,
  unescapeTemplate,
} from './reportTemplate';

const issue = (over: Partial<JiraReportIssue> = {}): JiraReportIssue => ({
  key: 'SSB-111',
  projectKey: 'SSB',
  summary: '로그인 버튼이 눌리지 않음',
  status: '완료',
  statusCategory: 'done',
  issueType: '버그',
  parentKey: 'SSB-100',
  parentSummary: '로그인 개선',
  priority: '높음',
  updatedAt: '2026-08-20T10:00:00.000+0900',
  url: 'https://jira.example.com/browse/SSB-111',
  assignee: '정수범',
  reporter: '김QA',
  labels: ['release', 'fe'],
  createdAt: '2026-08-01T09:00:00.000+0900',
  resolvedAt: null,
  ...over,
});

describe('renderTemplateLine', () => {
  it('기본 템플릿은 "번호 티켓명" 이다', () => {
    expect(renderTemplateLine(DEFAULT_TEMPLATE, issue())).toBe(
      'SSB-111 로그인 버튼이 눌리지 않음',
    );
  });

  it('모든 자리표시자를 채운다 (빈 값은 빈 문자열)', () => {
    const it = issue();
    for (const v of TEMPLATE_VARS) {
      expect(renderTemplateLine(`{${v.name}}`, it)).toBe(v.get(it));
    }
    expect(renderTemplateLine('{resolved}', it)).toBe('');
    expect(renderTemplateLine('{assignee}', issue({ assignee: null }))).toBe('');
  });

  it('날짜는 YYYY-MM-DD 로 줄인다', () => {
    expect(renderTemplateLine('{created}', issue())).toBe('2026-08-01');
  });

  it('대소문자를 가리지 않고, 모르는 자리표시자는 그대로 둔다', () => {
    expect(renderTemplateLine('{KEY} {nope}', issue())).toBe('SSB-111 {nope}');
  });

  it('\\t \\n 이스케이프를 실제 문자로 바꾼다', () => {
    expect(unescapeTemplate('a\\tb\\nc')).toBe('a\tb\nc');
    expect(renderTemplateLine('{key}\\t{status}', issue())).toBe('SSB-111\t완료');
  });

  it('프리셋은 전부 자리표시자가 유효하다', () => {
    const it = issue();
    for (const p of TEMPLATE_PRESETS) {
      expect(renderTemplateLine(p.template, it)).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });
});

describe('renderReport', () => {
  it('여러 티켓을 줄바꿈으로 잇는다', () => {
    const lines = renderReport(DEFAULT_TEMPLATE, [
      issue(),
      issue({ key: 'SSB-112', summary: '두 번째' }),
    ]);
    expect(lines).toBe('SSB-111 로그인 버튼이 눌리지 않음\nSSB-112 두 번째');
  });

  it('비어 있으면 빈 문자열', () => {
    expect(renderReport(DEFAULT_TEMPLATE, [])).toBe('');
  });
});
