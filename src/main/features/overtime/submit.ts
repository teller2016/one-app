// 야근 결재 — headless 브라우저로 그룹웨어 전자결재 '연장근무내역서'를 작성해 상신한다.
// 결재선 기본값이 '본인'이라 상신 후 미결함에서 본인이 승인하면 끝 (승인은 사용자가 직접).
import puppeteer, { type Dialog, type Page } from 'puppeteer';
import { OVERTIME_CONFIG } from './config';
import type { OvertimeSubmitInput } from '../../../shared/types';
import { sleep } from '../../lib/util';
import { withGroupwareLogin } from '../../lib/groupware';

type Credentials = { id: string; password: string };

// 동시 실행 방지 (headless 브라우저 중복 기동 막기)
let running = false;

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

async function login(page: Page, credentials: Credentials) {
  const { selectors: sel } = OVERTIME_CONFIG;
  await page.goto(OVERTIME_CONFIG.loginUrl, { waitUntil: 'networkidle2' });
  if (await page.$(sel.userId)) {
    await page.type(sel.userId, credentials.id);
    await page.type(sel.userPw, credentials.password);
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        .catch((): null => null),
      page.click(sel.loginSubmit),
    ]);
    await sleep(1500); // 추가 리다이렉트 정리 대기
  }
}

/**
 * 양식 팝업 로드 대기 — 제목 입력·에디터 본문(근무자 표)에 더해
 * 상신 가드가 검사하는 비동기 값(품의번호·결재라인)까지 채워져야 한다.
 * (이게 로드되기 전에 [상신]을 누르면 경고만 뜨고 조용히 무시된다)
 */
async function waitFormReady(page: Page) {
  const { selectors: sel } = OVERTIME_CONFIG;
  await page.waitForFunction(
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
    { timeout: 30000 },
    sel.title,
    sel.editorFrame,
    sel.editorInnerFrame,
    sel.numberingSelect,
    sel.appLineHidden,
    sel.draftBtn,
  );
}

/** 양식에서 기안자 이름을 읽는다 (제목·근무자 표의 성명에 사용) */
async function readDrafterName(page: Page): Promise<string> {
  const name = await page.evaluate(() => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
    const p = Array.from(document.querySelectorAll('td p')).find(
      (el) => norm(el.textContent) === '기안자',
    );
    const cell = p?.closest('td')?.nextElementSibling as HTMLElement | null;
    return (cell?.textContent ?? '').trim();
  });
  if (!name) {
    throw new Error(
      '기안자 정보를 읽지 못했습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
    );
  }
  return name;
}

/** 제목 + 에디터 본문(근무자 표·업무내용)을 채운다 */
async function fillForm(
  page: Page,
  input: OvertimeSubmitInput,
  drafterName: string,
  title: string,
) {
  const { selectors: sel } = OVERTIME_CONFIG;
  const workerRow = {
    dept: OVERTIME_CONFIG.workerDept,
    name: drafterName,
    date: input.date,
    time: `${input.startTime} ~ ${input.endTime}`,
    total: formatHoursTotal(input.startTime, input.endTime),
  };
  const result = await page.evaluate(
    (
      titleSel: string,
      frameSel: string,
      innerSel: string,
      titleText: string,
      row: typeof workerRow,
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
    sel.title,
    sel.editorFrame,
    sel.editorInnerFrame,
    title,
    workerRow,
    { target: input.target, content: input.content, reason: input.reason },
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
  const { selectors: sel } = OVERTIME_CONFIG;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(
      (docIdSel: string, puddSel: string, prev: string) => {
        const docId = (document.querySelector(docIdSel) as HTMLInputElement | null)?.value ?? '';
        if (docId && docId !== '0' && docId !== prev) return { docId };
        const pudd = document.querySelector(puddSel);
        const msg =
          pudd && (pudd as HTMLElement).offsetParent !== null
            ? (pudd.textContent ?? '').replace(/\s+/g, ' ').trim()
            : '';
        return { docId: '', msg };
      },
      sel.docIdHidden,
      sel.puddMessage,
      prevDocId,
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
 * onStep 으로 진행 단계를 알린다 (모달의 진행 문구).
 */
export async function runOvertimeSubmit(
  input: OvertimeSubmitInput,
  credentials: Credentials,
  onStep?: (step: string) => void,
): Promise<{ title: string; docUrl: string | null }> {
  if (running) throw new Error('이미 야근 결재 상신이 진행 중입니다.');
  running = true;
  const step = (s: string) => onStep?.(s);
  // 시스템에 설치된 Google Chrome 사용 (배포판에서 Chromium 동봉 없이 동작)
  const browser = await puppeteer.launch({
    headless: 'new' as const,
    channel: 'chrome',
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    // 그룹웨어가 네이티브 confirm/alert 를 띄우면 수락 (상신 흐름엔 없지만 방어)
    page.on('dialog', (d: Dialog): void => {
      d.accept().catch((): void => {
        // 이미 닫힌 다이얼로그면 무시
      });
    });

    step('그룹웨어 로그인 중…');
    // 로그인 구간만 직렬화 — 메일·근태와 동시 로그인하면 서버가 한쪽을 거부한다
    await withGroupwareLogin(() => login(page, credentials));

    step('연장근무내역서 양식 여는 중…');
    await page
      .goto(OVERTIME_CONFIG.formUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      .catch((err: Error) => {
        if (!/timeout/i.test(err.message)) throw err;
      });
    if (page.url().includes('egovLoginUsr')) {
      throw new Error('그룹웨어 로그인 실패 — 환경설정의 계정 정보를 확인하세요.');
    }
    await waitFormReady(page);

    step('양식 작성 중…');
    const drafterName = await readDrafterName(page);
    const title = formatTitle(drafterName, input);
    await fillForm(page, input, drafterName, title);

    // 상신 — 신규 작성이라 hidDocID 는 보통 '0', 성공 응답이 오면 새 문서 id 로 바뀐다
    const prevDocId = await page.evaluate(
      (docIdSel: string) =>
        (document.querySelector(docIdSel) as HTMLInputElement | null)?.value ?? '',
      OVERTIME_CONFIG.selectors.docIdHidden,
    );
    step('상신 중…');
    // 좌표 클릭은 로딩 오버레이에 가로채일 수 있어 JS 클릭으로 핸들러를 직접 발화한다
    await page.evaluate((draftSel: string) => {
      (document.querySelector(draftSel) as HTMLElement | null)?.click();
    }, OVERTIME_CONFIG.selectors.draftBtn);
    const docId = await waitSubmitResult(page, prevDocId);

    return { title, docUrl: OVERTIME_CONFIG.docViewUrl(docId) };
  } finally {
    running = false;
    try {
      await browser.close();
    } catch {
      // 이미 닫혔으면 무시
    }
  }
}
