import { describe, expect, it } from "vitest";
import {
  APPLICANT_PLACEHOLDER,
  DEPT_PLACEHOLDER,
  formatHoursTotal,
  hasTitlePlaceholder,
  titleTag,
  vacationTitle,
} from "./approval-format";

/** 기본 인자 — 각 테스트가 필요한 것만 덮어쓴다 */
const base = {
  attDivName: "연차",
  fromDate: "2026-09-01",
  toDate: "2026-09-01",
  name: "정수범",
  // 환경설정 '결재 소속' 값 그대로 — 공백은 제목에서 밑줄이 된다
  dept: "FE챕터 플랫폼기술부문",
};

describe("vacationTitle", () => {
  it("[종류] 이름_챕터_부문 (날짜) 형식이다", () => {
    expect(vacationTitle(base)).toBe(
      "[연차] 정수범_FE챕터_플랫폼기술부문 (9월 1일)",
    );
  });

  it("여러 날이면 괄호에 기간이 들어간다", () => {
    expect(vacationTitle({ ...base, toDate: "2026-09-02" })).toBe(
      "[연차] 정수범_FE챕터_플랫폼기술부문 (9월 1일~9월 2일)",
    );
  });

  it("반차·시차는 괄호에 날짜와 시간대를 함께 적고 태그를 묶는다", () => {
    expect(
      vacationTitle({
        ...base,
        attDivName: "오전반차",
        useStartTime: "09:00",
        useEndTime: "14:00",
      }),
    ).toBe("[반차] 정수범_FE챕터_플랫폼기술부문 (9월 1일 09:00~14:00)");
    expect(
      vacationTitle({
        ...base,
        attDivName: "시차_1시간",
        useStartTime: "09:00",
        useEndTime: "10:00",
      }),
    ).toBe("[시차] 정수범_FE챕터_플랫폼기술부문 (9월 1일 09:00~10:00)");
  });

  it("대체휴가는 괄호에 휴일근무일을 덧붙인다", () => {
    expect(
      vacationTitle({
        ...base,
        attDivName: "대체휴가",
        holidayWorkDate: "2026-08-09",
      }),
    ).toBe(
      "[대체휴가] 정수범_FE챕터_플랫폼기술부문 (9월 1일, 휴일근무일: 08/09)",
    );
  });

  it("시간대를 안 넘기면 시차·반차도 날짜만 넣는다", () => {
    expect(vacationTitle({ ...base, attDivName: "오후반차" })).toBe(
      "[반차] 정수범_FE챕터_플랫폼기술부문 (9월 1일)",
    );
  });

  it("이름·소속을 모르면 자리표시를 넣는다 (미리보기)", () => {
    expect(
      vacationTitle({ attDivName: "연차", fromDate: "2026-09-01", toDate: "2026-09-01" }),
    ).toBe(`[연차] ${APPLICANT_PLACEHOLDER}_${DEPT_PLACEHOLDER} (9월 1일)`);
  });

  it("소속은 설정값 그대로 쓴다 — 쪼개거나 덧붙이지 않는다", () => {
    // 2026-09-03 회귀: 챕터를 그룹웨어에서 따로 읽어 붙였다가 `FE챕터_FE챕터` 가 됐다
    expect(vacationTitle({ ...base, dept: "FE챕터 플랫폼기술부문" })).toBe(
      "[연차] 정수범_FE챕터_플랫폼기술부문 (9월 1일)",
    );
    expect(vacationTitle({ ...base, dept: "플랫폼기술부문" })).toBe(
      "[연차] 정수범_플랫폼기술부문 (9월 1일)",
    );
    // 이미 밑줄로 쓴 값·앞뒤 공백·여러 칸 공백도 그대로 살린다
    expect(vacationTitle({ ...base, dept: "  FE챕터_플랫폼기술부문  " })).toContain(
      "정수범_FE챕터_플랫폼기술부문",
    );
    expect(vacationTitle({ ...base, dept: "FE챕터   플랫폼기술부문" })).toContain(
      "정수범_FE챕터_플랫폼기술부문",
    );
    expect(vacationTitle({ ...base, dept: "" })).toBe(
      `[연차] 정수범_${DEPT_PLACEHOLDER} (9월 1일)`,
    );
  });
});

describe("hasTitlePlaceholder", () => {
  it("성명·소속 자리표시가 남아 있으면 true", () => {
    expect(hasTitlePlaceholder(vacationTitle({ attDivName: "연차", fromDate: "2026-09-01", toDate: "2026-09-01" }))).toBe(true);
    expect(hasTitlePlaceholder(vacationTitle({ ...base, dept: "" }))).toBe(true);
    expect(hasTitlePlaceholder(vacationTitle(base))).toBe(false);
  });
});

describe("titleTag", () => {
  it("시차·반차는 하나의 태그로 묶고 나머지는 그대로 쓴다", () => {
    expect(titleTag("시차_1시간")).toBe("시차");
    expect(titleTag("시차_2시간")).toBe("시차");
    expect(titleTag("오전반차")).toBe("반차");
    expect(titleTag("오후반차")).toBe("반차");
    expect(titleTag("연차")).toBe("연차");
    expect(titleTag("대체휴가")).toBe("대체휴가");
  });
});

describe("formatHoursTotal", () => {
  it("자정을 넘겨도 계산하고, 시작=종료면 빈 문자열이다", () => {
    expect(formatHoursTotal("18:00", "20:00")).toBe("2시간");
    expect(formatHoursTotal("18:00", "20:30")).toBe("2.5시간");
    expect(formatHoursTotal("23:00", "01:00")).toBe("2시간");
    expect(formatHoursTotal("18:00", "18:00")).toBe("");
    expect(formatHoursTotal("", "20:00")).toBe("");
  });
});
