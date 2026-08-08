// macro.js — Fluxos salvos ("macros") do ARIS-9
// ─────────────────────────────────────────────────────────────
// Uma macro é um workflow nomeado + trigger textual que dispara
// uma sequência de ações. Fica em localStorage sob `aris9_macros`.
//
// Formato armazenado:
//   {
//     name: string,           // identificador único (ex: "backup_diario")
//     trigger: string,        // frase curta que dispara a macro (ex: "faz o backup")
//     description: string,    // 1 linha explicando o que faz
//     steps: [                // sequência a ser executada (mesmo formato do automation.flow)
//       { tool: 'nome.ferramenta', args: { ... } }
//     ],
//     createdAt: ISO,
//     updatedAt: ISO,
//     runs: number            // contador de execuções
//   }
// ─────────────────────────────────────────────────────────────
;(function () {
  const MACRO_KEY = 'aris9_macros'

  function _loadAll () {
    try { return JSON.parse(localStorage.getItem(MACRO_KEY) || '{}') }
    catch { return {} }
  }

  function _saveAll (data) {
    localStorage.setItem(MACRO_KEY, JSON.stringify(data))
  }

  function _normalizeName (s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '').slice(0, 40)
  }

  function _normalizeTrigger (s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  }

  // Expõe helpers para o terminal/agent consumirem
  window.aris9Macros = {
    all () { return _loadAll() },

    // Procura macro cuja trigger casa com o texto do usuário.
    // Regra: normaliza ambos (lowercase, colapsa espaços) e verifica se
    // o texto do usuário CONTÉM a trigger inteira como sequência.
    match (userText) {
      const norm = _normalizeTrigger(userText)
      if (!norm) return null
      const store = _loadAll()
      // Prioriza triggers mais longas (mais específicas)
      const list = Object.values(store).sort((a, b) => (b.trigger?.length || 0) - (a.trigger?.length || 0))
      for (const m of list) {
        const trig = _normalizeTrigger(m.trigger)
        if (trig && norm.includes(trig)) return m
      }
      return null
    },

    // Marca uma execução (incrementa contador)
    bumpRun (name) {
      const store = _loadAll()
      const m = store[name]
      if (!m) return
      m.runs = (m.runs || 0) + 1
      m.lastRunAt = new Date().toISOString()
      _saveAll(store)
    }
  }

  // ── macro.save ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'macro.save', version: '1.0.0', category: 'automation',
    description: 'Salva um fluxo de trabalho recorrente como macro nomeada, disparável por uma frase curta (trigger). Quando o usuário disser a trigger, a macro roda automaticamente. Use para tarefas que se repetem: "todo dia às 9h abrir X, Y e Z".',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string', description: 'Identificador curto (ex: "abre_trabalho").' },
        trigger:     { type: 'string', description: 'Frase curta que dispara a macro (ex: "modo trabalho").' },
        description: { type: 'string', description: 'Uma linha resumindo o que a macro faz.' },
        steps: {
          type: 'array',
          description: 'Sequência de ações: [{tool: "nome.ferramenta", args: {...}}, ...]',
          items: {
            type: 'object',
            properties: {
              tool: { type: 'string' },
              args: { type: 'object' }
            },
            required: ['tool']
          }
        }
      },
      required: ['name', 'trigger', 'steps']
    },
    async execute ({ name, trigger, description = '', steps }) {
      const key = _normalizeName(name)
      const trig = _normalizeTrigger(trigger)
      if (!key)  throw new Error('Nome inválido.')
      if (!trig) throw new Error('Trigger inválido.')
      if (!Array.isArray(steps) || steps.length === 0) throw new Error('A macro precisa de pelo menos 1 passo.')
      if (steps.length > 20) throw new Error('Máximo de 20 passos por macro.')

      // Valida que cada step aponta para uma tool conhecida
      for (const s of steps) {
        const t = String(s?.tool || '').trim()
        if (!t) throw new Error('Passo sem tool.')
        const resolved = window.toolManager.resolveFuncName?.(t)
        if (!resolved) throw new Error(`Tool desconhecida no passo: ${t}`)
      }

      const store = _loadAll()
      const now = new Date().toISOString()
      const existed = store[key]
      store[key] = {
        name: key,
        trigger: trig,
        description: String(description || '').slice(0, 200),
        steps: steps.map(s => ({ tool: String(s.tool).trim(), args: s.args ?? {} })),
        createdAt: existed?.createdAt || now,
        updatedAt: now,
        runs: existed?.runs || 0
      }
      _saveAll(store)
      return { saved: true, name: key, trigger: trig, steps: store[key].steps.length, overwritten: !!existed }
    }
  })

  // ── macro.list ──────────────────────────────────────────────
  window.toolManager.register({
    name: 'macro.list', version: '1.0.0', category: 'automation',
    description: 'Lista todas as macros/fluxos salvos, com trigger e resumo. Use quando o usuário perguntar "quais macros/fluxos tenho".',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute () {
      const store = _loadAll()
      return Object.values(store)
        .sort((a, b) => (b.runs || 0) - (a.runs || 0))
        .map(m => ({
          name: m.name,
          trigger: m.trigger,
          description: m.description,
          steps: m.steps?.length || 0,
          runs: m.runs || 0
        }))
    }
  })

  // ── macro.get ───────────────────────────────────────────────
  window.toolManager.register({
    name: 'macro.get', version: '1.0.0', category: 'automation',
    description: 'Retorna o detalhe completo de uma macro salva pelo nome, incluindo passos.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    async execute ({ name }) {
      const key = _normalizeName(name)
      const store = _loadAll()
      const m = store[key]
      if (!m) return { found: false, name: key }
      return { found: true, ...m }
    }
  })

  // ── macro.delete ────────────────────────────────────────────
  window.toolManager.register({
    name: 'macro.delete', version: '1.0.0', category: 'automation',
    description: 'Remove permanentemente uma macro salva pelo nome.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name']
    },
    async execute ({ name }) {
      const key = _normalizeName(name)
      const store = _loadAll()
      if (!store[key]) return { deleted: false, name: key }
      delete store[key]
      _saveAll(store)
      return { deleted: true, name: key }
    }
  })

  // ── macro.run ───────────────────────────────────────────────
  window.toolManager.register({
    name: 'macro.run', version: '1.0.0', category: 'automation',
    description: 'Executa uma macro salva pelo nome. Roda os passos em ordem, parando no primeiro erro por padrão.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:        { type: 'string' },
        stopOnError: { type: 'boolean', description: 'Interrompe no 1º erro. Padrão: true.' }
      },
      required: ['name']
    },
    async execute ({ name, stopOnError = true }, ctx = {}) {
      const key = _normalizeName(name)
      const store = _loadAll()
      const macro = store[key]
      if (!macro) throw new Error(`Macro não encontrada: ${key}`)

      const results = []
      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i]
        const internal = window.toolManager.resolveFuncName?.(step.tool) ?? step.tool
        try {
          const r = await window.toolManager.execute(internal, step.args || {}, { source: 'macro', macro: key })
          results.push({ step: i + 1, tool: internal, ok: true, result: r })
        } catch (err) {
          results.push({ step: i + 1, tool: internal, ok: false, error: err.message })
          if (stopOnError) break
        }
      }

      // Incrementa contador
      window.aris9Macros.bumpRun(key)
      return { macro: key, ran: results.length, results }
    }
  })

  // ── macro.saveLast ──────────────────────────────────────────
  // Salva as últimas N ações executadas pelo ARIS-9 como uma macro.
  // Puxa do histórico local `aris9_task_history` (mantido por agent.js).
  window.toolManager.register({
    name: 'macro.saveLast', version: '1.0.0', category: 'automation',
    description: 'Converte a última tarefa executada pelo ARIS-9 em uma macro reutilizável. Use quando o usuário pedir "salva isso como fluxo/macro".',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        name:    { type: 'string', description: 'Nome da nova macro.' },
        trigger: { type: 'string', description: 'Frase curta que vai disparar a macro depois.' }
      },
      required: ['name', 'trigger']
    },
    async execute ({ name, trigger }) {
      let history
      try { history = JSON.parse(localStorage.getItem('aris9_task_history') || '[]') }
      catch { history = [] }
      const last = history[0]
      if (!last || !Array.isArray(last.tools) || last.tools.length === 0) {
        throw new Error('Nenhuma tarefa recente com ações para salvar.')
      }
      // O histórico atual guarda apenas nomes de tools, sem args → salva placeholders
      const steps = last.tools.map(t => ({ tool: t, args: {} }))
      return await window.toolManager.execute('macro.save', {
        name, trigger, description: (last.summary || '').slice(0, 200), steps
      }, { source: 'macro.saveLast' })
    }
  })
})()
