// local-api.js kept under the original filename for compatibility with index.html.
// All system operations are served by the authenticated local SIGNALIS-OS server.
(function () {
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text()
    if (!response.ok) throw new Error(typeof payload === 'string' ? payload : payload.error || `HTTP ${response.status}`)
    return payload
  }

  window.api = {
    minimize: () => window.electronAPI ? window.electronAPI.minimize() : Promise.resolve(),
    maximize: () => window.electronAPI ? window.electronAPI.maximize() : Promise.resolve(),
    close:    () => {
      if (window.electronAPI) { window.electronAPI.close(); return }
      if (confirm('Fechar o SIGNALIS-OS?')) window.close()
    },

    // ── Filesystem ────────────────────────────────────────────
    homedir:        () => request('/api/fs/home', { method: 'POST' }).then(data => data.path),
    readdir:        path => request('/api/fs/list', { method: 'POST', body: { path } }),
    readfile:       path => request('/api/fs/read', { method: 'POST', body: { path } }).then(data => data.content),
    writefile:      (path, content) => request('/api/fs/write', { method: 'POST', body: { path, content } }),
    mkdir:          path => request('/api/fs/mkdir', { method: 'POST', body: { path } }),
    copy:           (path, destination) => request('/api/fs/copy', { method: 'POST', body: { path, destination } }),
    move:           (path, destination) => request('/api/fs/move', { method: 'POST', body: { path, destination } }),
    remove:         path => request('/api/fs/delete', { method: 'POST', body: { path } }),
    searchFiles:    (path, query) => request('/api/fs/search', { method: 'POST', body: { path, query } }),
    rename:         (path, newName) => request('/api/fs/rename', { method: 'POST', body: { path, newName } }),
    findDuplicates: (path, recursive) => request('/api/fs/duplicates', { method: 'POST', body: { path, recursive } }),
    organizeDir:    (path, dryRun) => request('/api/fs/organize', { method: 'POST', body: { path, dryRun } }),
    compress:       (path, destination) => request('/api/fs/compress', { method: 'POST', body: { path, destination } }),
    extract:        (path, destination) => request('/api/fs/extract', { method: 'POST', body: { path, destination } }),

    // ── System ────────────────────────────────────────────────
    open:           target => request('/api/system/open', { method: 'POST', body: { target } }),
    sysInfo:        () => request('/api/system/info'),
    cpuUsage:       () => request('/api/system/cpu').then(data => data.usage),
    diskUsage:      () => request('/api/system/disk'),
    listProcs:      () => request('/api/system/processes'),
    killProc:       pid => request('/api/system/kill', { method: 'POST', body: { pid } }),
    exec:           command => request('/api/system/exec', { method: 'POST', body: { command } }),
    clipboardGet:   () => request('/api/system/clipboard/get', { method: 'POST' }),
    clipboardSet:   text => request('/api/system/clipboard/set', { method: 'POST', body: { text } }),

    // ── Browser ───────────────────────────────────────────────
    browserFetch:   (url, maxChars) => request('/api/browser/fetch',  { method: 'POST', body: { url, maxChars } }),
    browserScrape:  (url, filter)   => request('/api/browser/scrape', { method: 'POST', body: { url, filter } }),
    networkRequest: (opts)          => request('/api/network/request', { method: 'POST', body: opts }),

    // ── VS Code ──
    vscodeOpen: (path, line, newWindow) => request('/api/vscode/open', { method: 'POST', body: { path, line, newWindow } }),
    vscodeDiff: (fileA, fileB)          => request('/api/vscode/diff', { method: 'POST', body: { fileA, fileB } }),

    // ── Git ──
    gitStatus: repoPath                 => request('/api/git/status', { method: 'POST', body: { repoPath } }),
    gitDiff:   (repoPath, staged, file) => request('/api/git/diff',   { method: 'POST', body: { repoPath, staged, file } }),
    gitLog:    (repoPath, limit)        => request('/api/git/log',    { method: 'POST', body: { repoPath, limit } }),
    gitAdd:    (repoPath, files)        => request('/api/git/add',    { method: 'POST', body: { repoPath, files } }),
    gitCommit: (repoPath, message)      => request('/api/git/commit', { method: 'POST', body: { repoPath, message } }),
    gitPush:   (repoPath, remote, branch) => request('/api/git/push', { method: 'POST', body: { repoPath, remote, branch } }),
    gitBranch: (repoPath, name)         => request('/api/git/branch', { method: 'POST', body: { repoPath, name } }),

    // ── Mídia ─────────────────────────────────────────────────
    musicControl:   (action, value) => request('/api/system/music', { method: 'POST', body: { action, value } }),

    // ── Spotify ───────────────────────────────────────────────
    spotifySearch:    (query, limit)      => request('/api/spotify/search',   { method: 'POST', body: { query, limit } }),
    spotifyPlay:      (uri, deviceId)     => request('/api/spotify/play',     { method: 'POST', body: { uri, device_id: deviceId } }),
    spotifyPlaylist:  (uri, playlist_id, deviceId) => request('/api/spotify/playlist', { method: 'POST', body: { uri, playlist_id, device_id: deviceId } }),
    spotifyStatus:    ()                  => request('/api/spotify/status',   { method: 'POST' }),

    // ── OAuth de usuário (playback real) ──
    spotifyLogin:     ()  => request('/api/spotify/auth/login',  { method: 'POST' }),
    spotifyAuthStatus: () => request('/api/spotify/auth/status', { method: 'POST' }),
    spotifyLogout:    ()  => request('/api/spotify/auth/logout', { method: 'POST' }),

    // ── Controle de playback real (exigem spotifyLogin antes) ──
    spotifyPause:     ()          => request('/api/spotify/pause',   { method: 'POST' }),
    spotifyResume:    ()          => request('/api/spotify/resume',  { method: 'POST' }),
    spotifyNext:      ()          => request('/api/spotify/next',    { method: 'POST' }),
    spotifyPrevious:  ()          => request('/api/spotify/previous',{ method: 'POST' }),
    spotifyDevices:   ()          => request('/api/spotify/devices', { method: 'POST' }),
    spotifyVolume:    (pct)       => request('/api/spotify/volume',  { method: 'POST', body: { volume_percent: pct } }),

    // ── Execução de código (faltava — code.run já espera isso) ──
    codeRun: (opts) => request('/api/code/run', { method: 'POST', body: opts }),

    // ── Base de conhecimento (pasta knowledge/) ──
    knowledgeList:    ()          => request('/api/knowledge/list',    { method: 'POST' }),
    knowledgeRead:    (file)      => request('/api/knowledge/read',    { method: 'POST', body: { file } }),
    knowledgeSearch:  (query)     => request('/api/knowledge/search',  { method: 'POST', body: { query } }),
    knowledgeSummary: (maxChars)  => request('/api/knowledge/summary', { method: 'POST', body: { maxChars } }),

    // ── Banco de dados de memória da IA (arquivo no servidor) ──
    memoryDbSet:          (key, value, tags) => request('/api/memorydb/set',           { method: 'POST', body: { key, value, tags } }),
    memoryDbGet:          (key)              => request('/api/memorydb/get',           { method: 'POST', body: { key } }),
    memoryDbList:         (tag)              => request('/api/memorydb/list',          { method: 'POST', body: { tag } }),
    memoryDbDelete:       (key)              => request('/api/memorydb/delete',        { method: 'POST', body: { key } }),
    memoryDbSearch:       (query)            => request('/api/memorydb/search',        { method: 'POST', body: { query } }),
    memoryDbContextSave:  (name, content)    => request('/api/memorydb/context_save',  { method: 'POST', body: { name, content } }),
    memoryDbContextLoad:  (name)             => request('/api/memorydb/context_load',  { method: 'POST', body: { name } }),
    memoryDbContextList:  ()                 => request('/api/memorydb/context_list',  { method: 'POST' })
  }

  // ── Ajustes de UI quando rodando dentro do Electron ─────────
  // (fora do Electron, window.electronAPI não existe e nada disso roda —
  // a UI continua em "BROWSER MODE" com o titlebar sem drag, como já era.)
  if (window.electronAPI?.isElectron) {
    document.addEventListener('DOMContentLoaded', () => {
      const titlebar = document.getElementById('titlebar')
      if (titlebar) titlebar.style.webkitAppRegion = 'drag'
      const controls = document.getElementById('titlebar-controls')
      if (controls) controls.style.webkitAppRegion = 'no-drag'
      const title = document.getElementById('titlebar-title')
      if (title) title.textContent = title.textContent.replace('BROWSER MODE', 'DESKTOP MODE')
    })
  }
})()