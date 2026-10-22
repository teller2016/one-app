// 루트 세션 MCP 도구 — 결재·일정(3c, 2026-10-22): get_approval_defaults · get_vacation_status · get_worklog · open_approval_form · open_schedule.
//
// 기획 결정: 작성·등록은 기존 화면에서 사용자가 누른다 — 루트는 폼을 채워 열기까지만(open_approval_form · open_schedule).
// ⚠️ 특히 휴가는 [작성 시작]이 근태신청을 그룹웨어 서버에 저장한다(approval 규칙) — 사용자 클릭 없이 돌면 외부 기록이 남는다.
// 일정은 써 둔 작업 기록 **뒤에 덧붙인다**(같은 종료 시각·제목은 건너뜀 — 사용자 결정). 입력 검증은 여기서, 채우기·작성 판정은 각 폼이 한다.
// 조회 중 그룹웨어에 로그인하는 것은 get_vacation_status 하나뿐이다(같은 계정 동시 로그인 거부·연속 실패 잠금 — 묻지 않으면 부르지 않는다).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ATT_DIV_NAMES, DOC_REASONS } from '../../../shared/approval-format';
import type { ApprovalFormFill, ScheduleFill } from '../../../shared/types';
import {
  approvalLockOwner,
  fetchVacationStatus,
  getExpendDefaults,
  getOvertimeDefaults,
  getVacationDefaults,
  getWorkerDept,
} from '../approval';
import { readStartConfig, readWorklog } from '../schedule';
import { sendOpenRequest } from './openRequest';
import { fail, json, READ } from './toolKit';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM');
const ATT = z.enum(ATT_DIV_NAMES as [string, ...string[]]);
const REASON = z.enum(DOC_REASONS as [string, ...string[]]);

export function registerOfficeTools(server: McpServer): void {
  server.registerTool(
    'get_approval_defaults',
    {
      title: '결재 기본값',
      description:
        '결재 폼이 미리 채우는 지난 작성 내용 — 야근(업무 대상·수행 내용·사유)·휴가(비상연락망·인수인계)·지출(주차권 매수)·결재 소속. ' +
        '그룹웨어에 로그인하지 않는다. 비운 칸은 폼이 이 값으로 채운다.',
      inputSchema: {},
      annotations: READ,
    },
    async () =>
      json({
        overtime: getOvertimeDefaults(),
        vacation: getVacationDefaults(),
        expend: getExpendDefaults(),
        worker_dept: getWorkerDept() || null,
        busy: approvalLockOwner(),
      }),
  );

  server.registerTool(
    'get_vacation_status',
    {
      title: '연차 현황',
      description:
        '그룹웨어에서 연차 현황(총·사용·잔여·결재 진행 중)을 읽는다. ⚠️ 그룹웨어에 로그인한다 — 사용자가 연차를 물었을 때만 부를 것(반복 호출 금지). ' +
        '휴가 작성이 진행 중이면 거부된다.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      if (approvalLockOwner() === 'vacation') return fail('휴가 작성이 진행 중이라 지금은 조회할 수 없습니다.');
      try {
        return json(await fetchVacationStatus());
      } catch (err) {
        return fail(`연차 현황을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  server.registerTool(
    'get_worklog',
    {
      title: '오늘 작업 기록',
      description:
        '일정 등록 섹션의 작업 기록(항목 = 종료 시각·일정명, 하루 시작 시각)과 요일별 기준 시작 시각(재택·출근). 그룹웨어에 로그인하지 않는다.',
      inputSchema: {},
      annotations: READ,
    },
    async () => {
      const w = readWorklog();
      return json({ start_time: w.startTime, items: w.items.map((i) => ({ end: i.end, title: i.title })), start_config: readStartConfig() });
    },
  );

  server.registerTool(
    'open_approval_form',
    {
      title: '결재 폼 채워 열기',
      description:
        '원앱 결재 섹션의 폼(야근 결재·휴가신청서·지출결의서)을 채워 연다 — **작성하지 않는다**(사용자가 [작성 시작], 그룹웨어 창에서 [상신]). ' +
        'kind 에 맞는 객체 하나만 준다. 비운 칸은 폼의 평소 기본값(지난 작성 내용·오늘). 사용자에게 "폼을 채워 띄웠다"고만 말할 것.',
      inputSchema: {
        kind: z.enum(['overtime', 'vacation', 'expend']).describe('야근 결재 · 휴가신청서 · 지출결의서(개인)'),
        overtime: z
          .object({
            date: DATE.optional().describe('연장근무일'),
            start_time: TIME.optional().describe('기본 18:00'),
            end_time: TIME.optional(),
            target: z.string().max(200).optional().describe('업무 대상'),
            content: z.string().max(2000).optional().describe('수행 내용'),
            reason: z.string().max(500).optional().describe('연장근무 사유'),
          })
          .optional(),
        vacation: z
          .object({
            att_div_name: ATT.optional().describe(`근태구분 — ${ATT_DIV_NAMES.join('·')}`),
            from_date: DATE.optional(),
            to_date: DATE.optional().describe('반차·시차는 하루짜리라 무시된다'),
            use_start_time: TIME.optional().describe('반차·시차 사용 시작'),
            use_end_time: TIME.optional(),
            holiday_work_date: DATE.optional().describe('대체휴가의 근거 휴일근무일'),
            reason: REASON.optional().describe(`사유 — ${DOC_REASONS.join('·')}`),
            reason_etc: z.string().max(200).optional().describe('사유가 기타일 때 괄호 문구'),
            remark: z.string().max(500).optional(),
          })
          .optional(),
        expend: z
          .object({
            month: MONTH.optional().describe('주차요금 대상 월'),
            parking: z
              .object({ man_count: z.number().int().min(0).max(100), half_count: z.number().int().min(0).max(100) })
              .nullable()
              .optional()
              .describe('주차권 매수 — null 이면 주차 항목 없음'),
            dinners: z
              .array(z.object({ date: DATE, amount: z.number().int().positive().max(1_000_000) }))
              .max(31)
              .optional()
              .describe('석식대 — [] 이면 석식 항목 없음'),
          })
          .optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      let fill: ApprovalFormFill;
      if (args.kind === 'overtime') {
        const o = args.overtime ?? {};
        if (o.start_time && o.end_time && o.end_time <= o.start_time) return fail('종료 시각이 시작보다 빠릅니다.');
        fill = { kind: 'overtime', date: o.date, startTime: o.start_time, endTime: o.end_time, target: o.target, content: o.content, reason: o.reason };
      } else if (args.kind === 'vacation') {
        const v = args.vacation ?? {};
        if (v.from_date && v.to_date && v.to_date < v.from_date) return fail('종료일자가 시작일자보다 빠릅니다.');
        if (v.att_div_name === '대체휴가' && !v.holiday_work_date) return fail('대체휴가는 근거 휴일근무일(holiday_work_date)이 필요합니다 — 사용자에게 물어보세요.');
        fill = {
          kind: 'vacation',
          attDivName: v.att_div_name,
          fromDate: v.from_date,
          toDate: v.to_date,
          useStartTime: v.use_start_time,
          useEndTime: v.use_end_time,
          holidayWorkDate: v.holiday_work_date,
          reason: v.reason,
          reasonEtc: v.reason_etc,
          remark: v.remark,
        };
      } else {
        const e = args.expend ?? {};
        fill = {
          kind: 'expend',
          month: e.month,
          parking: e.parking === undefined ? undefined : e.parking && { manCount: e.parking.man_count, halfCount: e.parking.half_count },
          dinners: e.dinners,
        };
      }
      const busy = approvalLockOwner();
      if (!sendOpenRequest({ kind: 'approval', fill })) return fail('앱 창이 없어 폼을 띄우지 못했습니다.');
      const label = { overtime: '야근 결재', vacation: '휴가신청서', expend: '지출결의서' }[args.kind];
      return json({
        ok: true,
        opened: 'approval_form',
        kind: args.kind,
        note:
          (busy ? `⚠️ 지금 다른 결재 작성(${busy})이 진행 중이라 [작성 시작]은 그게 끝난 뒤 됩니다. ` : '') +
          `${label} 폼을 채워 띄웠습니다 — 사용자가 확인하고 [작성 시작]을 누른 뒤 그룹웨어 창에서 직접 상신합니다.` +
          (args.kind === 'vacation' ? ' (휴가는 [작성 시작]이 근태신청을 서버에 저장합니다)' : ''),
      });
    },
  );

  server.registerTool(
    'open_schedule',
    {
      title: '일정 등록 화면 채우기',
      description:
        '원앱 일정 등록 섹션의 작업 기록에 항목을 **덧붙이고**(같은 종료 시각·제목은 건너뜀, 써 둔 기록은 그대로) 날짜·시작 시각을 맞춰 연다 — ' +
        '**등록하지 않는다**(사용자가 [일정 등록]·[노션에 기록]). 항목 = 종료 시각(HH:MM)·일정명.',
      inputSchema: {
        items: z
          .array(z.object({ end: TIME.describe('그 일이 끝난 시각'), title: z.string().min(1).max(200) }))
          .max(30)
          .optional(),
        start_time: TIME.optional().describe('하루 시작 시각 — 사용자가 말했을 때만'),
        date: z
          .union([z.enum(['today', 'yesterday']), DATE])
          .optional()
          .describe("'today' · 'yesterday' · YYYY-MM-DD — 없으면 화면 그대로(기본 오늘)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ items, start_time, date }) => {
      if (!items?.length && !start_time && !date) return fail('채울 값이 없습니다 — items·start_time·date 중 하나는 주세요.');
      const fill: ScheduleFill = { items, startTime: start_time, date };
      if (!sendOpenRequest({ kind: 'schedule', fill })) return fail('앱 창이 없어 화면을 띄우지 못했습니다.');
      return json({
        ok: true,
        opened: 'schedule',
        added: items?.length ?? 0,
        note: '일정 등록 화면에 덧붙여 띄웠습니다 — 사용자가 확인하고 [일정 등록]을 눌러야 등록됩니다.',
      });
    },
  );
}
