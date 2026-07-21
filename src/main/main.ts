import { registerApplinkIpc } from "./features/applink/ipc";
import { registerAttendanceIpc } from "./features/attendance/ipc";
import { startReminderScheduler } from "./features/attendance/scheduler";
import { registerDeployIpc } from "./features/deploy/ipc";
import { registerJiraIpc } from "./features/jira/ipc";
import { registerMirrorIpc } from "./features/mirror/ipc";
import { registerNightwatchIpc } from "./features/nightwatch/ipc";
import { setNotifyWindow, registerNotifyIpc } from "./features/notify/notify";
import { registerPrsIpc } from "./features/prs/ipc";
import { registerScheduleIpc } from "./features/schedule/ipc";
import { registerSettingsIpc } from "./features/settings/ipc";
import { getThemePref } from "./features/settings/store";
import { createTray } from "./features/tray/tray";
import { registerVpnIpc } from "./features/vpn/ipc";
import { registerWeeklyIpc } from "./features/weekly/ipc";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import started from "electron-squirrel-startup";
import path from "node:path";

// Windows 설치/제거 시 바로가기 처리
if (started) {
  app.quit();
}

// IPC 핸들러 등록
registerScheduleIpc();
registerSettingsIpc();
registerDeployIpc();
registerAttendanceIpc();
registerVpnIpc();
registerWeeklyIpc();
registerNotifyIpc();
registerPrsIpc();
registerApplinkIpc();
registerMirrorIpc();
registerJiraIpc();
registerNightwatchIpc();

// 외부 브라우저로 링크 열기 (http/https 만 허용)
ipcMain.handle("app:openExternal", async (_e, url: string) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

// 로그인 시 자동 시작 — OS(로그인 아이템)가 원본이라 파일 저장 없이 그대로 읽고 쓴다
// (개발 모드에선 Electron 바이너리가 등록되므로 패키징 앱에서만 실질 동작)
ipcMain.handle("app:autostart:get", () => ({
  enabled: app.getLoginItemSettings().openAtLogin,
}));
ipcMain.handle("app:autostart:set", (_e, enabled: boolean) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled });
  return { enabled: app.getLoginItemSettings().openAtLogin };
});

const createWindow = () => {
  // 저장된 테마 설정을 네이티브에도 반영 — 비브런시 재질·신호등·다이얼로그가 앱 테마를 따르고,
  // 렌더러의 prefers-color-scheme(theme.ts 의 system 해석)도 이 값을 따라간다
  nativeTheme.themeSource = getThemePref();

  // 메인 창 생성
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "One App",
    // macOS: 신호등 버튼만 남기고 타이틀바를 콘텐츠에 통합
    titleBarStyle: "hiddenInset",
    // 비브런시 사이드바 — 창 배경이 반투명 재질(Finder 류). CSS 에서 html/body/.sidebar 를
    // 투명하게 두고 .content 만 --bg 로 불투명하게 칠해 사이드바에만 재질이 비친다.
    // (backgroundColor 를 칠하면 재질이 가려지므로 지정하지 않는다 — 로드 전 배경도 재질이라 플래시 없음)
    vibrancy: "sidebar",
    visualEffectState: "active",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // 알림(알럿)이 이 창에 붙어 뜨고 섹션 이동할 수 있도록 참조 등록
  setNotifyWindow(mainWindow);

  // 앱 화면(index.html) 로드
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // DevTools 자동 오픈은 끔 (필요하면 ⌘⌥I 로 토글)
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
};

// Electron 초기화 완료 후 창 생성
app.on("ready", () => {
  // 개발 모드 Dock 아이콘 — 패키징된 앱은 번들 아이콘(assets/icon.icns)을 사용
  if (process.platform === "darwin" && !app.isPackaged) {
    try {
      app.dock?.setIcon(path.join(app.getAppPath(), "assets", "icon.png"));
    } catch {
      // 아이콘 파일이 없어도 실행에는 지장 없음
    }
  }
  createWindow();
  // 출퇴근 리마인더 스케줄러 시작 (창을 닫아도 앱이 살아 있으면 계속 동작)
  startReminderScheduler();
  // 메뉴바 트레이 — 창이 닫혀 있어도 열기·출퇴근 찍기 가능
  createTray(() => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } else {
      createWindow();
    }
    app.focus({ steal: true });
  });
});

// 모든 창이 닫히면 종료 (macOS 제외)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // macOS: dock 아이콘 클릭 시 창이 없으면 재생성
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
