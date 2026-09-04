import { describe, expect, it } from "vitest";
import { buildReportJql, normalizeLabels, normalizeProjectKeys } from "./jira-report";

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

  it("레이블은 날짜 축과 별도로 AND 로 붙는다", () => {
    expect(
      buildReportJql({
        projectKeys: ["SSB"],
        period: { mode: "all" },
        dateField: "updated",
        labels: ["26/10/15", "26/10/22"],
      }),
    ).toBe(
      'project IN (SSB) AND labels IN ("26/10/15", "26/10/22") ORDER BY created ASC',
    );
  });

  it("레이블만 있어도 조회할 수 있다 (프로젝트를 넘나드는 축)", () => {
    expect(
      buildReportJql({
        projectKeys: [],
        period: { mode: "all" },
        dateField: "updated",
        labels: ["26/10/15"],
      }),
    ).toBe('labels IN ("26/10/15") ORDER BY created ASC');
  });

  it("레이블과 기간을 함께 주면 둘 다 적용한다", () => {
    expect(
      buildReportJql({
        projectKeys: ["SSB"],
        period: { mode: "month", month: "2026-10" },
        dateField: "created",
        labels: ["26/10/15"],
      }),
    ).toBe(
      'project IN (SSB) AND labels IN ("26/10/15") AND created >= "2026-10-01" AND created < "2026-11-01" ORDER BY created ASC',
    );
  });

  it("프로젝트도 레이블도 없으면 던진다", () => {
    expect(() =>
      buildReportJql({
        projectKeys: [],
        period: { mode: "all" },
        dateField: "updated",
        labels: ["  "],
      }),
    ).toThrow("레이블");
  });

  it("레이블의 따옴표는 이스케이프한다", () => {
    expect(
      buildReportJql({
        projectKeys: [],
        period: { mode: "all" },
        dateField: "updated",
        labels: ['a"b'],
      }),
    ).toBe('labels IN ("a\\"b") ORDER BY created ASC');
  });
});

describe("normalizeLabels", () => {
  it("공백을 떼고 빈 값·중복을 버린다", () => {
    expect(normalizeLabels([" 26/10/15 ", "26/10/15", "", "  ", "26/11/03"])).toEqual([
      "26/10/15",
      "26/11/03",
    ]);
  });

  it("undefined 는 빈 목록", () => {
    expect(normalizeLabels(undefined)).toEqual([]);
  });
});

