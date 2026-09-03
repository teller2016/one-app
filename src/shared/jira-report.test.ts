import { describe, expect, it } from "vitest";
import { buildReportJql, normalizeProjectKeys } from "./jira-report";

describe("normalizeProjectKeys", () => {
  it("대문자로 맞추고 중복·빈 값·형식 위반을 버린다", () => {
    expect(normalizeProjectKeys(["ssb", " SSB ", "bbj", "", "bad key", "1ABC"])).toEqual([
      "SSB",
      "BBJ",
    ]);
  });
});

describe("buildReportJql", () => {
  it("월 기간은 다음 달 1일 미만으로 자른다", () => {
    expect(
      buildReportJql({
        projectKeys: ["SSB"],
        period: { mode: "month", month: "2026-08" },
        dateField: "updated",
      }),
    ).toBe(
      'project IN (SSB) AND updated >= "2026-08-01" AND updated < "2026-09-01" ORDER BY created ASC',
    );
  });

  it("12월은 다음 해 1월로 넘어간다", () => {
    expect(
      buildReportJql({
        projectKeys: ["SSB"],
        period: { mode: "month", month: "2026-12" },
        dateField: "resolved",
      }),
    ).toContain('resolved >= "2026-12-01" AND resolved < "2027-01-01"');
  });

  it("기간 직접 지정은 끝 날짜의 다음 날 미만이다 (말일 포함)", () => {
    expect(
      buildReportJql({
        projectKeys: ["SSB", "BBJ"],
        period: { mode: "range", start: "2026-08-15", end: "2026-08-31" },
        dateField: "created",
      }),
    ).toBe(
      'project IN (SSB, BBJ) AND created >= "2026-08-15" AND created < "2026-09-01" ORDER BY created ASC',
    );
  });

  it("기간 없음이면 프로젝트 조건만 남는다", () => {
    expect(
      buildReportJql({ projectKeys: ["ssb"], period: { mode: "all" }, dateField: "updated" }),
    ).toBe("project IN (SSB) ORDER BY created ASC");
  });

  it("프로젝트가 없으면 던진다", () => {
    expect(() =>
      buildReportJql({ projectKeys: [], period: { mode: "all" }, dateField: "updated" }),
    ).toThrow("프로젝트");
  });

  it("시작이 끝보다 늦으면 던진다", () => {
    expect(() =>
      buildReportJql({
        projectKeys: ["SSB"],
        period: { mode: "range", start: "2026-09-02", end: "2026-09-01" },
        dateField: "updated",
      }),
    ).toThrow("늦습니다");
  });

  it("고급 JQL 이 있으면 조건을 무시하고 그대로 보낸다", () => {
    expect(
      buildReportJql({
        projectKeys: [],
        period: { mode: "all" },
        dateField: "updated",
        jql: '  labels = "release" ORDER BY key  ',
      }),
    ).toBe('labels = "release" ORDER BY key');
  });
});
