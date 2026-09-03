// 야근 결재 — 자동화 창으로 그룹웨어 전자결재 '연장근무내역서'를 작성해 상신한다.
// 결재선 기본값이 '본인'이라 상신 후 미결함에서 본인이 승인하면 끝 (승인은 사용자가 직접).
import {
  closePage,
  evalInPage,
  openPage,
  releasePage,
  waitInPage,
  type Page,
} from '../../lib/browser';
import { OVERTIME_CONFIG } from './config';
import { gotoAsUser } from './gw';
import { closeKeptPage, keepPage } from './keeper';
import { getWorkerDept } from './store';
// 시간합계 문구는 렌더러 폼과 공유한다 (미리보기와 실제 입력이 같아야 한다)
import { formatHoursTotal } from '../../../shared/approval-format';
import { pad2 } from '../../../shared/date';
import type { OvertimeSubmitInput } from '../../../shared/types';

export { formatHoursTotal };

/** 동시 실행 방지 (자동화 창 중복 기동 막기) */
let running = false;

/** 제목 문구 — 그룹웨어 양식 기본 제목 패턴 + 0패딩 (예: 07월 01일 09시 00분) */
export function formatTitle(name: string, input: OvertimeSubmitInput): string {
  const [, month, day] = input.date.split('-').map(Number);
  const part = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return `${pad2(h)}시 ${pad2(m)}분`;
  };
  return `[연장근무내역] ${name}_${pad2(month)}월 ${pad2(day)}일 ${part(input.startTime)}~${part(input.endTime)}`;
}

/**
 * 양식 팝업 로드 대기 — 제목 입력·에디터 본문(근무자 표)에 더해
 * 상신 가드가 검사하는 비동기 값(품의번호·결재라인)까지 채워져야 한다.
 * (이게 로드되기 전에 [상신]을 누르면 경고만 뜨고 조용히 무시된다)
 */
async function waitFormReady(page: Page) {
  const sel = OVERTIME_CONFIG.selectors;
  await waitInPage(
    page,
    (
      titleSel: string,
      frameSel: string,
      innerSel: string,
      numSel: string,
      lineSel: string,
      draftSel: string,
    ) => {
      if (!document.querySelector(titleSel)) return false;
      // 에디터 본문 준비 (이중 iframe)
      const outer = document.querySelector(frameSel) as HTMLIFrameElement | null;
      const innerDoc = outer?.contentWindow?.document.querySelector(
        innerSel,
      ) as HTMLIFrameElement | null;
      const body = innerDoc?.contentWindow?.document.body;
      if (!body || !/근무자/.test(body.textContent ?? '')) return false;
      // 품의번호(기본채번) 로드
      const num = document.querySelector(numSel) as HTMLSelectElement | null;
      if (!num || !num.value) return false;
      // 결재라인 JSON 로드 (본인 결재선)
      const line = document.querySelector(lineSel) as HTMLInputElement | null;
      if (!line || !line.value || line.value === '[]') return false;
      // [상신] 클릭 핸들러 바인딩 완료 (jQuery 이벤트 데이터로 확인)
      const w = window as unknown as {
        jQuery?: {
          _data?: (el: Element, key: string) => { click?: unknown[] } | undefined;
        };
      };
      const btn = document.querySelector(draftSel);
      if (!btn || !w.jQuery?._data) return false;
      const events = w.jQuery._data(btn, 'events');
      return !!events?.click?.length;
    },
    [
      sel.title,
      sel.editorFrame,
      sel.editorInnerFrame,
      sel.numberingSelect,
      sel.appLineHidden,
      sel.draftBtn,
    ],
    { timeout: 45000, label: '연장근무내역서 양식 로드' },
  );
}

/** 양식에서 기안자 이름을 읽는다 (제목·근무자 표의 성명에 사용) */
async function readDrafterName(page: Page): Promise<string> {
  const name = await evalInPage(
    page,
    () => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
      const p = Array.from(document.querySelectorAll('td p')).find(
        (el) => norm(el.textContent) === '기안자',
      );
      const cell = p?.closest('td')?.nextElementSibling as HTMLElement | null;
      return (cell?.textContent ?? '').trim();
    },
    [],
  );
  if (!name) {
    throw new Error(
      '기안자 정보를 읽지 못했습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
    );
  }
  return name;
}

type WorkerRow = {
  dept: string;
  name: string;
  date: string;
  time: string;
  total: string;
};

/** 제목 + 에디터 본문(근무자 표·업무내용)을 채운다 */
async function fillForm(
  page: Page,
  input: OvertimeSubmitInput,
  drafterName: string,
  title: string,
) {
  const sel = OVERTIME_CONFIG.selectors;
  const workerRow: WorkerRow = {
    // 환경설정의 '결재 소속' — 단독 배포판을 쓰는 다른 챕터 동료는 여기서 바꾼다
    dept: getWorkerDept(),
    name: drafterName,
    date: input.date,
    time: `${input.startTime} ~ ${input.endTime}`,
    total: formatHoursTotal(input.startTime, input.endTime),
  };
  const result = await evalInPage(
    page,
    (
      titleSel: string,
      frameSel: string,
      innerSel: string,
      titleText: string,
      row: WorkerRow,
      biz: { target: string; content: string; reason: string },
    ) => {
      // 1) 제목
      const titleInput = document.querySelector(titleSel) as HTMLInputElement | null;
      if (!titleInput) return 'NO_TITLE';
      titleInput.value = titleText;
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      titleInput.dispatchEvent(new Event('change', { bubbles: true }));

      // 2) 에디터 본문 — 이중 iframe 안 contentEditable 문서를 직접 수정
      const outer = document.querySelector(frameSel) as HTMLIFrameElement | null;
      const innerFrame = outer?.contentWindow?.document.querySelector(
        innerSel,
      ) as HTMLIFrameElement | null;
      const doc = innerFrame?.contentWindow?.document;
      if (!doc) return 'NO_EDITOR';

      const rows = Array.from(doc.querySelectorAll('table tr'));
      // 근무자 데이터 행: 헤더(소속·성명·연장근무일…) 행의 다음 행
      const headerRow = rows.find(
        (r) => /소\s*속/.test(r.textContent ?? '') && /연장근무일/.test(r.textContent ?? ''),
      );
      const dataRow = headerRow?.nextElementSibling as HTMLTableRowElement | null;
      if (!dataRow) return 'NO_DATA_ROW';
      const values = [row.dept, row.name, row.date, row.time, row.total];
      Array.from(dataRow.cells).forEach((td, i) => {
        if (values[i]) {
          const p = td.querySelector('p') ?? td;
          p.textContent = values[i];
        }
      });

      // 업무내용: '■ 업무내용' 행의 다음 행 셀을 통째로 교체 (예시 문구 제거)
      const bizHeader = rows.find((r) => /■\s*업무내용/.test(r.textContent ?? ''));
      const bizRow = bizHeader?.nextElementSibling as HTMLTableRowElement | null;
      if (!bizRow) return 'NO_BIZ_ROW';
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // 여러 줄 입력은 줄마다 문단으로
      const lines = (label: string, text: string) =>
        text
          .split('\n')
          .filter((l, i) => i === 0 || l.trim().length > 0)
          .map((l, i) =>
            i === 0
              ? `<p><span>-${label} : ${esc(l.trim())}</span></p>`
              : `<p><span>${esc(l.trim())}</span></p>`,
          )
          .join('');
      bizRow.cells[0].innerHTML =
        lines('업무 대상', biz.target) +
        lines('수행 내용', biz.content) +
        lines('연장근무 사유', biz.reason) +
        '<p><br></p>';
      return 'OK';
    },
    [
      sel.title,
      sel.editorFrame,
      sel.editorInnerFrame,
      title,
      workerRow,
      { target: input.target, content: input.content, reason: input.reason },
    ],
  );
  if (result !== 'OK') {
    throw new Error(
      `양식을 채우지 못했습니다(${result}) — 그룹웨어 화면이 바뀌었을 수 있습니다.`,
    );
  }
}

/**
 * 연장근무내역서 작성 — **상신은 하지 않고 창을 사용자에게 넘긴다**.
 *
 * 앱이 [상신]까지 누르지 않는 이유는 사용자가 내용을 눈으로 확인하고 올리기 위해서다
 * (지출결의서·휴가신청서와 같은 방침). 창은 처음부터 보이게 띄워 채워지는 과정을 볼 수 있다.
 */
export async function runOvertimeDraft(
  input: OvertimeSubmitInput,
  onStep?: (step: string) => void,
): Promise<{ title: string }> {
  if (running) throw new Error('이미 야근 결재 작업이 진행 중입니다.');
  running = true;
  const step = (s: string) => onStep?.(s);

  // 지난 실행에서 남겨둔 창이 있으면 정리
  closeKeptPage();

  // 작성되는 과정을 사용자가 보도록 처음부터 띄운다
  const page = await openPage(true);
  let keepOpen = false;
  try {
    step('연장근무내역서 양식 여는 중…');
    await gotoAsUser(page, OVERTIME_CONFIG.formUrl);
    await waitFormReady(page);

    step('양식 작성 중…');
    const drafterName = await readDrafterName(page);
    const title = formatTitle(drafterName, input);
    await fillForm(page, input, drafterName, title);

    step('작성 완료 — 창에서 확인 후 [상신] 하세요');
    // 자동화 장치(확인창 자동 승낙 등)를 걷어내고 넘긴다.
    // ⚠️ 이걸 빼면 사용자가 [상신] 을 눌렀을 때 확인창이 몰래 승낙돼 흐름이 깨진다.
    await releasePage(page);
    page.win.setTitle('연장근무내역서 — 확인 후 [상신] 하세요');
    page.win.show();
    page.win.focus();
    keepOpen = true;
    keepPage(page);
    return { title };
  } finally {
    running = false;
    if (!keepOpen) closePage(page);
  }
}
