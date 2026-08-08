// memory.js — Memória persistente do ARIS-9 (localStorage)
// Namespaces separados:
//   aris9_memory        — pares chave/valor definidos pelo usuário ou pela IA
//   aris9_task_history  — log automático de tarefas executadas (gerenciado por agent.js)
//   aris9_context       — contexto de conversas salvo manualmente
;(function () {
  const MEM_KEY  = 'aris9_memory'
  const CTX_KEY  = 'aris9_context'
  const HIST_KEY = 'aris9_task_history'

  function _loadStore(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} }
  }
  function _saveStore(key, data) {
    localStorage.setItem(key, JSON.stringify(data))
  }
  function _loadList(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  }

  // ── memory.set ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.set', version: '2.0.0', category: 'memory',
    description: 'Armazena um valor na memória persistente do ARIS-9 sob uma chave nomeada. Use para guardar preferências, caminhos favoritos, projetos recentes, etc.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        key:   { type: 'string', description: 'Nome da chave (ex: "projeto_atual", "pasta_favorita").' },
        value: { description: 'Valor a armazenar (texto, número ou objeto).' },
        tags:  { type: 'array', items: { type: 'string' }, description: 'Tags opcionais para organização (ex: ["projeto", "trabalho"]).' }
      },
      required: ['key', 'value']
    },
    async execute({ key, value, tags = [] }) {
      if (!key || typeof key !== 'string') throw new Error('A chave é obrigatória.')
      const store = _loadStore(MEM_KEY)
      store[key] = { value, tags: Array.isArray(tags) ? tags : [], updatedAt: new Date().toISOString() }
      _saveStore(MEM_KEY, store)
      return { key, stored: true }
    }
  })

  // ── memory.get ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.get', version: '2.0.0', category: 'memory',
    description: 'Recupera um valor armazenado na memória persistente do ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Nome da chave a recuperar.' }
      },
      required: ['key']
    },
    async execute({ key }) {
      if (!key || typeof key !== 'string') throw new Error('A chave é obrigatória.')
      const entry = _loadStore(MEM_KEY)[key]
      if (!entry) return { key, found: false, value: null }
      return { key, found: true, value: entry.value, tags: entry.tags || [], updatedAt: entry.updatedAt }
    }
  })

  // ── memory.list ─────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.list', version: '2.0.0', category: 'memory',
    description: 'Lista todas as entradas armazenadas na memória persistente do ARIS-9. Filtrável por tag.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Filtra entradas que possuem esta tag (opcional).' }
      }
    },
    async execute({ tag } = {}) {
      const store = _loadStore(MEM_KEY)
      let entries = Object.entries(store).map(([key, e]) => ({
        key, value: e.value, tags: e.tags || [], updatedAt: e.updatedAt
      }))
      if (tag) entries = entries.filter(e => e.tags.includes(tag))
      return entries
    }
  })

  // ── memory.delete ───────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.delete', version: '2.0.0', category: 'memory',
    description: 'Remove uma entrada da memória persistente do ARIS-9.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Nome da chave a remover.' }
      },
      required: ['key']
    },
    async execute({ key }) {
      if (!key || typeof key !== 'string') throw new Error('A chave é obrigatória.')
      const store = _loadStore(MEM_KEY)
      const existed = key in store
      delete store[key]
      _saveStore(MEM_KEY, store)
      return { key, deleted: existed }
    }
  })

  // ── memory.search ───────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.search', version: '2.0.0', category: 'memory',
    description: 'Busca por texto nas chaves e valores da memória persistente.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo a procurar (busca em chaves, valores e tags).' }
      },
      required: ['query']
    },
    async execute({ query }) {
      if (!query) throw new Error('O termo de busca é obrigatório.')
      const term = String(query).toLowerCase()
      const store = _loadStore(MEM_KEY)
      return Object.entries(store)
        .filter(([key, e]) => {
          const valStr = typeof e.value === 'string' ? e.value : JSON.stringify(e.value)
          return key.toLowerCase().includes(term) ||
                 valStr.toLowerCase().includes(term) ||
                 (e.tags || []).some(t => t.toLowerCase().includes(term))
        })
        .map(([key, e]) => ({ key, value: e.value, tags: e.tags || [], updatedAt: e.updatedAt }))
    }
  })

  // ── memory.history ──────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.history', version: '2.0.0', category: 'memory',
    description: 'Retorna o histórico de tarefas recentes executadas pelo ARIS-9. Cada entrada contém data, ferramentas usadas e resumo da ação.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Número máximo de entradas a retornar. Padrão: 10.' }
      }
    },
    async execute({ limit = 10 } = {}) {
      const history = _loadList(HIST_KEY)
      return history.slice(0, Math.min(limit, 50))
    }
  })

  // ── memory.context.save ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.save', version: '2.0.0', category: 'memory',
    description: 'Salva o contexto atual de uma conversa ou sessão de trabalho para retomar depois.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Nome descritivo do contexto (ex: "projeto_site", "análise_vendas").' },
        content: { type: 'string', description: 'Texto livre descrevendo o estado atual da tarefa ou contexto.' }
      },
      required: ['name', 'content']
    },
    async execute({ name, content }) {
      if (!name) throw new Error('O nome é obrigatório.')
      const store = _loadStore(CTX_KEY)
      store[name] = { content, savedAt: new Date().toISOString() }
      _saveStore(CTX_KEY, store)
      return { name, saved: true }
    }
  })

  // ── memory.context.load ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.load', version: '2.0.0', category: 'memory',
    description: 'Carrega um contexto de conversa previamente salvo pelo ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Nome do contexto a recuperar.' }
      },
      required: ['name']
    },
    async execute({ name }) {
      if (!name) throw new Error('O nome é obrigatório.')
      const entry = _loadStore(CTX_KEY)[name]
      if (!entry) return { name, found: false, content: null }
      return { name, found: true, content: entry.content, savedAt: entry.savedAt }
    }
  })

  // ── memory.context.list ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.list', version: '2.0.0', category: 'memory',
    description: 'Lista todos os contextos de conversa salvos pelo ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const store = _loadStore(CTX_KEY)
      return Object.entries(store).map(([name, e]) => ({
        name, savedAt: e.savedAt, preview: String(e.content).slice(0, 80)
      }))
    }
  })

})()
