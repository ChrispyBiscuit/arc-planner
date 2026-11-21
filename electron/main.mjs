// Desktop shell: runs the Arc server in this process, shows the dashboard in a window, keeps running in the tray so
// Claude can reach the MCP endpoint while the window is closed, and updates itself from GitHub releases.
import { app, BrowserWindow, Tray, Menu, shell, dialog, nativeImage, Notification } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import updater from 'electron-updater'
import { desktop } from '../lib/desktop.mjs'

const { autoUpdater } = updater
const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = +(process.env.ARC_PORT || 4747)
const URL = `http://127.0.0.1:${PORT}`
const ICON = join(HERE, '..', 'build', 'icon.png')
const HIDDEN = process.argv.includes('--hidden')

// The plan lives with the user's data, never in the install folder, so updates and reinstalls leave it alone.
// Set unconditionally: an ARC_DATA inherited from the environment must never redirect the installed app.
process.env.ARC_DATA = join(app.getPath('userData'), 'plan.json')
process.env.ARC_VERSION = app.getVersion()

let win = null
let tray = null
let quitting = false
let updateState = 'Up to date'

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.whenReady().then(boot)
}

async function boot() {
  try {
    const { start } = await import('../server.mjs')
    await start(PORT)
  } catch (e) {
    if (e.code !== 'EADDRINUSE') {
      dialog.showErrorBox('Arc could not start', String(e.message || e))
      return app.quit()
    }
    // Something already serves the port. If it is Arc (for example `node server.mjs`), show that; otherwise stop.
    const ok = await fetch(`${URL}/api/version`).then((r) => r.ok, () => false)
    if (!ok) {
      dialog.showErrorBox('Arc could not start', `Port ${PORT} is in use by another program. Close it, or set ARC_PORT to a free port.`)
      return app.quit()
    }
  }
  buildTray()
  if (!HIDDEN) show()
  if (app.isPackaged) startUpdates()
}

function show() {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    return win.focus()
  }
  win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1b1b1b',
    autoHideMenuBar: true,
    icon: ICON,
    title: 'Arc',
    webPreferences: { contextIsolation: true, sandbox: true }
  })
  win.loadURL(URL)
  // Links that leave the dashboard open in the browser, not in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL)) e.preventDefault()
  })
  // Closing the window keeps Arc in the tray, so the MCP endpoint stays up for Claude.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
  win.on('closed', () => (win = null))
}

function buildTray() {
  tray ||= new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }))
  tray.setToolTip('Arc')
  tray.removeAllListeners('click')
  tray.on('click', show)
  const login = app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Arc', click: show },
      { type: 'separator' },
      { label: `Version ${app.getVersion()}`, enabled: false },
      { label: updateState, enabled: false },
      { label: 'Check for updates', enabled: app.isPackaged, click: () => checkNow(true) },
      updateState.startsWith('Restart') ? { label: 'Restart and update', click: () => ((quitting = true), autoUpdater.quitAndInstall()) } : null,
      { type: 'separator' },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: login,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] })
          buildTray()
        }
      },
      { label: 'Open data folder', click: () => shell.openPath(dirname(process.env.ARC_DATA)) },
      { type: 'separator' },
      { label: 'Quit Arc', click: () => ((quitting = true), app.quit()) }
    ].filter(Boolean))
  )
}

// ---- auto-update: GitHub releases, downloaded in the background, applied on the next quit ---------------------------
let askedByUser = false
function setUpdate(state) {
  updateState = state
  buildTray()
}
function checkNow(byUser) {
  askedByUser = !!byUser
  autoUpdater.checkForUpdates().catch((e) => {
    setUpdate('Update check failed')
    if (askedByUser) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: String(e.message || e) })
  })
}
desktop.status = () => ({ desktop: true, version: app.getVersion(), state: updateState, ready: updateState.startsWith('Restart'), packaged: app.isPackaged })
desktop.check = () => app.isPackaged && checkNow(false)
desktop.install = () => {
  if (!updateState.startsWith('Restart')) return
  quitting = true
  autoUpdater.quitAndInstall()
}
function startUpdates() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => setUpdate('Checking for updates…'))
  autoUpdater.on('update-available', (i) => setUpdate(`Downloading ${i.version}…`))
  autoUpdater.on('update-not-available', () => {
    setUpdate('Up to date')
    if (askedByUser) dialog.showMessageBox({ type: 'info', message: `Arc ${app.getVersion()} is the latest version.` })
  })
  autoUpdater.on('error', () => setUpdate('Update check failed'))
  autoUpdater.on('update-downloaded', (i) => {
    setUpdate(`Restart to update to ${i.version}`)
    if (Notification.isSupported()) {
      const n = new Notification({ title: `Arc ${i.version} is ready`, body: 'It installs the next time Arc quits. Click to restart now.' })
      n.on('click', () => ((quitting = true), autoUpdater.quitAndInstall()))
      n.show()
    }
  })
  checkNow(false)
  setInterval(() => checkNow(false), 6 * 60 * 60 * 1000)
}

app.on('before-quit', () => (quitting = true))
app.on('window-all-closed', () => {}) // stay in the tray
