const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const context = {
  window: {
    api: {
      readdir:        async path => [{ name: 'notes.txt', isDir: false, path: `${path}/notes.txt` }],
      readfile:       async path => `content: ${path}`,
      open:           async target => ({ opened: target }),
      listProcs:      async () => [{ pid: 123, name: 'demo.exe' }],
      killProc:       async pid => ({ ok: true, pid }),
      exec:           async command => ({ stdout: command, stderr: '', error: null }),
      rename:         async (path, newName) => ({ from: path, to: newName }),
      findDuplicates: async path => ({ duplicates: [], count: 0 }),
      organizeDir:    async path => ({ moved: 0, operations: [] }),
      compress:       async path => ({ archive: path + '.zip' }),
      extract:        async path => ({ extracted: path }),
      clipboardGet:   async () => ({ text: '' }),
      clipboardSet:   async text => ({ ok: true }),
      sysInfo:        async () => ({ hostname: 'test', cpuModel: 'x64', cpuCores: 4, uptime: 0, totalRam: 8e9, freeRam: 4e9 }),
      cpuUsage:       async () => 0,
      diskUsage:      async () => ({ total: 1e12, used: 5e11, free: 5e11 }),
      browserFetch:   async url => ({ url, text: '', truncated: false }),
      browserScrape:  async url => ({ url, titles: [], links: [], paragraphs: [] }),
      musicControl:      async (action) => ({ action, ok: true }),
      spotifySearch:     async (query, limit) => ({ tracks: [], playlists: [] }),
      spotifyPlay:       async (uri) => ({ opened: `https://open.spotify.com/track/${uri.split(':').pop()}`, uri }),
      spotifyPlaylist:   async (uri) => ({ opened: `https://open.spotify.com/playlist/${uri.split(':').pop()}`, uri }),
      spotifyStatus:     async () => ({ client_credentials_ok: false, note: 'test' }),
      mkdir:          async path => ({ created: true }),
      copy:           async (path, dst) => ({ from: path, to: dst }),
      move:           async (path, dst) => ({ from: path, to: dst }),
      remove:         async path => ({ deleted: true }),
      searchFiles:    async (path, query) => ({ results: [] }),
      writefile:      async (path, content) => ({ written: content.length }),
    },
    localStorage: (() => {
      const store = {}
      return {
        getItem:    key => store[key] ?? null,
        setItem:    (key, val) => { store[key] = val },
        removeItem: key => { delete store[key] }
      }
    })()
  }
}
context.window.window = context.window
vm.createContext(context)

const toolFiles = fs.readdirSync(path.join(__dirname, '..', 'js', 'tools'), { recursive: true })
  .filter(file => file.endsWith('.js'))
  .map(file => `./js/tools/${file.replace(/\\/g, '/')}`)

for (const file of [
  './js/core/permissions.js',
  './js/core/ToolManager.js',
  ...toolFiles
]) {
  const absolutePath = path.join(__dirname, '..', file)
  vm.runInContext(fs.readFileSync(absolutePath, 'utf8'), context, { filename: file })
}

;(async () => {
  assert.equal(context.window.permissionManager.name, 'restricted')
  assert.equal(context.window.toolManager.list().length, 51)
  assert.equal(context.window.toolManager.get('filesystem.list').category, 'filesystem')
  assert.equal(context.window.toolManager.get('system.exec').permission, context.window.Permission.GOD)

  const entries = await context.window.toolManager.execute('filesystem.list', { path: 'C:/test' })
  assert.equal(entries[0].path, 'C:/test/notes.txt')

  await assert.rejects(
    context.window.toolManager.execute('filesystem.open', { path: 'C:/test/notes.txt' }),
    /Permissão insuficiente/
  )

  context.window.toolManager.register({
    name: 'system.example',
    description: 'Ferramenta usada apenas no teste.',
    category: 'system',
    permission: context.window.Permission.ADMIN,
    execute: async () => 'ok'
  })
  await assert.rejects(
    context.window.toolManager.execute('system.example'),
    /Permissão insuficiente/
  )

  context.window.permissionManager.setByName('admin')
  assert.equal(await context.window.toolManager.execute('system.example'), 'ok')
  console.log('tool manager test ok')
})().catch(error => {
  console.error(error)
  process.exit(1)
})
