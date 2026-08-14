const { app, BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const http = require('node:http')

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8000
const SERVER_URL = `http://127.0.0.1:${PORT}`
const ROOT = path.join(__dirname, '..')

let pyProcess = null
let mainWindow = null

// ── Sobe o server.py como processo filho ────────────────────────
function startPythonServer () {
  // Se o Python global falhar, adicione o caminho do seu python.exe se for local
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'

  console.log(`[Electron] Tentando iniciar ${pythonCmd} server.py na pasta: ${ROOT}`)

  const child = spawn(pythonCmd, ['server.py'], {
    cwd: ROOT,
    // Herda o PATH atual do ambiente (incluindo correções do PowerShell)
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', d => process.stdout.write(`[server.py] ${d}`))
  child.stderr.on('data', d => process.stderr.write(`[server.py] ${d}`))

  child.on('error', err => {
    console.error('⚠️  Falha ao iniciar server.py — "python" não foi encontrado no PATH:', err.message)
  })

  child.on('exit', code => {
    console.log(`[server.py] Encerrou (código ${code})`)
    pyProcess = null
  })

  return child
}

// ── Espera o servidor responder antes de abrir a janela ─────────
function waitForServer (url, { timeoutMs = 8000, intervalMs = 300 } = {}) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, res => {
        res.resume() // descarta o corpo
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`[Electron] server.py não respondeu em ${url} após ${timeoutMs}ms.`))
          return
        }
        setTimeout(attempt, intervalMs)
      })
      req.setTimeout(2000, () => req.destroy())
    }
    attempt()
  })
}

// ── Janela principal ─────────────────────────────────────────────
function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    frame: false,            // Remove a moldura padrão da janela
    transparent: true,
    show: false,                // Esconde até estar pronto
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false            // 'false' permite carregar o preload sem limitações rígidas de sandbox local
    }
  })

  // Força exibição da janela no momento em que estiver pronta
  mainWindow.once('ready-to-show', () => {
    console.log(">>> EXIBINDO JANELA PRINCIPAL <<<")
    mainWindow.show()
  })

  mainWindow.loadURL(SERVER_URL)

  mainWindow.on('maximize',   () => mainWindow.webContents.send('window:state-changed', { maximized: true }))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state-changed', { maximized: false }))
  mainWindow.on('closed', () => { mainWindow = null })
}

// ── IPC: controles de janela ────────────────────────────────────
ipcMain.handle('window:minimize', () => mainWindow?.minimize())
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.handle('window:close', () => mainWindow?.close())
ipcMain.handle('window:isMaximized', () => !!mainWindow?.isMaximized())

// ── Inicialização ───────────────────────────────────────────────
app.whenReady().then(async () => {
  pyProcess = startPythonServer()

  try {
    console.log("[Electron] Aguardando servidor Python responder...")
    await waitForServer(SERVER_URL)
    console.log("[Electron] Servidor Python OK!")
  } catch (err) {
    console.error(err.message)
    console.log("[Electron] Abrindo janela mesmo sem resposta inicial do servidor...")
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (pyProcess && !pyProcess.killed) {
    pyProcess.kill()
  }
})

console.log(">>> MAIN PROCESS INICIADO COM SUCESSO <<<")