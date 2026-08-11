// memory.js — Memória persistente do ARIS-9 (banco de dados no servidor:
// data/ai_memory.json e data/ai_context.json — não mais localStorage,
// então sobrevive a limpeza de cache/navegador e é visível/inspecionável
// como arquivo real).
// Histórico de tarefas (memory.history) continua em localStorage, porque
// é um log auxiliar gerenciado pelo agent.js no cliente, não algo que a IA escreve.
;(function () {
  const HIST_KEY = 'aris9_task_history'

  function _loadList(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] }
  }

  // ── memory.set ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.set', version: '3.0.0', category: 'memory',
    description: 'Armazena um valor no banco de dados persistente do ARIS-9 (arquivo real no servidor, sobrevive a reinícios) sob uma chave nomeada. Use para guardar preferências, caminhos favoritos, projetos recentes, fatos relevantes que o usuário mencionou, etc.',
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
      return window.api.memoryDbSet(key, value, Array.isArray(tags) ? tags : [])
    }
  })

  // ── memory.get ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.get', version: '3.0.0', category: 'memory',
    description: 'Recupera um valor armazenado no banco de dados persistente do ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Nome da chave a recuperar.' } },
      required: ['key']
    },
    async execute({ key }) {
      if (!key || typeof key !== 'string') throw new Error('A chave é obrigatória.')
      return window.api.memoryDbGet(key)
    }
  })

  // ── memory.list ─────────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.list', version: '3.0.0', category: 'memory',
    description: 'Lista todas as entradas armazenadas no banco de dados persistente do ARIS-9. Filtrável por tag.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Filtra entradas que possuem esta tag (opcional).' } }
    },
    async execute({ tag } = {}) {
      const result = await window.api.memoryDbList(tag)
      return result.entries || []
    }
  })

  // ── memory.delete ───────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.delete', version: '3.0.0', category: 'memory',
    description: 'Remove uma entrada do banco de dados persistente do ARIS-9.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: { key: { type: 'string', description: 'Nome da chave a remover.' } },
      required: ['key']
    },
    async execute({ key }) {
      if (!key || typeof key !== 'string') throw new Error('A chave é obrigatória.')
      return window.api.memoryDbDelete(key)
    }
  })

  // ── memory.search ───────────────────────────────────────────
  window.toolManager.register({
    name: 'memory.search', version: '3.0.0', category: 'memory',
    description: 'Busca por texto nas chaves, valores e tags do banco de dados persistente.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Termo a procurar (busca em chaves, valores e tags).' } },
      required: ['query']
    },
    async execute({ query }) {
      if (!query) throw new Error('O termo de busca é obrigatório.')
      const result = await window.api.memoryDbSearch(query)
      return result.entries || []
    }
  })

  // ── memory.history ──────────────────────────────────────────
  // Continua em localStorage: é um log auxiliar client-side do agent.js,
  // não uma memória que a IA decide escrever — não faz sentido no banco de dados.
  window.toolManager.register({
    name: 'memory.history', version: '3.0.0', category: 'memory',
    description: 'Retorna o histórico de tarefas recentes executadas pelo ARIS-9. Cada entrada contém data, ferramentas usadas e resumo da ação.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Número máximo de entradas a retornar. Padrão: 10.' } }
    },
    async execute({ limit = 10 } = {}) {
      const history = _loadList(HIST_KEY)
      return history.slice(0, Math.min(limit, 50))
    }
  })

  // ── memory.context.save ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.save', version: '3.0.0', category: 'memory',
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
      return window.api.memoryDbContextSave(name, content)
    }
  })

  // ── memory.context.load ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.load', version: '3.0.0', category: 'memory',
    description: 'Carrega um contexto de conversa previamente salvo pelo ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nome do contexto a recuperar.' } },
      required: ['name']
    },
    async execute({ name }) {
      if (!name) throw new Error('O nome é obrigatório.')
      return window.api.memoryDbContextLoad(name)
    }
  })

  // ── memory.context.list ─────────────────────────────────────
  window.toolManager.register({
    name: 'memory.context.list', version: '3.0.0', category: 'memory',
    description: 'Lista todos os contextos de conversa salvos pelo ARIS-9.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const result = await window.api.memoryDbContextList()
      return result.entries || []
    }
  })

})()