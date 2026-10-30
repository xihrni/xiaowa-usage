const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { getUsageData } = require('./usage-service');

let win;
let tray;
let expanded = false;
let refreshTimer;
let dragOrigin;
let settings = { scale: 0.8, opacity: 0.96, processingEnabled: true, processingDelay: 500, completionEnabled: true, completionDuration: 2000, statsEnabled: true, statsDuration: 6000, hoverPause: true, backgroundNotifications: false, soundEnabled: false, dndEnabled: false, dndStart: '22:00', dndEnd: '08:00', autoCheckUpdates: true };
const PET_SIZE = { width: 320, height: 480 };
const PANEL_SIZE = { width: 1040, height: 810 };
const settingsPath = () => path.join(app.getPath('userData'), 'pet-settings.json');

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch {}
  settings.scale = Math.max(0.6, Math.min(1.5, Number(settings.scale) || 0.8));
  settings.opacity = Math.max(0.3, Math.min(1, Number(settings.opacity) || 0.96));
  settings.processingDelay = Math.max(0, Math.min(5000, Number(settings.processingDelay ?? 500)));
  settings.completionDuration = Math.max(1000, Math.min(60000, Number(settings.completionDuration) || 2000));
  settings.statsDuration = Math.max(3000, Math.min(60000, Number(settings.statsDuration) || 6000));
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.dndStart)) settings.dndStart = '22:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(settings.dndEnd)) settings.dndEnd = '08:00';
}

function petSize() {
  return { width: Math.round(PET_SIZE.width * settings.scale), height: Math.round(PET_SIZE.height * settings.scale) };
}

function clampToDisplay(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    ...bounds,
    x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
  };
}

function togglePanel(show) {
  if (!win) return;
  expanded = typeof show === 'boolean' ? show : !expanded;
  const old = win.getBounds();
  const size = expanded ? PANEL_SIZE : petSize();
  const next = clampToDisplay({
    width: size.width,
    height: size.height,
    x: old.x + old.width - size.width,
    y: old.y + old.height - size.height
  });
  win.setBounds(next, true);
  win.show();
  win.webContents.send('panel:state', expanded);
}

function findWorkBuddyExecutable() {
  const home = process.env.USERPROFILE || require('node:os').homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const systemDrive = process.env.SystemDrive || 'C:';
  const candidates = [
    path.join(localAppData, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'),
    path.join(process.env.ProgramFiles || path.join(systemDrive, 'Program Files'), 'WorkBuddy', 'WorkBuddy.exe'),
    path.join(process.env['ProgramFiles(x86)'] || path.join(systemDrive, 'Program Files (x86)'), 'WorkBuddy', 'WorkBuddy.exe')
  ];
  return candidates.find(file => file && fs.existsSync(file)) || '';
}

function openWorkBuddy() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') {
      shell.openPath(findWorkBuddyExecutable() || '');
      resolve({ ok: true });
      return;
    }
    const executable = findWorkBuddyExecutable();
    const safeExecutable = executable.replace(/'/g, "''");
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class XiaowaWin32 {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fUnknown);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
function Focus-WorkBuddy($process) {
  $handle = [IntPtr]$process.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { return $false }
  [uint32]$foregroundPid = 0
  [uint32]$targetPid = 0
  $foreground = [XiaowaWin32]::GetForegroundWindow()
  $foregroundThread = [XiaowaWin32]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  $targetThread = [XiaowaWin32]::GetWindowThreadProcessId($handle, [ref]$targetPid)
  $attached = $false
  if ($foregroundThread -ne $targetThread) {
    $attached = [XiaowaWin32]::AttachThreadInput($foregroundThread, $targetThread, $true)
  }
  $foregroundBefore = [XiaowaWin32]::GetForegroundWindow()
  [void][XiaowaWin32]::ShowWindowAsync($handle, 9)
  Start-Sleep -Milliseconds 80
  [void][XiaowaWin32]::BringWindowToTop($handle)
  $foregroundSet = [XiaowaWin32]::SetForegroundWindow($handle)
  [XiaowaWin32]::SwitchToThisWindow($handle, $true)
  if ($attached) { [void][XiaowaWin32]::AttachThreadInput($foregroundThread, $targetThread, $false) }
  Start-Sleep -Milliseconds 180
  $foreground = [XiaowaWin32]::GetForegroundWindow()
  [void][XiaowaWin32]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  return (($foregroundPid -eq [uint32]$process.Id) -or (($foregroundBefore -eq [IntPtr]::Zero) -and $foregroundSet))
}
try {
  $running = @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  foreach ($process in $running) {
    if (Focus-WorkBuddy $process) {
      Write-Output 'activated'
      exit 0
    }
  }
  if ($running.Count -gt 0) {
    Write-Output 'unfocused'
    exit 0
  }
  $exe = '${safeExecutable}'
  if (-not (Test-Path -LiteralPath $exe)) {
    Write-Output 'not-found'
    exit 0
  }
  Start-Process -FilePath $exe
  Start-Sleep -Milliseconds 900
  $started = @(Get-Process -Name 'WorkBuddy' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  foreach ($process in $started) {
    if (Focus-WorkBuddy $process) { Write-Output 'started'; exit 0 }
  }
  Write-Output 'started'
} catch {
  Write-Output ('error: ' + $_.Exception.Message)
}
`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      timeout: 12000
    }, async (error, stdout, stderr) => {
      if (error) {
        console.warn('Unable to open WorkBuddy:', error.message, String(stderr || '').trim().slice(0, 300));
        resolve({ ok: false, reason: 'error' });
        return;
      }
      const result = String(stdout || '').trim().split(/\r?\n/).pop();
      if (['activated', 'started'].includes(result)) {
        resolve({ ok: true, reason: result });
        return;
      }
      if (result === 'unfocused' && executable) {
        try {
          await shell.openExternal('workbuddy://');
          resolve({ ok: true, reason: 'protocol' });
          return;
        } catch (protocolError) {
          console.warn('Unable to activate WorkBuddy protocol:', protocolError.message);
        }
      }
      resolve({ ok: false, reason: result || 'error' });
    });
  });
}

function sendPetNotice(title, message) {
  if (win && !win.isDestroyed()) win.webContents.send('pet:notice', { title, message });
}

function showPetContextMenu() {
  if (!win) return;
  const menu = Menu.buildFromTemplate([
    { label: '摸一摸', click: () => win?.webContents.send('pet:pat') },
    {
      label: '打开 WorkBuddy',
      click: async () => {
        const result = await openWorkBuddy();
        if (result.ok) return;
        if (result.reason === 'unfocused') {
          sendPetNotice('WorkBuddy 已在运行', '但没能切到前台，请从任务栏打开。');
        } else if (result.reason === 'not-found') {
          sendPetNotice('没有找到 WorkBuddy', '请先从开始菜单打开一次。');
        } else {
          sendPetNotice('打开 WorkBuddy 失败', '请从开始菜单手动打开。');
        }
      }
    },
    { label: '打开面板', enabled: !expanded, click: () => togglePanel(true) },
    { type: 'separator' },
    { label: '隐藏小哇', click: () => win?.hide() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  menu.popup({ window: win });
}

function repairShortcutIcons() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const candidates = [
    path.join(process.resourcesPath, 'icon.ico'),
    path.join(path.dirname(app.getPath('exe')), 'icon.ico')
  ];
  const iconPath = candidates.find(file => fs.existsSync(file));
  if (!iconPath) return;
  const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'WorkBuddyPet');
  const shortcuts = [
    path.join(app.getPath('desktop'), 'WorkBuddy 小哇助手.lnk'),
    path.join(startMenu, 'WorkBuddy 小哇助手.lnk'),
    path.join(startMenu, '卸载小哇助手.lnk')
  ];
  for (const shortcut of shortcuts) {
    if (!fs.existsSync(shortcut)) continue;
    try {
      const details = shell.readShortcutLink(shortcut);
      shell.writeShortcutLink(shortcut, 'update', {
        target: details.target,
        args: details.args,
        cwd: details.cwd,
        description: details.description,
        icon: iconPath,
        iconIndex: 0,
        appUserModelId: details.appUserModelId
      });
    } catch (error) {
      console.warn('Unable to repair shortcut icon:', shortcut, error.message);
    }
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'idle.png')).resize({ width: 32, height: 32 });
  tray = new Tray(icon);
  tray.setToolTip('WorkBuddy 小哇 · 点击查看');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏小哇', click: () => win?.isVisible() ? win.hide() : win?.show() },
    { label: '打开用量统计', click: () => togglePanel(true) },
    { type: 'separator' },
    { label: '退出小哇', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => win?.isVisible() ? win.hide() : win?.show());
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = petSize();
  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: area.x + area.width - size.width - 24,
    y: area.y + area.height - size.height - 24,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'WorkBuddy 小哇',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setOpacity(settings.opacity);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', event => {
    if (!app.isQuitting && !process.env.PET_CAPTURE) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });
  if (process.env.PET_CAPTURE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const petImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'pet-preview.png'), petImage.toPNG());
        await win.webContents.executeJavaScript("showTaskStats(state.data.sessions[0])");
        await new Promise(resolve => setTimeout(resolve, 250));
        const statsBubbleImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'stats-bubble-preview.png'), statsBubbleImage.toPNG());
        await win.webContents.executeJavaScript("clearBubbleTimer(); taskState.batch=null; const a=state.data.sessions[0],b=state.data.sessions[1]; queueCompletion(a,'completed',{credits:a.metrics.credits-12.5,totalTokens:a.metrics.totalTokens-10000}); queueCompletion(b,'completed',{credits:b.metrics.credits-8,totalTokens:b.metrics.totalTokens-8000})");
        await new Promise(resolve => setTimeout(resolve, 250));
        const batchImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'batch-preview.png'), batchImage.toPNG());
        await win.webContents.executeJavaScript("clearBubbleTimer(); taskState.batch=null; const s=state.data.sessions[0]; queueCompletion(s,'failed',{credits:s.metrics.credits,totalTokens:s.metrics.totalTokens})");
        await new Promise(resolve => setTimeout(resolve, 250));
        const failedImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(__dirname, '..', 'failed-preview.png'), failedImage.toPNG());
        togglePanel(true);
        setTimeout(async () => {
          const panelImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'panel-preview.png'), panelImage.toPNG());
          await win.webContents.executeJavaScript("document.querySelector('#sessionSelectButton').click()");
          await new Promise(resolve => setTimeout(resolve, 250));
          const dropdownImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'dropdown-preview.png'), dropdownImage.toPNG());
          await win.webContents.executeJavaScript("switchTab('all')");
          await new Promise(resolve => setTimeout(resolve, 250));
          const allImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'all-sessions-preview.png'), allImage.toPNG());
          await win.webContents.executeJavaScript("switchTab('trends'); const preset=document.querySelector('#rangePreset'); preset.value='billing'; preset.dispatchEvent(new Event('change'))");
          await new Promise(resolve => setTimeout(resolve, 350));
          const rangeImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'date-range-preview.png'), rangeImage.toPNG());
          await win.webContents.executeJavaScript("switchTab('sessions')");
          await new Promise(resolve => setTimeout(resolve, 250));
          const sessionsImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'pagination-preview.png'), sessionsImage.toPNG());
          await win.webContents.executeJavaScript("switchTab('requests')");
          await new Promise(resolve => setTimeout(resolve, 250));
          const requestsImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'requests-preview.png'), requestsImage.toPNG());
          await win.webContents.executeJavaScript("document.querySelector('#requestSessionSelectButton').click()");
          await new Promise(resolve => setTimeout(resolve, 200));
          const requestDropdownImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'request-dropdown-preview.png'), requestDropdownImage.toPNG());
          await win.webContents.executeJavaScript("document.querySelector('[data-tab=settings]').click(); const slider=document.querySelector('#scaleSlider'); slider.value=90; slider.dispatchEvent(new Event('input'))");
          await new Promise(resolve => setTimeout(resolve, 400));
          const settingsImage = await win.webContents.capturePage();
          fs.writeFileSync(path.join(__dirname, '..', 'settings-preview.png'), settingsImage.toPNG());
          const pageHeights = await win.webContents.executeJavaScript(`(async () => { const result={}; for (const tab of ['current','today','all','trends','sessions','requests','settings']) { switchTab(tab); await new Promise(r=>setTimeout(r,60)); const page=document.querySelector('#tab-'+tab); result[tab]={page:page.scrollHeight,content:document.querySelector('.dashboard-content').clientHeight}; } return result; })()`);
          console.log(`PAGE_HEIGHTS ${JSON.stringify(pageHeights)}`);
          app.isQuitting = true;
          app.quit();
        }, 1000);
      }, 3000);
    });
  }
}

function friendlyError(error) {
  const message = String(error?.message || error);
  if (/no such table|no such column|SQLITE_ERROR/i.test(message)) return '当前 WorkBuddy 数据结构与这一版小哇不兼容。请更新 WorkBuddy 或小哇后再试。';
  if (/database is locked|SQLITE_BUSY/i.test(message)) return 'WorkBuddy 数据正在被占用，小哇会自动重试。';
  if (/EACCES|permission/i.test(message)) return '没有权限读取 WorkBuddy 本地数据，请检查文件权限。';
  return message;
}

let updateState = { state: 'idle', currentVersion: app.getVersion(), availableVersion: '', percent: 0, message: '尚未检查更新' };

function publishUpdateState(patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    currentVersion: app.getVersion(),
    packaged: app.isPackaged
  };
  if (win && !win.isDestroyed()) win.webContents.send('update:state', updateState);
  return updateState;
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    return publishUpdateState({ state: 'disabled', message: '开发模式不检查更新' });
  }
  if (['checking', 'downloading'].includes(updateState.state)) return updateState;
  publishUpdateState({ state: 'checking', message: manual ? '正在检查更新…' : '正在后台检查更新…', percent: 0 });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publishUpdateState({ state: 'error', message: `检查更新失败：${String(error.message || error).split('\n')[0]}`, percent: 0 });
  }
  return updateState;
}

async function downloadUpdate() {
  if (!app.isPackaged) return publishUpdateState({ state: 'disabled', message: '开发模式不支持更新' });
  if (updateState.state === 'downloading') return updateState;
  publishUpdateState({ state: 'downloading', percent: 0, message: '正在下载更新…' });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    publishUpdateState({ state: 'error', message: `下载更新失败：${String(error.message || error).split('\n')[0]}` });
  }
  return updateState;
}

function installUpdate() {
  if (!app.isPackaged || updateState.state !== 'downloaded') return updateState;
  app.isQuitting = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return updateState;
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: message => console.log('[updater]', message),
    warn: message => console.warn('[updater]', message),
    error: message => console.error('[updater]', message),
    debug: () => {}
  };
  autoUpdater.on('checking-for-update', () => publishUpdateState({ state: 'checking', message: '正在检查更新…' }));
  autoUpdater.on('update-available', info => publishUpdateState({
    state: 'available',
    availableVersion: info.version,
    percent: 0,
    message: `发现新版本 v${info.version}`
  }));
  autoUpdater.on('update-not-available', info => publishUpdateState({
    state: 'current',
    availableVersion: info.version || '',
    percent: 0,
    message: '当前已经是最新版本'
  }));
  autoUpdater.on('download-progress', progress => publishUpdateState({
    state: 'downloading',
    percent: Math.round(progress.percent || 0),
    message: `正在下载更新 ${Math.round(progress.percent || 0)}%`
  }));
  autoUpdater.on('update-downloaded', info => publishUpdateState({
    state: 'downloaded',
    availableVersion: info.version,
    percent: 100,
    message: `v${info.version} 已下载，重启后安装`
  }));
  autoUpdater.on('error', error => publishUpdateState({
    state: 'error',
    message: `更新失败：${String(error?.message || error).split('\n')[0]}`
  }));

  if (!app.isPackaged) {
    publishUpdateState({ state: 'disabled', message: '开发模式不检查更新' });
    return;
  }
  if (settings.autoCheckUpdates) setTimeout(() => checkForUpdates(false), 20000);
}

async function refreshUsage() {
  if (!win) return;
  try { win.webContents.send('usage:update', getUsageData()); }
  catch (error) { win.webContents.send('usage:error', friendlyError(error)); }
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  repairShortcutIcons();
  setupAutoUpdater();
  refreshUsage();
  refreshTimer = setInterval(refreshUsage, 5000);
  ipcMain.handle('usage:refresh', async () => {
    try { return getUsageData(); }
    catch (error) { return { error: friendlyError(error) }; }
  });
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('update:get-state', () => updateState);
  ipcMain.handle('update:check', () => checkForUpdates(true));
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.on('settings:update', (_event, patch) => {
    settings = {
      ...settings,
      scale: Math.max(0.6, Math.min(1.5, Number(patch.scale ?? settings.scale))),
      opacity: Math.max(0.3, Math.min(1, Number(patch.opacity ?? settings.opacity))),
      processingEnabled: Boolean(patch.processingEnabled ?? settings.processingEnabled),
      processingDelay: Math.max(0, Math.min(5000, Number(patch.processingDelay ?? settings.processingDelay))),
      completionEnabled: Boolean(patch.completionEnabled ?? settings.completionEnabled),
      completionDuration: Math.max(1000, Math.min(60000, Number(patch.completionDuration ?? settings.completionDuration))),
      statsEnabled: Boolean(patch.statsEnabled ?? settings.statsEnabled),
      statsDuration: Math.max(3000, Math.min(60000, Number(patch.statsDuration ?? settings.statsDuration))),
      hoverPause: Boolean(patch.hoverPause ?? settings.hoverPause),
      backgroundNotifications: Boolean(patch.backgroundNotifications ?? settings.backgroundNotifications),
      soundEnabled: Boolean(patch.soundEnabled ?? settings.soundEnabled),
      dndEnabled: Boolean(patch.dndEnabled ?? settings.dndEnabled),
      dndStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.dndStart ?? settings.dndStart) ? (patch.dndStart ?? settings.dndStart) : '22:00',
      dndEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(patch.dndEnd ?? settings.dndEnd) ? (patch.dndEnd ?? settings.dndEnd) : '08:00',
      autoCheckUpdates: Boolean(patch.autoCheckUpdates ?? settings.autoCheckUpdates)
    };
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    win?.setOpacity(settings.opacity);
    if (win && !expanded) {
      const old = win.getBounds();
      const size = petSize();
      win.setBounds(clampToDisplay({ ...size, x: old.x + old.width - size.width, y: old.y + old.height - size.height }), true);
    }
    win?.webContents.send('settings:changed', settings);
  });
  ipcMain.on('panel:toggle', (_event, show) => togglePanel(show));
  ipcMain.on('pet:context-menu', () => showPetContextMenu());
  ipcMain.on('drag:start', () => {
    if (!win) return;
    dragOrigin = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  });
  ipcMain.on('drag:move', () => {
    if (!win || !dragOrigin || expanded) return;
    const cursor = screen.getCursorScreenPoint();
    win.setPosition(dragOrigin.bounds.x + cursor.x - dragOrigin.cursor.x, dragOrigin.bounds.y + cursor.y - dragOrigin.cursor.y);
  });
  ipcMain.on('drag:end', () => { dragOrigin = null; });
  ipcMain.on('window:minimize', () => win?.hide());
  ipcMain.on('window:close', () => win?.hide());
  ipcMain.on('open:data-folder', () => shell.openPath(path.join(require('node:os').homedir(), '.workbuddy')));
});

app.on('before-quit', () => { app.isQuitting = true; clearInterval(refreshTimer); });
app.on('window-all-closed', event => event.preventDefault());
