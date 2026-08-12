// 전자결재 상신함 창 — 결재 완료 화면의 '상신함 열기' 링크가 부른다.
//
// 작성 자동화 창(keeper.ts)과는 별개로 관리한다.
//  - 파티션이 다르다: openPage 가 열 때 그 파티션의 쿠키를 비우므로, 같은 파티션을 쓰면
//    사용자에게 넘겨둔 작성 창의 세션이 지워진다(browser.ts 의 주의사항).
//  - keeper 에 등록하지 않는다: keeper 는 '한 번에 하나' 라서, 등록하면 결재 완료 화면의
//    [창 닫기] 가 작성 창 대신 상신함을 닫게 된다.
import {
  AUTOMATION_PARTITION,
  closePage,
  evalInPage,
  goto,
  openPage,
  releasePage,
  waitInPage,
  type Page,
} from '../../lib/browser';
import { EA_BOX_CONFIG } from './config';
import { GROUPWARE_CONFIG } from '../groupware/config';
import { gotoAsUser } from './gw';

/** 열어둔 상신함 창 (한 번에 하나 — 다시 누르면 그 창을 앞으로 가져온다) */
let boxPage: Page | null = null;

/**
 * 포털 셸에서 [전자결재] → [상신함] 을 클릭해 문서함을 띄운다.
 * ⚠️ 상단 메뉴는 로드 직후 클릭이 무시될 수 있어(일정 등록에서 확인된 함정) 재클릭한다.
 */
async function openDraftBoxViaMenu(page: Page) {
  const sel = EA_BOX_CONFIG.selectors;

  await waitInPage(
    page,
    (menuSel: string) => !!document.querySelector(menuSel),
    [sel.eaMenu],
    { timeout: 30000, label: '전자결재 메뉴' },
  );

  // [전자결재] → 좌측 문서함 메뉴가 나타날 때까지 재클릭
  let hasBox = false;
  for (let i = 0; i < 5 && !hasBox; i++) {
    await evalInPage(
      page,
      (menuSel: string) => {
        (document.querySelector(menuSel) as HTMLElement | null)?.click();
      },
      [sel.eaMenu],
    );
    hasBox = await waitInPage(
      page,
      (anchorId: string) => !!document.getElementById(anchorId),
      [sel.draftBoxAnchorId],
      { timeout: 4000, label: '상신함 메뉴' },
    )
      .then((): boolean => true)
      .catch((): boolean => false);
  }
  if (!hasBox) throw new Error('전자결재 메뉴가 열리지 않았습니다.');

  // [상신함] → 프레임이 문서함 목록으로 바뀔 때까지 대기
  await evalInPage(
    page,
    (anchorId: string) => {
      document.getElementById(anchorId)?.click();
    },
    [sel.draftBoxAnchorId],
  );
  await waitInPage(
    page,
    (frameSel: string, mark: string) => {
      const f = document.querySelector(frameSel) as HTMLIFrameElement | null;
      return !!f && (f.getAttribute('src') ?? '').includes(mark);
    },
    [sel.contentFrame, EA_BOX_CONFIG.listUrlMark],
    { timeout: 30000, label: '상신함 목록' },
  );
}

/**
 * 전자결재 상신함을 앱 창으로 연다 — 공용 세션 쿠키를 주입해 로그인 화면을 건너뛴다.
 * 자동화는 메뉴 클릭까지만이고, 그 뒤 releasePage 로 자동화 장치를 걷어내 사용자에게 넘긴다.
 */
export async function openEaBox(): Promise<void> {
  // 이미 열려 있으면 새로 열지 않는다 — 새로 열면 파티션 쿠키가 비워져 세션이 끊긴다
  if (boxPage && !boxPage.win.isDestroyed()) {
    if (boxPage.win.isMinimized()) boxPage.win.restore();
    boxPage.win.show();
    boxPage.win.focus();
    return;
  }

  const page = await openPage(true, {
    partition: AUTOMATION_PARTITION.eaBox,
    title: '전자결재 - 상신함',
    // 문서를 열어 보는 화면이 팝업이다
    allowPopups: true,
  });
  boxPage = page;
  page.win.on('closed', () => {
    if (boxPage === page) boxPage = null;
  });

  try {
    await gotoAsUser(page, GROUPWARE_CONFIG.portalUrl);
    try {
      await openDraftBoxViaMenu(page);
    } catch {
      // 메뉴 구조가 바뀌었더라도 목록 자체는 직접 열린다 (문서함 이동 메뉴는 없다)
      await goto(page, EA_BOX_CONFIG.listUrl);
    }
  } catch (err) {
    closePage(page);
    boxPage = null;
    throw err;
  }

  // 사용자가 이어서 쓰는 창이므로 alert/confirm 가로채기를 원복한다.
  // 이때 자식 창도 정리한다 — 로그인 직후 그룹웨어가 띄우는 **공지 팝업**이 딸려 오기 때문
  // (2026-08-12 실측: gwpOpenNoticePopup.do). 사용자가 이후 문서를 눌러 여는 팝업은
  // release 뒤라 영향받지 않는다.
  await releasePage(page);
}
