// 야근 결재 — 숨긴 브라우저 창으로 그룹웨어 전자결재 '연장근무내역서'를 작성해 상신한다.
// 결재선 기본값이 '본인'이라 상신 후 미결함에서 본인이 승인하면 끝 (승인은 사용자가 직접).
//
// One App 본체(src/main/features/overtime/submit.ts)의 puppeteer 판을
// Electron 자체 BrowserWindow 자동화(browser.ts)로 옮긴 것 — 판정 기준·대기 조건은 동일하다.
import { closePage, evalInPage, goto, openPage, waitInPage, type Page } from './browser';
import { OVERTIME_CONFIG } from './config';
import { sleep } from './util';
import type { OvertimeSubmitInput } from '../shared/types';

export type Account = {
  id: string;
  password: string;
  dept: string; // 근무자 표의 '소속' 칸 문구
  showBrowser: boolean; // 자동화 창을 보여줄지 (문제 확인용)
};

/** 동시 실행 방지 (브라우저 창 중복 기동 막기) */
let running = false;
/** 열려 있는 미리보기 창 — 다음 실행 때 정리한다 */
let previewPage: Page | null = null;

/** "HH:MM" → 분. 잘못된 형식이면 NaN */
const toMinutes = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** 근무시간 합계 문구 — 자정을 넘겨도 계산되도록 wrap-around. 예: 2시간 · 2.5시간 */
export function formatHoursTotal(startTime: string, endTime: string): string {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return '';
  const diff = (end - start + 24 * 60) % (24 * 60);
  const hours = diff / 60;
  return `${parseFloat(hours.toFixed(1))}시간`;
}

/** 제목 문구 — 그룹웨어 양식 기본 제목 패턴 + 0패딩 (예: 07월 01일 09시 00분) */
export function formatTitle(name: string, input: OvertimeSubmitInput): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const [, month, day] = input.date.split('-').map(Number);
  const part = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return `${pad(h)}시 ${pad(m)}분`;
  };
  return `[연장근무내역] ${name}_${pad(month)}월 ${pad(day)}일 ${part(input.startTime)}~${part(input.endTime)}`;
}

/** 그룹웨어 로그인 — 폼이 있으면 채우고 제출한다 (실패 판정은 양식 URL 이동 후에 한다) */
async function login(page: Page, account: Account) {
  const sel = OVERTIME_CONFIG.selectors;
  await goto(page, OVERTIME_CONFIG.loginUrl);

  const hasForm = await evalInPage(
    page,
    (idSel: string) => !!document.querySelector(idSel),
    [sel.userId],
  ).catch(() => false);
  if (!hasForm) return; // 이미 세션이 있으면 로그인 화면이 뜨지 않는다

  const filled = await evalInPage(
    page,
    (idSel: string, pwSel: string, btnSel: string, id: string, pw: string) => {
      const idEl = document.querySelector(idSel) as HTMLInputElement | null;
      const pwEl = document.querySelector(pwSel) as HTMLInputElement | null;
      const btn = document.querySelector(btnSel) as HTMLElement | null;
      if (!idEl || !pwEl || !btn) return false;
      // 키 입력 대신 값 설정 + 이벤트 발화 (그룹웨어 스크립트의 input/change 훅 대응)
      const set = (el: HTMLInputElement, value: string) => {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      };
      set(idEl, id);
      set(pwEl, pw);
      btn.click();
      return true;
    },
    [sel.userId, sel.userPw, sel.loginSubmit, account.id, account.password],
  );
  if (!filled) {
    throw new Error(
      '로그인 화면을 인식하지 못했습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
    );
  }

  // 로그인 처리 대기 — 실패해도 여기서 끊지 않고 양식 URL 이동 결과로 판정한다
  await waitInPage(
    page,
    (idSel: string) => !document.querySelector(idSel),
    [sel.userId],
    { timeout: 20000, label: '로그인' },
  ).catch(() => undefined);
  await sleep(1200); // 추가 리다이렉트 정리 대기
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
  account: Account,
  drafterName: string,
  title: string,
) {
  const sel = OVERTIME_CONFIG.selectors;
  const workerRow: WorkerRow = {
    dept: account.dept,
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
 * 상신 결과 대기 — 저장 성공 시 페이지가 #hidDocID 에 새 문서 id 를 기록한다.
 * 실패(검증 경고)면 커스텀 다이얼로그(.PUDD-UI-Message)가 뜨므로 그 문구를 오류로 돌려준다.
 */
async function waitSubmitResult(page: Page, prevDocId: string): Promise<string> {
  const sel = OVERTIME_CONFIG.selectors;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await evalInPage(
      page,
      (docIdSel: string, puddSel: string, prev: string) => {
        const docId =
          (document.querySelector(docIdSel) as HTMLInputElement | null)?.value ?? '';
        if (docId && docId !== '0' && docId !== prev) return { docId, msg: '' };
        const pudd = document.querySelector(puddSel);
        const msg =
          pudd && (pudd as HTMLElement).offsetParent !== null
            ? (pudd.textContent ?? '').replace(/\s+/g, ' ').trim()
            : '';
        return { docId: '', msg };
      },
      [sel.docIdHidden, sel.puddMessage, prevDocId],
    );
    if (state.docId) return state.docId;
    if (state.msg) throw new Error(`그룹웨어 경고: ${state.msg}`);
    await sleep(500);
  }
  throw new Error(
    '상신 응답을 확인하지 못했습니다 — 그룹웨어 미결함을 확인해 주세요. 이미 상신됐을 수 있으니 바로 재시도하지 마세요.',
  );
}

/**
 * 연장근무내역서 작성 → 상신 실행.
 * 성공 시 상신된 문서의 보기 URL(결재 버튼이 있는 팝업)을 돌려준다.
 * input.previewOnly 면 상신하지 않고 작성된 양식 창을 띄운 채 끝낸다.
 * onStep 으로 진행 단계를 알린다 (앱의 진행 문구).
 */
export async function runOvertimeSubmit(
  input: OvertimeSubmitInput,
  account: Account,
  onStep?: (step: string) => void,
): Promise<{ title: string; docUrl: string | null; preview: boolean }> {
  if (running) throw new Error('이미 야근 결재 작업이 진행 중입니다.');
  running = true;
  const preview = input.previewOnly === true;
  const step = (s: string) => onStep?.(s);

  // 지난 미리보기 창이 남아 있으면 정리
  closePage(previewPage);
  previewPage = null;

  // 미리보기는 사용자가 봐야 하므로 항상 창을 띄운다
  const page = await openPage(preview || account.showBrowser);
  let keepOpen = false;
  try {
    step('그룹웨어 로그인 중…');
    await login(page, account);

    step('연장근무내역서 양식 여는 중…');
    await goto(page, OVERTIME_CONFIG.formUrl);
    if (page.wc.getURL().includes('egovLoginUsr')) {
      throw new Error(
        '그룹웨어 로그인 실패 — 설정의 사번(ID)·비밀번호를 확인하세요.',
      );
    }
    await waitFormReady(page);

    step('양식 작성 중…');
    const drafterName = await readDrafterName(page);
    const title = formatTitle(drafterName, input);
    await fillForm(page, input, account, drafterName, title);

    if (preview) {
      // 상신하지 않고 작성 결과만 보여준다 — 창은 사용자가 닫는다
      page.win.setTitle('미리보기 — 상신하지 않았습니다 (확인 후 닫으세요)');
      page.win.show();
      page.win.focus();
      keepOpen = true;
      previewPage = page;
      // 임시 확인용 창이라 저장할 게 없다 — 페이지 이탈 가드가 남아 있어도 무조건 닫는다
      page.win.on('close', (e) => {
        if (page.win.isDestroyed()) return;
        e.preventDefault();
        page.win.destroy();
      });
      page.win.on('closed', () => {
        if (previewPage === page) previewPage = null;
      });
      return { title, docUrl: null, preview: true };
    }

    // 상신 — 신규 작성이라 hidDocID 는 보통 '0', 성공 응답이 오면 새 문서 id 로 바뀐다
    const prevDocId = await evalInPage(
      page,
      (docIdSel: string) =>
        (document.querySelector(docIdSel) as HTMLInputElement | null)?.value ?? '',
      [OVERTIME_CONFIG.selectors.docIdHidden],
    );
    step('상신 중…');
    // 좌표 클릭은 로딩 오버레이에 가로채일 수 있어 JS 클릭으로 핸들러를 직접 발화한다
    await evalInPage(
      page,
      (draftSel: string) => {
        (document.querySelector(draftSel) as HTMLElement | null)?.click();
        return true;
      },
      [OVERTIME_CONFIG.selectors.draftBtn],
    );
    const docId = await waitSubmitResult(page, prevDocId);

    return { title, docUrl: OVERTIME_CONFIG.docViewUrl(docId), preview: false };
  } finally {
    running = false;
    if (!keepOpen) closePage(page);
  }
}

/** 미리보기 창 닫기 — 앱 UI 버튼·앱 종료 시 모두 이걸 쓴다 */
export function closePreviewWindow(): { closed: boolean } {
  const had = !!previewPage && !previewPage.win.isDestroyed();
  closePage(previewPage);
  previewPage = null;
  return { closed: had };
}
