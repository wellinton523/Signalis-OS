class ToolManager {
  constructor({ permissions = window.permissionManager } = {}) {
    this._tools = new Map()
    this._permissions = permissions
  }

  register(tool) {
    this._validate(tool)
    if (this._tools.has(tool.name)) throw new Error(`Tool já registrada: ${tool.name}`)
    this._tools.set(tool.name, Object.freeze({ ...tool }))
    return this.get(tool.name)
  }

  get(name) { return this._tools.get(name) }

  list() { return [...this._tools.values()] }

  search(query) {
    const term = String(query || '').toLowerCase()
    return this.list().filter(tool =>
      `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(term)
    )
  }

  // Converte nome interno "a.b.c" → "a_b_c" para compatibilidade com o schema OpenAI/Ollama
  // (function name deve ser /^[a-zA-Z0-9_-]{1,64}$/)
  static toFuncName(name) {
    return String(name).replace(/\./g, '_')
  }

  // Reverte "a_b_c" de volta para o nome interno tentando correspondência exata
  resolveFuncName(funcName) {
    // tentativa direta (caso o modelo devolva o nome com ponto — alguns modelos preservam)
    if (this._tools.has(funcName)) return funcName
    // converte underscore para ponto e testa
    const dotName = String(funcName).replace(/_/g, '.')
    if (this._tools.has(dotName)) return dotName
    // busca parcial: pega a primeira tool cujo toFuncName bate
    for (const [name] of this._tools) {
      if (ToolManager.toFuncName(name) === funcName) return name
    }
    return null
  }

  toModelTools() {
    return this.list().map(tool => ({
      type: 'function',
      function: {
        name: ToolManager.toFuncName(tool.name),
        description: tool.description,
        parameters: tool.parameters || { type: 'object', properties: {} }
      }
    }))
  }

  async discover(manifestUrl = '/api/tools') {
    const response = await fetch(manifestUrl)
    if (!response.ok) throw new Error(`Falha ao descobrir tools: HTTP ${response.status}`)
    const manifest = await response.json()
    const sources = Array.isArray(manifest.tools) ? manifest.tools : []
    await Promise.all(sources.map(source => this._loadScript(source)))
    return this.list()
  }

  async execute(name, args = {}, context = {}) {
    const tool = this.get(name)
    if (!tool) throw new Error(`Tool não encontrada: ${name}`)
    if (!this._permissions.can(tool.permission)) {
      throw new Error(`Permissão insuficiente: ${tool.name} requer ${this._permissionName(tool.permission)}.`)
    }
    return tool.execute(args, { ...context, tool, permissions: this._permissions })
  }

  _validate(tool) {
    if (!tool || typeof tool !== 'object') throw new Error('Tool inválida.')
    if (!/^[a-z][a-z0-9_.-]*$/i.test(tool.name || '')) throw new Error('Nome de tool inválido.')
    if (typeof tool.description !== 'string' || typeof tool.execute !== 'function') {
      throw new Error(`Manifesto inválido para ${tool.name || 'tool'}.`)
    }
    if (!Number.isInteger(tool.permission)) throw new Error(`Permissão inválida para ${tool.name}.`)
  }

  _loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = source
      script.async = false
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Não foi possível carregar a tool: ${source}`))
      document.head.appendChild(script)
    })
  }

  _permissionName(level) {
    return Object.keys(window.PermissionName).find(name => window.PermissionName[name] === level)
  }
}

window.ToolManager = ToolManager
window.toolManager = new ToolManager()
