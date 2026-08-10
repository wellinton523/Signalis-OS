// aris9-enhancements.js — Melhorias comportamentais e de segurança do ARIS-9
// ─────────────────────────────────────────────────────────────────────
// Reúne recursos que estendem o comportamento do agente sem tocar em
// agent.js: personas, modo dry-run, modo somente-leitura, streaming
// visual, planner explícito, auto-crítica, `.again`, abort, undo,
// interpretação de erros em pt-BR, memória escopada, perfil de usuário,
// modo silencioso automático, resumo diário, detecção de fluxos
// repetidos, marketplace de tools e métricas.
// ─────────────────────────────────────────────────────────────────────
;(function () {
  const LS = {
    PREFS:      'aris9_agent_prefs',
    PROFILE:    'aris9_user_profile',
    UNDO:       'aris9_undo_stack',
    METRICS:    'aris9_metrics',
    DAILY:      'aris9_daily_summary',
    SCHEDULES:  'aris9_schedules',
    INSTALLED:  'aris9_installed_tools'
  }

  function _get (key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback }
    catch { return fallback }
  }
  function _set (key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  }

  // ── Preferências centrais do ARIS-9 ─────────────────────────
  const defaults = {
    persona:      'padrao',    // minimal|padrao|detalhado|brincalhao
    plannerMode:  false,       // mostra plano antes de agir em tarefas 3+ etapas
    selfEval:     false,       // agente critica a própria resposta antes de entregar
    dryRun:       false,       // simula ações sem executar
    readOnly:     false,       // bloqueia qualquer tool de escrita/execução
    autoConfirm:  false,       // ignora confirmações de ações irreversíveis
    silentAuto:   true,        // silencia toasts quando aba está em foco
    stream:       true,        // streaming visual (efeito de digitação)
    ttsAuto:      false,       // fala automaticamente as respostas
    ttsVoice:     'nova',      // voz OpenAI TTS
    ttsSpeed:     1.0,
    voiceAlwaysListen: false,  // após responder, reabre o mic automaticamente
    wakeWordEnabled:   false,  // ativa detecção de palavra-gatilho
    wakeWord:          'aris'  // palavra usada como gatilho
  }
  const prefs = { ...defaults, ..._get(LS.PREFS, {}) }
  function savePrefs () { _set(LS.PREFS, prefs) }

  window.aris9Prefs = {
    get () { return { ...prefs } },
    set (key, value) {
      if (!(key in defaults)) return false
      prefs[key] = value
      savePrefs()
      window.dispatchEvent(new CustomEvent('aris9:pref-changed', { detail: { key, value } }))
      return true
    },
    reset () { Object.assign(prefs, defaults); savePrefs() }
  }

  // ── Personas: injetadas dinamicamente no system prompt ─────
  const personaBlocks = {
    minimal:    'PERSONA: mínima. Respostas ultra-curtas, 1 frase quando possível, sem emojis, sem lista.',
    padrao:     'PERSONA: padrão. Frio, preciso, estética SIGNALIS-OS. Use markdown moderado.',
    detalhado:  'PERSONA: detalhado. Explique o porquê das decisões e dê alternativas em bullets.',
    brincalhao: 'PERSONA: brincalhão. Tom leve e amigável, ainda técnico. Uma pitada de humor seco.'
  }
  window.aris9Persona = { block: () => personaBlocks[prefs.persona] || personaBlocks.padrao }

  // ── Perfil de usuário: aprende preferências passivamente ────
  const profile = _get(LS.PROFILE, {
    createdAt: new Date().toISOString(),
    interactions: 0,
    lastTopics: [],
    preferredTone: null,
    knownIntents: {}  // {intent: count}
  })
  window.aris9Profile = {
    get () { return { ...profile } },
    bump (intent) {
      profile.interactions++
      if (intent) profile.knownIntents[intent] = (profile.knownIntents[intent] || 0) + 1
      profile.updatedAt = new Date().toISOString()
      _set(LS.PROFILE, profile)
    },
    addTopic (topic) {
      if (!topic) return
      profile.lastTopics = [topic, ...profile.lastTopics.filter(t => t !== topic)].slice(0, 20)
      _set(LS.PROFILE, profile)
    },
    profileBlock () {
      // Bloco compacto para injetar no prompt
      const top = Object.entries(profile.knownIntents)
        .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(', ')
      const topics = profile.lastTopics.slice(0, 5).join(', ')
      const lines = [`interações: ${profile.interactions}`]
      if (top) lines.push(`intenções frequentes: ${top}`)
      if (topics) lines.push(`tópicos recentes: ${topics}`)
      return `USER PROFILE: ${lines.join(' | ')}`
    }
  }

  // ── Undo global: pilha das últimas N ações reversíveis ─────
  const undoStack = _get(LS.UNDO, [])
  const UNDO_MAX = 20
  window.aris9Undo = {
    push (entry) {
      // entry: { at, description, undo: { tool, args } }
      if (!entry?.undo?.tool) return
      undoStack.unshift({ at: new Date().toISOString(), ...entry })
      if (undoStack.length > UNDO_MAX) undoStack.length = UNDO_MAX
      _set(LS.UNDO, undoStack)
    },
    peek () { return undoStack[0] || null },
    list () { return [...undoStack] },
    async runLast () {
      const e = undoStack.shift()
      if (!e) return { done: false, reason: 'pilha vazia' }
      _set(LS.UNDO, undoStack)
      const t = window.toolManager.resolveFuncName?.(e.undo.tool) ?? e.undo.tool
      try {
        const r = await window.toolManager.execute(t, e.undo.args || {}, { source: 'undo' })
        return { done: true, description: e.description, result: r }
      } catch (err) {
        return { done: false, reason: err.message }
      }
    }
  }

  // ── Métricas de uso ────────────────────────────────────────
  const metrics = _get(LS.METRICS, {
    turns: 0, toolsExec: 0, errors: 0, tokensIn: 0, tokensOut: 0,
    avgLatencyMs: 0, latencySamples: 0, byTool: {}
  })
  window.aris9Metrics = {
    get () { return { ...metrics } },
    logTurn (info = {}) {
      metrics.turns++
      if (info.tokensIn)  metrics.tokensIn  += info.tokensIn
      if (info.tokensOut) metrics.tokensOut += info.tokensOut
      if (typeof info.latencyMs === 'number') {
        metrics.avgLatencyMs = (metrics.avgLatencyMs * metrics.latencySamples + info.latencyMs)
                             / (metrics.latencySamples + 1)
        metrics.latencySamples++
      }
      _set(LS.METRICS, metrics)
    },
    logTool (name, ok) {
      metrics.toolsExec++
      if (!ok) metrics.errors++
      metrics.byTool[name] = (metrics.byTool[name] || 0) + 1
      _set(LS.METRICS, metrics)
    },
    reset () {
      Object.assign(metrics, { turns: 0, toolsExec: 0, errors: 0, tokensIn: 0, tokensOut: 0, avgLatencyMs: 0, latencySamples: 0, byTool: {} })
      _set(LS.METRICS, metrics)
    }
  }

  // ── Interpretação humana de erros em pt-BR ─────────────────
  const errorMap = [
    [/ENOENT|no such file|não encontrada|not found/i,   'O caminho/arquivo especificado não existe.'],
    [/EACCES|permission denied|permissão/i,             'Sem permissão para essa operação.'],
    [/EBUSY|resource busy|em uso/i,                     'O recurso está em uso por outro processo.'],
    [/EEXIST|already exists|já existe/i,                'Já existe um item com esse nome.'],
    [/EADDRINUSE|address in use/i,                      'A porta/endereço já está em uso.'],
    [/ETIMEDOUT|timeout|tempo esgotado/i,               'Tempo esgotado esperando resposta.'],
    [/ECONNREFUSED|conexão recusada/i,                  'Conexão recusada — o serviço não está respondendo.'],
    [/quota|rate limit|too many requests/i,             'Limite de uso atingido. Tente de novo em alguns segundos.'],
    [/insufficient|saldo|sem créditos/i,                'Saldo/créditos insuficientes para a operação.'],
    [/parse|JSON|invalid|malformed/i,                   'A resposta recebida está em formato inválido.'],
    [/network|fetch failed|failed to fetch/i,           'Falha de rede. Verifique a conexão.'],
    [/permission insufficient/i,                        'Nível de permissão do ARIS-9 insuficiente. Use `.system permission <nível>`.']
  ]
  window.aris9ExplainError = function (msg) {
    if (!msg) return 'Erro desconhecido.'
    const s = String(msg)
    for (const [re, pt] of errorMap) if (re.test(s)) return `${pt} (${s.slice(0, 120)})`
    return s
  }

  // ── Ferramenta escrita/execução? (para modo somente-leitura) ─
  const WRITE_CATEGORIES = new Set(['filesystem', 'system', 'automation', 'spotify', 'browser'])
  const READ_ONLY_ALLOW  = /\.(list|get|read|search|info|status|processes|history|clipboard\.get|scrape|fetch)$/i
  window.aris9IsWriteTool = function (toolName) {
    const tool = window.toolManager?.get?.(toolName)
    if (!tool) return false
    if (READ_ONLY_ALLOW.test(toolName)) return false
    return WRITE_CATEGORIES.has(tool.category)
  }

  // ── Modo silencioso automático (silencia quando aba visível) ─
  window.aris9ShouldNotify = function () {
    if (!prefs.silentAuto) return true
    // Se a página está VISÍVEL e o terminal está aberto, evita ruído
    return document.visibilityState !== 'visible'
  }

  // ── Detector de fluxo repetido ─────────────────────────────
  // Analisa aris9_task_history e detecta sequências de tools iguais
  // executadas 3+ vezes seguidas — sugere macro.
  window.aris9DetectRepeat = function () {
    let history
    try { history = JSON.parse(localStorage.getItem('aris9_task_history') || '[]') }
    catch { return null }
    if (history.length < 3) return null
    const last3 = history.slice(0, 3).map(h => JSON.stringify(h.tools || []))
    if (last3[0] && last3.every(x => x === last3[0])) {
      return { tools: history[0].tools, count: 3, summary: history[0].summary }
    }
    return null
  }

  // ── Resumo diário ──────────────────────────────────────────
  window.aris9DailySummary = function () {
    const today = new Date().toISOString().slice(0, 10)
    const store = _get(LS.DAILY, {})
    const day = store[today] || { turns: 0, tools: {}, macrosRun: 0, startedAt: today }
    return { today, ...day }
  }
  window.aris9BumpDaily = function (type, name) {
    const today = new Date().toISOString().slice(0, 10)
    const store = _get(LS.DAILY, {})
    const day = store[today] || { turns: 0, tools: {}, macrosRun: 0 }
    if (type === 'turn') day.turns++
    else if (type === 'tool') day.tools[name] = (day.tools[name] || 0) + 1
    else if (type === 'macro') day.macrosRun++
    store[today] = day
    // mantém 30 dias
    const keys = Object.keys(store).sort().slice(-30)
    const trimmed = {}
    keys.forEach(k => { trimmed[k] = store[k] })
    _set(LS.DAILY, trimmed)
  }

  // ── Agenda de gatilhos ─────────────────────────────────────
  // Formato: [{ id, when: 'HH:MM' | intervalMs, macroName, lastRunAt }]
  const schedules = _get(LS.SCHEDULES, [])
  window.aris9Schedules = {
    all () { return [...schedules] },
    add (item) {
      const id = item.id || ('sch_' + Date.now())
      const entry = { id, ...item, createdAt: new Date().toISOString() }
      schedules.push(entry)
      _set(LS.SCHEDULES, schedules)
      return entry
    },
    remove (id) {
      const i = schedules.findIndex(s => s.id === id)
      if (i === -1) return false
      schedules.splice(i, 1)
      _set(LS.SCHEDULES, schedules)
      return true
    },
    _saveState () { _set(LS.SCHEDULES, schedules) }
  }

  // Tick de agenda: roda a cada 30s
  setInterval(async () => {
    const now = new Date()
    const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
    for (const s of schedules) {
      try {
        let shouldRun = false
        if (s.when && /^\d{2}:\d{2}$/.test(s.when)) {
          // dispara uma vez por dia neste horário
          const today = now.toISOString().slice(0, 10)
          if (s.when === hhmm && s.lastRunDay !== today) {
            shouldRun = true
            s.lastRunDay = today
          }
        } else if (typeof s.intervalMs === 'number' && s.intervalMs >= 30000) {
          if (!s.lastRunAt || (now - new Date(s.lastRunAt)) >= s.intervalMs) {
            shouldRun = true
            s.lastRunAt = now.toISOString()
          }
        }
        if (shouldRun && s.macroName && window.toolManager?.execute) {
          await window.toolManager.execute('macro.run', { name: s.macroName }, { source: 'schedule' })
          window.showNotification?.('ARIS-9', `Agendamento executou: ${s.macroName}`, 'info')
        }
      } catch (err) { console.debug('[aris9 schedule]', err) }
    }
    window.aris9Schedules._saveState()
  }, 30000)

  // ── Marketplace de tools: instalar por URL ─────────────────
  const installed = _get(LS.INSTALLED, [])
  window.aris9ToolInstall = async function (url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida.')
    const res = await fetch(url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const src = await res.text()
    // Segurança básica: exige que o script use window.toolManager.register
    if (!src.includes('toolManager.register')) throw new Error('Script não parece registrar tool.')
    // Executa em escopo global
    const s = document.createElement('script')
    s.textContent = src
    document.body.appendChild(s)
    installed.push({ url, at: new Date().toISOString() })
    _set(LS.INSTALLED, installed)
    return { installed: true }
  }
  window.aris9ToolInstalledList = () => [...installed]

  // ── ReAct trace: captura raw do agente ─────────────────────
  const traceBuffer = []
  const TRACE_MAX = 8
  window.aris9Trace = {
    push (entry) {
      traceBuffer.unshift({ at: Date.now(), ...entry })
      if (traceBuffer.length > TRACE_MAX) traceBuffer.length = TRACE_MAX
    },
    last () { return traceBuffer[0] || null },
    all () { return [...traceBuffer] }
  }
})()
