// workspace.js — Espaços de trabalho de navegador (perfis de URLs)
// ─────────────────────────────────────────────────────────────
// Um "workspace" é um conjunto nomeado de URLs. Ao carregar,
// todas as URLs abrem em sequência. Útil para "modo trabalho",
// "modo estudo", "modo notícias", etc.
//
// Storage: localStorage.aris9_workspaces
//   { nome: { name, urls[], description, createdAt, updatedAt, opens } }
// ─────────────────────────────────────────────────────────────
;(function () {
  const WS_KEY = 'aris9_workspaces'

  function _load () {
    try { return JSON.parse(localStorage.getItem(WS_KEY) || '{}') }
    catch { return {} }
  }
  function _save (data) { localStorage.setItem(WS_KEY, JSON.stringify(data)) }
  function _norm (s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').slice(0, 40)
  }
  function _validateUrl (u) {
    return /^https?:\/\//i.test(String(u || '').trim())
  }

  // Expor para uso direto do terminal
  window.aris9Workspaces = { all: _load }

  // ── browser.workspace.save ─────────────────────────────────
  window.toolManager.register({
    name: 'browser.workspace.save', version: '1.0.0', category: 'browser',
    description: 'Salva um conjunto nomeado de URLs como espaço de trabalho ("modo trabalho", "modo estudo"). Depois basta pedir para "abrir modo X" para lançar tudo de uma vez.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Identificador curto (ex: "trabalho").' },
        urls:        { type: 'array', items: { type: 'string' }, description: 'Lista de URLs HTTP/HTTPS.' },
        description: { type: 'string', description: 'Uma linha resumindo o workspace.' }
      },
      required: ['name', 'urls']
    },
    async execute ({ name, urls, description = '' }) {
      const key = _norm(name)
      if (!key) throw new Error('Nome inválido.')
      if (!Array.isArray(urls) || urls.length === 0) throw new Error('Lista de URLs vazia.')
      const invalid = urls.filter(u => !_validateUrl(u))
      if (invalid.length) throw new Error(`URL(s) inválida(s): ${invalid.join(', ')}`)
      if (urls.length > 20) throw new Error('Máximo de 20 URLs por workspace.')

      const store = _load()
      const now = new Date().toISOString()
      const existed = store[key]
      store[key] = {
        name: key,
        urls: urls.map(u => String(u).trim()),
        description: String(description || '').slice(0, 200),
        createdAt: existed?.createdAt || now,
        updatedAt: now,
        opens: existed?.opens || 0
      }
      _save(store)
      return { saved: true, name: key, urls: store[key].urls.length, overwritten: !!existed }
    }
  })

  // ── browser.workspace.list ─────────────────────────────────
  window.toolManager.register({
    name: 'browser.workspace.list', version: '1.0.0', category: 'browser',
    description: 'Lista todos os workspaces de navegador salvos.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute () {
      const store = _load()
      return Object.values(store)
        .sort((a, b) => (b.opens || 0) - (a.opens || 0))
        .map(w => ({
          name: w.name,
          urls: w.urls?.length || 0,
          description: w.description,
          opens: w.opens || 0
        }))
    }
  })

  // ── browser.workspace.get ──────────────────────────────────
  window.toolManager.register({
    name: 'browser.workspace.get', version: '1.0.0', category: 'browser',
    description: 'Mostra o detalhe de um workspace (nome, descrição e URLs).',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    async execute ({ name }) {
      const key = _norm(name)
      const w = _load()[key]
      if (!w) return { found: false, name: key }
      return { found: true, ...w }
    }
  })

  // ── browser.workspace.delete ───────────────────────────────
  window.toolManager.register({
    name: 'browser.workspace.delete', version: '1.0.0', category: 'browser',
    description: 'Remove permanentemente um workspace de navegador.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    async execute ({ name }) {
      const key = _norm(name)
      const store = _load()
      if (!store[key]) return { deleted: false, name: key }
      delete store[key]
      _save(store)
      return { deleted: true, name: key }
    }
  })

  // ── browser.workspace.open ─────────────────────────────────
  window.toolManager.register({
    name: 'browser.workspace.open', version: '1.0.0', category: 'browser',
    description: 'Abre todas as URLs de um workspace salvo em sequência (ex: abrir "modo trabalho" lança Gmail, Slack e Jira).',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:    { type: 'string' },
        delayMs: { type: 'integer', description: 'Intervalo entre aberturas (ms). Padrão: 250.' }
      },
      required: ['name']
    },
    async execute ({ name, delayMs = 250 }) {
      const key = _norm(name)
      const store = _load()
      const w = store[key]
      if (!w) throw new Error(`Workspace não encontrado: ${key}`)
      const r = await window.toolManager.execute('browser.openMulti', { urls: w.urls, delayMs }, { source: 'workspace' })
      w.opens = (w.opens || 0) + 1
      w.lastOpenedAt = new Date().toISOString()
      _save(store)
      return { workspace: key, ...r }
    }
  })
})()
