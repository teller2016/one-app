// 지출결의서(개인) 작성 — 항목(주차요금·석식대)을 채워 넣고 화면을 남긴다.
// 첨부파일·결재상신은 사용자가 그 화면에서 직접 이어서 한다 (자동 상신하지 않음).
//
// 화면 흐름 (2026-07 실측)
//   /exp/ExpendPop.do?form_id=22 → ExUserMasterPop.do
//   [항목추가](#btnExpendListAdd) → 레이어 팝업(#layerExpendList)
//   표준적요·증빙유형·카드는 '찾기' 도움창(window.open + POST)에서 선택해야 코드가 채워진다
//   → fnOpenCommonCodePop('Y', codeType) 을 부르면 이름 칸의 값이 검색어로 넘어간다
//   [저장](#btnListSave) → 레이어가 닫히며 항목 그리드에 한 줄 추가
import {
  closePage,
  closePopups,
  evalInPage,
  fireInPage,
  openPage,
  releasePage,
  takeAlerts,
  waitForPopup,
  waitInPage,
  type Page,
} from '../../lib/browser';
import { EXPEND_CONFIG } from './config';
import { gotoAsUser } from './gw';
import { closeKeptPage, keepPage } from './keeper';
import { sleep } from '../../lib/util';
import { monthEndDayKey } from '../../../shared/date';
import type { ExpendInput, ExpendResult } from '../../../shared/types';

/** 동시 실행 방지 */
let running = false;

/** 한 항목의 입력 내용 */
type ItemSpec = {
  summaryName: string; // 표준적요 (찾기에서 고를 이름)
  note: string; // 적요
  date: string; // 증빙일자 "YYYY-MM-DD"
  amount: number; // 공급대가
};

/** 주차요금 공급대가 — (만원권 × 10,000 + 5천원권 × 5,000) ÷ 2 */
export function parkingAmount(manCount: number, halfCount: number): number {
  return Math.floor((manCount * 10000 + halfCount * 5000) / 2);
}

/** "YYYY-MM" → 그 달 말일 "YYYY-MM-DD" */
export const monthEndDate = monthEndDayKey;

/** 주차 적요 — 예: 26년 7월 주차 요금 */
export function parkingNote(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  return `${m[1].slice(2)}년 ${Number(m[2])}월 주차 요금`;
}

/** 석식 적요 — 예: 7월 28일 연장근로 석식비 */
export function dinnerNote(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${Number(m[2])}월 ${Number(m[3])}일 연장근로 석식비`;
}

/** 폼 입력 → 항목 목록 (주차 1건 + 석식 N건) */
export function buildItems(input: ExpendInput): ItemSpec[] {
  const items: ItemSpec[] = [];
  if (input.parking) {
    items.push({
      summaryName: EXPEND_CONFIG.summaryParking,
      note: parkingNote(input.month),
      date: monthEndDate(input.month),
      amount: parkingAmount(input.parking.manCount, input.parking.halfCount),
    });
  }
  for (const d of input.dinners) {
    items.push({
      summaryName: EXPEND_CONFIG.summaryDinner,
      note: dinnerNote(d.date),
      date: d.date,
      amount: d.amount,
    });
  }
  return items;
}

/** 양식 로드 대기 — [항목추가] 버튼과 사용자 이름이 채워질 때까지 */
async function waitFormReady(page: Page) {
  const sel = EXPEND_CONFIG.selectors;
  await waitInPage(
    page,
    (addBtn: string, nameSel: string) => {
      const btn = document.querySelector(addBtn);
      const name = document.querySelector(nameSel) as HTMLInputElement | null;
      return !!btn && !!name && !!name.value;
    },
    [sel.addItemBtn, sel.empName],
    { timeout: 45000, label: '지출결의서 양식 로드' },
  );
}

/** 양식이 채워 넣은 사용자 이름 (카드 검색어로 재사용) */
async function readEmpName(page: Page): Promise<string> {
  const name = await evalInPage(
    page,
    (sel: string) =>
      ((document.querySelector(sel) as HTMLInputElement | null)?.value ?? '').trim(),
    [EXPEND_CONFIG.selectors.empName],
  );
  if (!name) throw new Error('사용자 이름을 읽지 못했습니다 — 화면이 바뀌었을 수 있습니다.');
  return name;
}

/** 입력칸에 값 넣기 — 그룹웨어 스크립트의 change/blur 훅까지 발화시킨다 */
async function setField(page: Page, selector: string, value: string) {
  const ok = await evalInPage(
    page,
    (sel: string, v: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) return false;
      const w = window as unknown as {
        jQuery?: (s: string) => { data?: (k: string) => unknown };
      };
      // 날짜칸은 Kendo DatePicker 위젯이라 위젯 API 로 넣어야 화면·모델이 함께 갱신된다
      const widget = w.jQuery
        ? (w.jQuery(sel).data?.('kendoDatePicker') as
            | { value: (v: Date | string) => void; trigger: (e: string) => void }
            | undefined)
        : undefined;
      if (widget && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        widget.value(new Date(y, m - 1, d));
        widget.trigger('change');
        return true;
      }
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // ⚠️ keyup 이 핵심 — 금액칸의 자동계산(fnSetAmt: 공급대가 → 공급가액·부가세 분배)과
      // 콤마 마스킹이 keyup 핸들러에 걸려 있다. 이걸 빼면 공급가액·부가세가 0 으로 남는다.
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    },
    [selector, value],
  );
  if (!ok) throw new Error(`입력칸(${selector})을 찾지 못했습니다.`);
}

/**
 * 찾기 도움창을 매번 **새 이름**으로 열도록 페이지 함수를 갈아끼운다.
 * 원본 CM_FNC_CALL_POPUP 은 항상 같은 창 이름("UserCmmCodePop")을 쓰는데,
 * 두 번째 항목에서 그 이름을 재사용하면 window.open 이 돌아오지 않아 자동화가 멈춘다(2026-07 실측).
 * (원본과 같은 URL·POST 폼을 쓰고 창 이름만 다르게 한다. focus 는 자동화에 불필요해 뺀다)
 */
async function patchPopupOpener(page: Page) {
  await evalInPage(
    page,
    (popUrl: string) => {
      const w = window as unknown as {
        __popupPatched?: boolean;
        __origCallPopup?: (param: unknown) => number;
        CM_FNC_CALL_POPUP?: (param: unknown) => number;
      };
      if (w.__popupPatched) return true;
      // 원본은 보관 — releasePage 가 되돌린다
      if (!w.__origCallPopup) w.__origCallPopup = w.CM_FNC_CALL_POPUP;
      let seq = 0;
      w.CM_FNC_CALL_POPUP = function () {
        seq += 1;
        const name = 'UserCmmCodePop_' + seq;
        window.open('', name, 'width=475,height=510');
        const f = document.forms.namedItem('USER_cmmPop');
        if (!f) return 0;
        f.target = name;
        f.method = 'post';
        f.action = popUrl;
        f.submit();
        f.target = '';
        return 0;
      };
      w.__popupPatched = true;
      return true;
    },
    [EXPEND_CONFIG.popupFormUrl],
  );
}

/**
 * '찾기' 도움창으로 항목을 고른다 (직접 입력하면 코드가 비어 저장되지 않는다).
 *
 * 도움창은 상황에 따라 세 갈래로 흘러가므로 **상태를 폴링**해서 대응한다.
 *   ① 검색어가 넘어가 결과가 1건이면 → 도움창이 스스로 선택·반영하고 닫힌다
 *   ② 목록이 뜨면 → 원하는 행을 골라 [확인]
 *   ③ 검색이 안 걸려 목록이 비면 → 검색어를 넣고 [검색]
 * 성공 판정은 부모 화면의 코드 칸이 채워졌는지로만 한다(도움창이 이미 닫혔을 수 있으므로).
 */
async function pickByPopup(
  page: Page,
  opts: {
    codeType: string;
    nameSelector: string;
    codeSelector: string;
    searchStr: string;
    matchName: string;
    label: string;
  },
) {
  const pop = EXPEND_CONFIG.popup;
  closePopups(page);

  const codeFilled = () =>
    evalInPage(
      page,
      (sel: string) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        return !!el && !!el.value.trim();
      },
      [opts.codeSelector],
    ).catch((): boolean => false);

  // 이름 칸에 검색어를 넣고 도움창 열기 ('Y' = 엔터 경로 → 검색어가 함께 넘어간다)
  // ⚠️ window.open 을 실행하는 호출이라 결과를 기다리면 응답이 오지 않는다 → fireInPage
  fireInPage(
    page,
    (nameSel: string, q: string, ct: string) => {
      const el = document.querySelector(nameSel) as HTMLInputElement | null;
      if (el) el.value = q;
      const w = window as unknown as {
        fnOpenCommonCodePop?: (input: string, codeType: string) => void;
      };
      if (typeof w.fnOpenCommonCodePop === 'function') w.fnOpenCommonCodePop('Y', ct);
      return true;
    },
    [opts.nameSelector, opts.searchStr, opts.codeType],
  );

  const deadline = Date.now() + 60000;
  let searched = false;
  let accepted = false;
  let sawPopup = false;
  let lastRows: string[] = [];

  while (Date.now() < deadline) {
    if (await codeFilled()) return; // ① 자동 반영까지 여기서 잡힌다

    const popup =
      page.popups.find(
        (p) => !p.win.isDestroyed() && p.wc.getURL().includes(pop.urlMark),
      ) ?? null;

    if (popup) {
      sawPopup = true;
      const state = await evalInPage(
        popup,
        (inputSel: string, tblSel: string) => {
          const squash = (s: string | null | undefined) =>
            (s ?? '').replace(/\s+/g, ' ').trim();
          const t = document.querySelector(tblSel) as HTMLTableElement | null;
          const rows = t
            ? Array.from(t.rows).filter((r) => !r.querySelector('th'))
            : [];
          return {
            ready: !!document.querySelector(inputSel),
            rows: rows.map((r) => squash(r.innerText).slice(0, 60)),
          };
        },
        [pop.searchInput, pop.resultTable],
      ).catch((): null => null);

      if (state?.rows.length) {
        lastRows = state.rows;
        if (!accepted) {
          // ② 목록에서 원하는 행 선택 → [확인] (창이 닫히는 클릭이라 fireInPage)
          const picked = await evalInPage(
            popup,
            (tblSel: string, want: string) => {
              const squash = (s: string | null | undefined) =>
                (s ?? '').replace(/\s+/g, '');
              const t = document.querySelector(tblSel) as HTMLTableElement | null;
              if (!t) return 'NO_TABLE';
              const rows = Array.from(t.rows).filter((r) => !r.querySelector('th'));
              const target =
                rows.find((r) => squash(r.innerText) === squash(want)) ??
                rows.find((r) =>
                  Array.from(r.cells).some((c) => squash(c.innerText) === squash(want)),
                ) ??
                rows.find((r) => squash(r.innerText).includes(squash(want)));
              if (!target) return 'NO_MATCH';
              const box = target.querySelector(
                'input[type=radio], input[type=checkbox]',
              ) as HTMLInputElement | null;
              if (box) {
                box.checked = true;
                box.dispatchEvent(new Event('click', { bubbles: true }));
                box.dispatchEvent(new Event('change', { bubbles: true }));
              }
              target.click();
              return 'PICKED';
            },
            [pop.resultTable, opts.matchName],
          ).catch((): string => 'ERR');

          if (picked === 'NO_MATCH') {
            throw new Error(
              `${opts.label} 목록에서 '${opts.matchName}' 을 찾지 못했습니다. 목록: ${lastRows
                .slice(0, 8)
                .join(' / ')}`,
            );
          }
          if (picked === 'PICKED') {
            fireInPage(
              popup,
              (btnSel: string) => {
                (document.querySelector(btnSel) as HTMLElement | null)?.click();
                return true;
              },
              [pop.acceptBtn],
            );
            accepted = true;
          }
        }
      } else if (state?.ready && !searched) {
        // ③ 목록이 비어 있으면 검색어를 넣고 검색
        fireInPage(
          popup,
          (inputSel: string, btnSel: string, q: string) => {
            const el = document.querySelector(inputSel) as HTMLInputElement | null;
            if (el) {
              el.value = q;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            (document.querySelector(btnSel) as HTMLElement | null)?.click();
            return true;
          },
          [pop.searchInput, pop.searchBtn, opts.searchStr],
        );
        searched = true;
      }
    }

    await sleep(700);
  }

  throw new Error(
    `${opts.label} 선택이 반영되지 않았습니다(검색어: ${opts.searchStr}).` +
      (lastRows.length
        ? ` 목록: ${lastRows.slice(0, 6).join(' / ')}`
        : sawPopup
          ? ' 도움창은 열렸지만 검색 결과가 없습니다.'
          : ' 도움창이 열리지 않았습니다.'),
  );
}

/** 항목 하나 작성 → 저장 */
async function addItem(page: Page, spec: ItemSpec, cardName: string) {
  const sel = EXPEND_CONFIG.selectors;

  // [항목추가] → 레이어 팝업 표시 대기
  await evalInPage(
    page,
    (btnSel: string) => {
      (document.querySelector(btnSel) as HTMLElement | null)?.click();
      return true;
    },
    [sel.addItemBtn],
  );
  await waitInPage(
    page,
    (layerSel: string) => {
      const el = document.querySelector(layerSel) as HTMLElement | null;
      if (!el) return false;
      // position:fixed 라 offsetParent 로는 판정할 수 없다 — display + 실제 크기로 본다
      return getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    },
    [sel.itemLayer],
    { timeout: 15000, label: '항목 입력창' },
  );

  await pickByPopup(page, {
    codeType: EXPEND_CONFIG.codeType.summary,
    nameSelector: sel.summaryName,
    codeSelector: sel.summaryCode,
    searchStr: spec.summaryName,
    matchName: spec.summaryName,
    label: '표준적요',
  });

  await pickByPopup(page, {
    codeType: EXPEND_CONFIG.codeType.auth,
    nameSelector: sel.authName,
    codeSelector: sel.authCode,
    searchStr: EXPEND_CONFIG.authTypeName,
    matchName: EXPEND_CONFIG.authTypeName,
    label: '증빙유형',
  });

  await setField(page, sel.note, spec.note);
  await setField(page, sel.authDate, spec.date);

  await pickByPopup(page, {
    codeType: EXPEND_CONFIG.codeType.card,
    nameSelector: sel.cardName,
    codeSelector: sel.cardCode,
    searchStr: cardName,
    matchName: cardName,
    label: '카드',
  });

  await setField(page, sel.amount, String(spec.amount));

  // [저장] → 레이어가 닫히면 성공
  await takeAlerts(page); // 이전 단계의 안내 문구는 비우고 시작
  await evalInPage(
    page,
    (btnSel: string) => {
      (document.querySelector(btnSel) as HTMLElement | null)?.click();
      return true;
    },
    [sel.itemSave],
  );
  await waitInPage(
    page,
    (layerSel: string) => {
      const el = document.querySelector(layerSel) as HTMLElement | null;
      return !el || getComputedStyle(el).display === 'none';
    },
    [sel.itemLayer],
    { timeout: 20000, label: '항목 저장' },
  ).catch(async () => {
    const alerts = await takeAlerts(page);
    throw new Error(
      `항목(${spec.note})을 저장하지 못했습니다.` +
        (alerts.length ? ` 그룹웨어 안내: ${alerts.join(' / ')}` : ''),
    );
  });
}

/**
 * 지출결의서 작성 실행.
 * 항목을 다 채운 뒤 **상신하지 않고 화면을 남긴다** — 첨부파일 등록·결재상신은 사용자가 직접.
 */
export async function runExpendDraft(
  input: ExpendInput,
  onStep?: (step: string) => void,
): Promise<ExpendResult> {
  if (running) throw new Error('이미 지출결의서 작업이 진행 중입니다.');
  running = true;
  const step = (s: string) => onStep?.(s);

  // 지난 실행에서 남겨둔 창은 정리
  closeKeptPage();

  const items = buildItems(input);
  if (!items.length) {
    running = false;
    return { ok: false, error: '작성할 항목이 없습니다. 주차요금이나 석식대를 채워주세요.' };
  }

  // 결재양식 목록 창(opener 역할) — 숨겨두지만 사용자가 작업을 마칠 때까지 살아 있어야 한다
  const shell = await openPage(false, { allowPopups: true });
  let page: Page | null = null;
  try {
    step('결재양식 목록 여는 중…');
    await gotoAsUser(shell, EXPEND_CONFIG.formListUrl);
    await waitInPage(
      shell,
      (want: string) => {
        const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
        return Array.from(document.querySelectorAll('a')).some(
          (a) => squash(a.textContent) === squash(want),
        );
      },
      [EXPEND_CONFIG.formLinkText],
      { timeout: 45000, label: '결재양식 목록' },
    );

    step('지출결의서(개인) 양식 여는 중…');
    // 목록에서 클릭해야 정상적인 opener 관계가 생긴다 (window.open 이라 fireInPage)
    fireInPage(
      shell,
      (want: string) => {
        const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '');
        const link = Array.from(document.querySelectorAll('a')).find(
          (a) => squash(a.textContent) === squash(want),
        );
        if (link) (link as HTMLElement).click();
        return true;
      },
      [EXPEND_CONFIG.formLinkText],
    );
    page = await waitForPopup(shell, EXPEND_CONFIG.formUrlMark, 45000);
    page.win.show();

    await waitFormReady(page);
    await patchPopupOpener(page);
    const cardName = await readEmpName(page);

    let added = 0;
    for (const spec of items) {
      step(`항목 작성 ${added + 1}/${items.length} — ${spec.summaryName}`);
      await addItem(page, spec, cardName);
      added += 1;
    }

    step('작성 완료 — 첨부파일 등록 후 상신하세요');
    // 자동화 장치를 걷어내고 창을 사용자에게 넘긴다
    // (안 하면 [결재상신] 의 확인창이 자동 승낙돼 창이 닫혀버린다)
    await releasePage(page);
    // opener 쪽도 원복 — 결재선 팝업을 이 창이 열어준다.
    // closeChildren:false — 이 창의 '팝업'이 바로 사용자가 쓸 지출결의서 창이다
    await releasePage(shell, { closeChildren: false });
    page.win.setTitle('지출결의서(개인) — 첨부파일 넣고 [결재상신] 하세요');
    page.win.show();
    page.win.focus();
    keepPage(page, shell);
    return { ok: true, added, itemCount: items.length };
  } catch (err) {
    // 실패해도 창은 남긴다 — 어디까지 됐는지 보고 사용자가 이어서 처리할 수 있게
    if (page) {
      await releasePage(page).catch((): void => undefined);
      await releasePage(shell).catch((): void => undefined);
      page.win.setTitle('지출결의서(개인) — 작성 중 문제 발생');
      page.win.show();
      keepPage(page, shell);
    } else {
      closePage(shell);
    }
    return { ok: false, error: (err as Error).message };
  } finally {
    running = false;
  }
}
