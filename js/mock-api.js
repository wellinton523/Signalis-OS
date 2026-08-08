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
    minimize: () => Promise.resolve(),
    maximize: () => Promise.resolve(),
    close: () => { if (confirm('Fechar o SIGNALIS-OS?')) window.close() },

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

    // ── Mídia ─────────────────────────────────────────────────
    musicControl:   (action, value) => request('/api/system/music', { method: 'POST', body: { action, value } }),

    // ── Spotify ───────────────────────────────────────────────
    spotifySearch:    (query, limit)      => request('/api/spotify/search',   { method: 'POST', body: { query, limit } }),
    spotifyPlay:      (uri)               => request('/api/spotify/play',     { method: 'POST', body: { uri } }),
    spotifyPlaylist:  (uri, playlist_id)  => request('/api/spotify/playlist', { method: 'POST', body: { uri, playlist_id } }),
    spotifyStatus:    ()                  => request('/api/spotify/status',   { method: 'POST' })
  }
})()
