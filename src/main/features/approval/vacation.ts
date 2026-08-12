// 휴가신청서 작성 → 상신.
//
// 전자결재가 아니라 **근태 서브시스템**(/attend/)의 신청 화면이다 (2026-08 실측).
//   Step01 기본정보(신청자·제목·일정등록) → Step02 신청정보(근태구분·신청일자·비고)
//   → [내역추가](addAnnualLeave) → Step03 그리드에 한 줄 추가
//   → [결재상신](save) → 근태신청 저장(ajax) + 전자결재 문서 창 window.open + self.close()
//
// 마지막 단계에서 **작성 창이 스스로 닫히며 전자결재 창을 연다**. 그 창에서 [상신]까지 눌러
// 완료하고, 자동으로 마무리하지 못하면 창을 사용자에게 넘긴다(결재는 언제나 사용자 몫).
import {
  closePage,
  evalInPage,
  openPage,
  releasePage,
  takeAlerts,
  waitInPage,
  type Page,
} from '../../lib/browser';
import { VACATION_CONFIG, WORKER_DEPT } from './config';
import { gotoAsUser } from './gw';
import { closeKeptPage, keepPage } from './keeper';
import { sleep } from '../../lib/util';
import type {
  VacationInput,
  VacationResult,
  VacationStatus,
} from '../../../shared/types';

/** 동시 실행 방지 */
let running = false;

/** 제목에 쓰는 부문 문구 — 근무자 소속("플랫폼서비스사업부문 FE")의 앞부분 */
const WORKER_DIVISION = WORKER_DEPT.split(/\s+/)[0];

/** 신청자 표시("[(주)포비즈코리아/FE] 정수범") → 이름·챕터 */
export function parseApplicant(text: string): { name: string; chapter: string } {
  const m = text.match(/\[([^\]]*)\]\s*(.+)$/);
  if (!m) return { name: text.trim(), chapter: '' };
  const chapter = (m[1].split('/').pop() ?? '').trim();
  return { name: m[2].trim(), chapter };
}

/**
 * 제목 문구 — 휴가 신청서 작성 표기 표준(렌더러 calc.ts 의 vacationTitle 과 같은 형식).
 * 제목에 성명·사용 날짜를 적고, 시차·반차는 정확한 시간대를, 대체휴가는 휴일근무일을 명시한다.
 *   [연차] 정수범_8월 12일 · [반차] 정수범_8월 12일 (09:00~14:00)
 *   [대체휴가] 정수범_8월 12일 (휴일근무일: 08/09)
 * 기간이 여러 날이면 끝 날짜를 함께 적는다 — 8월 12일~8월 13일
 */
export function formatVacationTitle(opts: {
  attDivName: string;
  name: string;
  fromDate: string;
  toDate: string;
  useStartTime?: string;
  useEndTime?: string;
  holidayWorkDate?: string;
}): string {
  const dayText = (d: string) => {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${Number(m[2])}월 ${Number(m[3])}일` : d;
  };
  // "YYYY-MM-DD" → "08/09" (휴일근무일 표기)
  const shortDayText = (d: string) => {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[2]}/${m[3]}` : d;
  };
  const tag = /시차/.test(opts.attDivName)
    ? '시차'
    : /반차/.test(opts.attDivName)
      ? '반차'
      : opts.attDivName;
  const period =
    opts.fromDate === opts.toDate
      ? dayText(opts.fromDate)
      : `${dayText(opts.fromDate)}~${dayText(opts.toDate)}`;
  const extra =
    /반차|시차/.test(opts.attDivName) && opts.useStartTime && opts.useEndTime
      ? ` (${opts.useStartTime}~${opts.useEndTime})`
      : opts.attDivName === '대체휴가' && opts.holidayWorkDate
        ? ` (휴일근무일: ${shortDayText(opts.holidayWorkDate)})`
        : '';
  return `[${tag}] ${opts.name}_${period}${extra}`;
}

/** 양식 로드 대기 — 신청자·제목·콤보 위젯이 모두 준비될 때까지 */
async function waitFormReady(page: Page) {
  const sel = VACATION_CONFIG.selectors;
  await waitInPage(
    page,
    (nameSel: string, titleSel: string, gtSel: string, schSel: string) => {
      const names = document.querySelector(nameSel);
      if (!names || !(names.textContent ?? '').trim()) return false;
      if (!document.querySelector(titleSel)) return false;
      const w = window as unknown as {
        jQuery?: (s: string) => { data?: (k: string) => unknown };
      };
      if (!w.jQuery) return false;
      // 근태구분·일정등록 콤보는 서버 조회로 채워지므로 데이터가 올 때까지 기다린다
      const combo = (s: string) =>
        w.jQuery?.(s).data?.('kendoComboBox') as
          | { dataSource?: { data: () => unknown[] } }
          | undefined;
      const gt = combo(gtSel);
      const sch = combo(schSel);
      return (
        !!gt?.dataSource?.data().length && !!sch?.dataSource?.data().length
      );
    },
    [sel.applicantText, sel.title, sel.attDivCombo, sel.scheduleCombo],
    { timeout: 45000, label: '휴가신청서 양식 로드' },
  );
}

/** 신청자 표시 문구 읽기 */
async function readApplicant(page: Page): Promise<string> {
  const text = await evalInPage(
    page,
    (sel: string) =>
      (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    [VACATION_CONFIG.selectors.applicantText],
  );
  if (!text) {
    throw new Error('신청자 정보를 읽지 못했습니다 — 화면이 바뀌었을 수 있습니다.');
  }
  return text;
}

/** 연차 현황 읽기 (총·사용·잔여·결재중) */
async function readStatus(
  page: Page,
): Promise<Omit<VacationStatus, 'name' | 'chapter' | 'division'>> {
  const sel = VACATION_CONFIG.selectors;
  return evalInPage(
    page,
    (totalSel: string, usedSel: string, restSel: string, proSel: string) => {
      const txt = (s: string) =>
        (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, '').trim();
      return {
        total: txt(totalSel),
        used: txt(usedSel),
        rest: txt(restSel),
        progress: txt(proSel),
      };
    },
    [sel.totalAnnv, sel.usedAnnv, sel.restAnnv, sel.progressAnnv],
  );
}

/**
 * Kendo ComboBox 값 선택 — 표시 문구로 찾아 value 까지 반영한다.
 * ⚠️ input.value 에 직접 쓰면 위젯 내부 모델이 갱신되지 않아 저장 시 코드가 비어 나간다.
 */
async function pickCombo(
  page: Page,
  selector: string,
  wanted: string,
  label: string,
) {
  const result = await evalInPage(
    page,
    (sel: string, want: string) => {
      const w = window as unknown as {
        jQuery?: (s: string) => { data?: (k: string) => unknown };
      };
      const cb = w.jQuery?.(sel).data?.('kendoComboBox') as
        | {
            dataSource: { data: () => Record<string, unknown>[] };
            options: { dataTextField: string; dataValueField: string };
            value: (v: string) => void;
            text: (v: string) => void;
            trigger: (e: string) => void;
          }
        | undefined;
      if (!cb) return { ok: false, reason: 'NO_WIDGET', names: [] as string[] };
      const textField = cb.options.dataTextField;
      const valueField = cb.options.dataValueField;
      const rows = cb.dataSource.data();
      const names = rows.map((r) => String(r[textField] ?? ''));
      const squash = (s: string) => s.replace(/\s+/g, '');
      const hit =
        rows.find((r) => squash(String(r[textField] ?? '')) === squash(want)) ??
        rows.find((r) => squash(String(r[textField] ?? '')).includes(squash(want)));
      if (!hit) return { ok: false, reason: 'NO_MATCH', names };
      cb.value(String(hit[valueField] ?? ''));
      cb.text(String(hit[textField] ?? ''));
      cb.trigger('change');
      return { ok: true, reason: '', names };
    },
    [selector, wanted],
  );
  if (!result.ok) {
    const list = result.names.slice(0, 12).join(' / ');
    throw new Error(
      result.reason === 'NO_WIDGET'
        ? `${label} 입력칸을 찾지 못했습니다 — 화면이 바뀌었을 수 있습니다.`
        : `${label}에서 '${wanted}' 을 찾지 못했습니다. 목록: ${list}`,
    );
  }
}

/**
 * Kendo DatePicker 에 날짜를 넣는다.
 * 신청일수·연차차감은 화면이 change 를 받아 서버 조회로 계산하므로 change 발화가 필수다.
 */
async function setDate(page: Page, selector: string, value: string, label: string) {
  const ok = await evalInPage(
    page,
    (sel: string, v: string) => {
      const w = window as unknown as {
        jQuery?: (s: string) => { data?: (k: string) => unknown };
      };
      const dp = w.jQuery?.(sel).data?.('kendoDatePicker') as
        | { value: (v: Date) => void; trigger: (e: string) => void }
        | undefined;
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!dp || !m) return false;
      dp.value(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      dp.trigger('change');
      const el = document.querySelector(sel) as HTMLInputElement | null;
      el?.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    [selector, value],
  );
  if (!ok) throw new Error(`${label}를 입력하지 못했습니다(${value}).`);
}

/** 일반 입력칸 채우기 */
async function setText(page: Page, selector: string, value: string) {
  await evalInPage(
    page,
    (sel: string, v: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    [selector, value],
  );
}

/** 화면이 계산해 넣는 신청일수·연차차감을 기다렸다가 읽는다 */
async function waitCalculated(
  page: Page,
): Promise<{ dayCount: string; useDayCount: string }> {
  const sel = VACATION_CONFIG.selectors;
  await waitInPage(
    page,
    (daySel: string) => {
      const el = document.querySelector(daySel) as HTMLInputElement | null;
      return !!el && !!el.value.trim() && el.value.trim() !== '0';
    },
    [sel.dayCount],
    { timeout: 20000, label: '신청일수 계산' },
  );
  return evalInPage(
    page,
    (daySel: string, useSel: string) => {
      const v = (s: string) =>
        ((document.querySelector(s) as HTMLInputElement | null)?.value ?? '').trim();
      return { dayCount: v(daySel), useDayCount: v(useSel) };
    },
    [sel.dayCount, sel.useDayCount],
  );
}

/** Step03 그리드의 행 수 */
async function gridRowCount(page: Page): Promise<number> {
  return evalInPage(
    page,
    (gridSel: string) => {
      const w = window as unknown as {
        jQuery?: (s: string) => { data?: (k: string) => unknown };
      };
      const g = w.jQuery?.(gridSel).data?.('kendoGrid') as
        | { dataSource: { data: () => unknown[] } }
        | undefined;
      return g ? g.dataSource.data().length : -1;
    },
    [VACATION_CONFIG.selectors.grid],
  );
}

/** [내역추가] — 그리드에 행이 늘어나면 성공 */
async function addRequestRow(page: Page) {
  const before = await gridRowCount(page);
  await takeAlerts(page); // 이전 안내는 비우고 시작
  await evalInPage(
    page,
    (wantText: string) => {
      const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
      const btn = Array.from(
        document.querySelectorAll('button, input[type=button]'),
      ).find((b) =>
        squash((b as HTMLInputElement).value + (b.textContent ?? '')).includes(
          squash(wantText),
        ),
      );
      (btn as HTMLElement | null)?.click();
      return true;
    },
    [VACATION_CONFIG.addBtnText],
  );

  // 서버 중복확인(ajax) 후 행이 추가되므로 잠깐 기다린다
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if ((await gridRowCount(page)) > before) return;
    const alerts = await takeAlerts(page);
    if (alerts.length) {
      throw new Error(`그룹웨어 안내: ${alerts.join(' / ')}`);
    }
    await sleep(500);
  }
  throw new Error(
    '신청내역이 추가되지 않았습니다 — 근태구분·신청일자를 확인해 주세요.',
  );
}

/** "YYYY-MM-DD" → "2026 년 8 월 27 일" (본문 표기) */
function docDateText(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  return `${m[1]} 년 ${Number(m[2])} 월 ${Number(m[3])} 일`;
}

/** 오늘 날짜의 본문 표기 (작성 년월일) */
function todayDocText(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return docDateText(
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  );
}

/** 폼 입력 + 그룹웨어가 계산한 신청일수 → 본문에 넣을 문구들 */
export function buildDocBody(input: VacationInput, dayCount: string): DocBody {
  const mapped = VACATION_CONFIG.attDivToDocKind[input.attDivName];
  const isEtcReason = input.reason === '기타';
  return {
    // 표에 없는 근태구분(공가 등)은 '기타' 에 체크하고 괄호에 원래 문구를 넣는다
    kind: mapped ?? '기타',
    kindEtc: mapped ? '' : input.attDivName,
    reason: input.reason,
    reasonEtc: isEtcReason ? (input.reasonEtc ?? '').trim() : '',
    period:
      `${docDateText(input.fromDate)} 부터  ${docDateText(input.toDate)} 까지 ` +
      `( ${dayCount || '1'} 일간)`,
    emergency: input.emergencyContact.trim(),
    handovers: input.handovers
      .filter((h) => h.project.trim() || h.members.trim())
      .map((h) => `${h.project.trim()}: ${h.members.trim()}`),
    writtenOn: todayDocText(),
  };
}

/** 본문(에디터) 표에 채워 넣을 값 묶음 */
type DocBody = {
  kind: string; // 종류 체크 항목 문구
  kindEtc: string; // 종류가 '기타' 일 때 괄호 문구 (없으면 빈 값)
  reason: string; // 사유 체크 항목 문구
  reasonEtc: string; // 사유가 '기타' 일 때 괄호 문구
  period: string; // 기간 한 줄 문구
  emergency: string; // 비상연락망
  handovers: string[]; // 인수인계 줄들
  writtenOn: string; // 작성 년월일 문구
};

/**
 * 전자결재 본문(이중 iframe 안 contentEditable)의 휴가신청서 표를 채운다.
 *
 * ⚠️ 체크박스에 id·name 이 없다 — `<span contenteditable="false"><input type="checkbox"></span>`
 *    뒤에 오는 **텍스트를 라벨로 삼아** 찾는다(2026-08 실측 구조).
 * 반환값은 채우지 못한 항목 목록(비면 전부 성공).
 */
async function fillDocBody(eaPage: Page, body: DocBody): Promise<string[]> {
  const ea = VACATION_CONFIG.eaDoc;
  const heads = VACATION_CONFIG.docRowHeads;
  return evalInPage(
    eaPage,
    (frameSel: string, innerSel: string, b: DocBody, h: typeof heads) => {
      const missed: string[] = [];
      const outer = document.querySelector(frameSel) as HTMLIFrameElement | null;
      const innerFrame = outer?.contentWindow?.document.querySelector(
        innerSel,
      ) as HTMLIFrameElement | null;
      const doc = innerFrame?.contentWindow?.document;
      if (!doc) return ['본문 에디터'];

      // \u00a0(&nbsp;)를 일반 공백으로 바꾼 뒤 공백을 전부 지워 비교한다
      const squash = (s: string | null | undefined) =>
        (s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, '').trim();

      // 행 머리글로 행 찾기
      const rows = Array.from(
        doc.querySelectorAll("table tr"),
      ) as HTMLTableRowElement[];
      const rowOf = (head: string) =>
        rows.find((r) => squash(r.cells[0]?.textContent) === squash(head)) ?? null;

      // 체크박스 라벨 — 감싼 span 다음에 오는 텍스트를 다음 체크박스 전까지 모은다
      const labelOf = (box: Element) => {
        const anchor = box.closest('span') ?? box;
        let t = '';
        let n: Node | null = anchor.nextSibling;
        while (n && t.length < 40) {
          if (
            n.nodeType === 1 &&
            (n as Element).querySelector?.('input[type=checkbox]')
          ) {
            break;
          }
          t += n.textContent ?? '';
          n = n.nextSibling;
        }
        return t;
      };

      /** 행 안에서 라벨이 맞는 체크박스를 켠다 */
      const check = (rowHead: string, want: string, label: string) => {
        const row = rowOf(rowHead);
        if (!row) {
          missed.push(label);
          return null;
        }
        const boxes = Array.from(
          row.querySelectorAll('input[type=checkbox]'),
        ) as HTMLInputElement[];
        const hit =
          boxes.find((x) => squash(labelOf(x)) === squash(want)) ??
          boxes.find((x) => squash(labelOf(x)).startsWith(squash(want)));
        if (!hit) {
          missed.push(`${label}(${want})`);
          return null;
        }
        hit.checked = true;
        hit.setAttribute('checked', 'checked'); // 저장은 HTML 직렬화로 가므로 속성도 박아둔다
        return hit;
      };

      /** '기타( )' 괄호 안에 문구를 넣는다 */
      const fillEtc = (box: HTMLInputElement | null, text: string) => {
        if (!box || !text) return;
        const anchor = box.closest('span') ?? box;
        // 라벨 텍스트 노드들 중 괄호를 가진 것을 찾아 채운다
        let n: Node | null = anchor.nextSibling;
        while (n) {
          if (n.nodeType === 3 && /\(\s*\)/.test(n.textContent ?? '')) {
            n.textContent = (n.textContent ?? '').replace(
              /\(\s*\)/,
              `( ${text} )`,
            );
            return;
          }
          if (
            n.nodeType === 1 &&
            (n as Element).querySelector?.('input[type=checkbox]')
          ) {
            break;
          }
          n = n.nextSibling;
        }
      };

      // ① 종류
      const kindBox = check(h.kind, b.kind, '종류');
      if (b.kindEtc) fillEtc(kindBox, b.kindEtc);

      // ② 사유
      const reasonBox = check(h.reason, b.reason, '사유');
      if (b.reasonEtc) fillEtc(reasonBox, b.reasonEtc);

      // ③ 기간 — 문단의 텍스트만 갈아끼워 서식을 유지한다
      const setCellText = (rowHead: string, lines: string[], label: string) => {
        const row = rowOf(rowHead);
        const cell = row?.cells[1];
        if (!cell) {
          missed.push(label);
          return;
        }
        const proto = cell.querySelector('p');
        const style = proto?.getAttribute('style') ?? '';
        cell.innerHTML = lines
          .map(
            (t) =>
              `<p style="${style}">${t
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}</p>`,
          )
          .join('');
      };
      setCellText(h.period, [b.period], '기간');
      setCellText(h.emergency, [b.emergency], '비상연락망');
      if (b.handovers.length) setCellText(h.handover, b.handovers, '인수인계');

      // ④ 작성 년월일 — "2026 년  월  일" 만 있는 문단을 찾아 채운다
      const blank = Array.from(doc.querySelectorAll('p')).find((p) =>
        /^\d{4}년월일$/.test(squash(p.textContent)),
      );
      if (blank) {
        const style = blank.getAttribute('style') ?? '';
        blank.outerHTML = `<p style="${style}">${b.writtenOn}</p>`;
      } else {
        missed.push('작성일자');
      }

      return missed;
    },
    [ea.editorFrame, ea.editorInnerFrame, body, heads],
  ).catch((): string[] => ['본문 작성']);
}

/**
 * [결재상신] 이후 열리는 전자결재 문서 창을 **상신 직전 상태까지** 준비한다.
 * (마지막 [상신] 은 사용자가 눈으로 확인하고 누른다 — 세 결재 공통 방침)
 *
 * 이 창은 about:blank 로 먼저 열리고, ajax 3회(근태신청 저장 → 문서 생성 → 문서 id 연결)가
 * 끝난 뒤에야 전자결재 화면으로 이동한다. 그래서 URL 이 아니라 **요소가 나타날 때까지** 기다린다.
 */
async function prepareEaWindow(
  eaPage: Page,
  title: string,
  body: DocBody,
  onStep?: (step: string) => void,
): Promise<{ ready: boolean; missed: string[] }> {
  const ea = VACATION_CONFIG.eaDoc;
  onStep?.('전자결재 문서 만드는 중…');
  await waitInPage(
    eaPage,
    (draftSel: string, titleSel: string) =>
      !!document.querySelector(draftSel) || !!document.querySelector(titleSel),
    [ea.draftBtn, ea.title],
    { timeout: 60000, label: '전자결재 문서 창' },
  );

  onStep?.('전자결재 내용 채우는 중…');
  // 제목이 비어 있으면 채운다 (근태 화면에서 넘긴 docTitle 이 들어오지만 비는 경우 대비).
  // 품의번호·결재라인은 양식 기본값이 비동기로 채워지므로 값이 붙을 때까지 기다린다.
  await evalInPage(
    eaPage,
    (titleSel: string, text: string) => {
      const el = document.querySelector(titleSel) as HTMLInputElement | null;
      if (el && !el.value.trim()) {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    },
    [ea.title, title],
  ).catch((): void => undefined);

  // 상신 가드가 검사하는 값이 다 붙어야 사용자가 [상신] 을 눌러도 통과한다.
  // ⚠️ 에디터(이중 iframe)까지 기다리는 게 핵심 — 로딩 중에 [상신] 하면 경고만 뜨고
  //    조용히 무시된다(연장근무내역서에서 겪은 것과 같은 함정. 2026-08 실측).
  // 못 붙어도 창은 넘긴다 — 사용자가 화면에서 직접 지정하면 되기 때문이다.
  const ready = await waitInPage(
    eaPage,
    (
      numSel: string,
      lineSel: string,
      draftSel: string,
      frameSel: string,
      innerSel: string,
    ) => {
      if (!document.querySelector(draftSel)) return false;
      const num = document.querySelector(numSel) as HTMLSelectElement | null;
      if (num && !num.value) return false;
      const line = document.querySelector(lineSel) as HTMLInputElement | null;
      if (!line || !line.value || line.value === '[]') return false;
      // 에디터 본문(이중 iframe)이 뜰 때까지 — 없으면 아직 loading 상태다
      const outer = document.querySelector(frameSel) as HTMLIFrameElement | null;
      if (!outer) return true; // 이 양식에 에디터가 없으면 통과
      const inner = outer.contentWindow?.document.querySelector(
        innerSel,
      ) as HTMLIFrameElement | null;
      return !!inner?.contentWindow?.document.body;
    },
    [
      ea.numberingSelect,
      ea.appLineHidden,
      ea.draftBtn,
      ea.editorFrame,
      ea.editorInnerFrame,
    ],
    { timeout: 45000, label: '전자결재 결재선·본문' },
  )
    .then((): boolean => true)
    .catch((): boolean => false);

  // 본문 표(종류·사유·기간·비상연락망·인수인계·작성일자) 채우기 —
  // 에디터가 준비되지 않았으면 건너뛴다(사용자가 직접 쓸 수 있게 창은 넘긴다)
  const missed = ready ? await fillDocBody(eaPage, body) : ['본문(에디터 미준비)'];
  return { ready, missed };
}

/** 사용자에게 창을 넘긴다 (자동화 장치 제거 + 안내 제목) */
async function handOver(page: Page, title: string) {
  await releasePage(page).catch((): void => undefined);
  page.win.setTitle(title);
  page.win.show();
  page.win.focus();
  keepPage(page);
}

/**
 * 휴가신청서 작성 → [내역추가] → [결재상신] → 전자결재 문서 창 준비까지.
 * **마지막 [상신] 은 누르지 않고** 창을 사용자에게 넘긴다.
 *
 * ⚠️ [결재상신] 은 작성 창을 닫으면서 전자결재 창을 연다. 그래서 이 시점 이후로는
 *    `page` 가 파괴될 수 있고, 이어지는 작업은 새로 열린 창(popup)에서 해야 한다.
 */
export async function runVacationDraft(
  input: VacationInput,
  onStep?: (step: string) => void,
): Promise<VacationResult> {
  if (running) throw new Error('이미 휴가신청서 작업이 진행 중입니다.');
  running = true;
  const step = (s: string) => onStep?.(s);
  const sel = VACATION_CONFIG.selectors;

  closeKeptPage();

  // 작성 과정을 사용자가 보도록 띄운다. save() 가 window.open 을 쓰므로 팝업 허용도 필수
  const page = await openPage(true, { allowPopups: true });
  let handed = false;
  try {
    step('휴가신청서 양식 여는 중…');
    await gotoAsUser(page, VACATION_CONFIG.formUrl);
    await waitFormReady(page);

    step('양식 작성 중…');
    const applicantText = await readApplicant(page);
    const { name } = parseApplicant(applicantText);
    const title =
      input.title.trim() ||
      formatVacationTitle({
        attDivName: input.attDivName,
        name,
        fromDate: input.fromDate,
        toDate: input.toDate,
        useStartTime: input.useStartTime,
        useEndTime: input.useEndTime,
        holidayWorkDate: input.holidayWorkDate,
      });

    await setText(page, sel.title, title);
    await pickCombo(
      page,
      sel.scheduleCombo,
      input.calendarText?.trim() || VACATION_CONFIG.defaultCalendarText,
      '일정등록',
    );
    await pickCombo(page, sel.attDivCombo, input.attDivName, '근태구분');
    await setDate(page, sel.fromDate, input.fromDate, '시작일자');
    await setDate(page, sel.toDate, input.toDate, '종료일자');
    if (input.remark.trim()) await setText(page, sel.remark, input.remark.trim());

    const calc = await waitCalculated(page);

    step('신청내역 추가 중…');
    await addRequestRow(page);

    // [결재상신] — 이 창은 스스로 닫히며 전자결재 창을 연다 (fireInPage 가 아니라 evalInPage 로도
    // 반환되지만, 창이 파괴될 수 있으므로 실패를 삼키고 팝업 등장으로 판정한다)
    step('결재상신 누르는 중…');
    await takeAlerts(page);
    await evalInPage(
      page,
      (btnSel: string) => {
        (document.querySelector(btnSel) as HTMLElement | null)?.click();
        return true;
      },
      [sel.sendBtn],
    ).catch((): void => undefined);

    // 전자결재 창 등장 대기 — 작성 창이 닫히는 것과 경쟁하므로 popups 를 폴링한다
    step('전자결재 창 기다리는 중…');
    const deadline = Date.now() + 40000;
    let eaPage: Page | null = null;
    while (Date.now() < deadline) {
      eaPage = page.popups.find((p) => !p.win.isDestroyed()) ?? null;
      if (eaPage) break;
      // 창이 닫히지도 팝업이 열리지도 않았다면 검증 경고일 수 있다
      if (!page.win.isDestroyed()) {
        const alerts = await takeAlerts(page).catch((): string[] => []);
        if (alerts.length) throw new Error(`그룹웨어 안내: ${alerts.join(' / ')}`);
      }
      await sleep(500);
    }
    if (!eaPage) {
      throw new Error(
        '결재상신 후 전자결재 창이 열리지 않았습니다 — 그룹웨어 결재함을 확인해 주세요.',
      );
    }

    // 전자결재 문서 창을 상신 직전까지 준비하고 사용자에게 넘긴다 (마지막 [상신] 은 사용자 몫)
    const prepared = await prepareEaWindow(
      eaPage,
      title,
      buildDocBody(input, calc.dayCount),
      onStep,
    ).catch((): { ready: boolean; missed: string[] } => ({
      ready: false,
      missed: ['전자결재 창'],
    }));
    await handOver(
      eaPage,
      prepared.ready && !prepared.missed.length
        ? '전자결재 — 내용 확인 후 [상신] 하세요'
        : '전자결재 — 빠진 항목을 채우고 [상신] 하세요',
    );
    handed = true;
    return {
      ok: true,
      title,
      dayCount: calc.dayCount,
      useDayCount: calc.useDayCount,
      eaReady: prepared.ready,
      missed: prepared.missed.length ? prepared.missed : undefined,
    };
  } catch (err) {
    // 실패해도 창은 남겨 사용자가 상태를 확인하고 이어서 처리할 수 있게 한다
    if (!page.win.isDestroyed()) {
      await handOver(page, '휴가신청서 — 작성 중 문제 발생');
      handed = true;
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    running = false;
    if (!handed && !page.win.isDestroyed()) closePage(page);
  }
}

/**
 * 연차 현황 + 신청자 정보 조회 — 잔여연차 표시와 제목 미리보기에 쓴다.
 * (제목의 이름·소속은 그룹웨어 화면에서만 알 수 있어 폼을 한 번 열어야 한다)
 */
export async function fetchVacationStatus(): Promise<VacationStatus> {
  if (running) throw new Error('휴가신청서 작업이 진행 중입니다.');
  const page = await openPage(false, { allowPopups: true });
  try {
    await gotoAsUser(page, VACATION_CONFIG.formUrl);
    await waitFormReady(page);
    const status = await readStatus(page);
    const { name, chapter } = parseApplicant(await readApplicant(page));
    return { ...status, name, chapter, division: WORKER_DIVISION };
  } finally {
    closePage(page);
  }
}
