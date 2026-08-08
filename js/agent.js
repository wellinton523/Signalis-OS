// agent.js (SIGNALIS-OS v4 - ReAct Textual)
// Este modelo não suporta tool_calls nativo — usamos ReAct textual:
// O modelo escreve ACTION/ARGS, o código executa a tool real e devolve OBSERVATION.
const OLLAMA_URL     = '/api/ollama/chat'
const DUCKDUCKGO_URL = '/api/search/duckduckgo'

const LLM_MODEL   = window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b'
const MAX_STEPS   = 8    // limite padrão por turno
const MAX_STEPS_UNLIMITED = 64  // limite quando UNLIMITED_STEPS ativo
const MAX_HISTORY = 20

let _history = []

function _emitAgentStage(stage, detail) {
  if (typeof window.__onAgentStage === 'function') {
    window.__onAgentStage({ stage, detail })
  }
}

// ── Catálogo compacto de tools para o system prompt ─────────
// Agrupa por categoria. Tools da categoria "spotify" recebem
// assinatura explícita para o modelo não inventar parâmetros.
function _buildToolCatalog() {
  const tools  = window.toolManager?.list() ?? []
  const groups = {}
  for (const t of tools) {
    const cat = t.category || 'geral'
    ;(groups[cat] = groups[cat] || []).push(t)
  }
  return Object.entries(groups)
    .map(([cat, list]) => {
      // Para categorias com parâmetros não-óbvios, mostra assinatura resumida
      if (cat === 'spotify') {
        const sigs = list.map(t => {
          const props = Object.keys(t.parameters?.properties ?? {})
          const req   = t.parameters?.required ?? []
          const sig   = props.map(p => req.includes(p) ? p : `[${p}]`).join(', ')
          return `    ${t.name}(${sig})`
        }).join('\n')
        return `  [spotify]\n${sigs}`
      }
      return `  [${cat}] ${list.map(t => t.name).join(', ')}`
    })
    .join('\n')
}

// ── System Prompt ReAct ──────────────────────────────────────
function _buildSystemPrompt() {
  const catalog = _buildToolCatalog()
  return `Você é ARIS-9, assistente operacional do SIGNALIS-OS. Responda SEMPRE em português.

Para executar uma ação no sistema, use este formato exato (duas linhas, sem texto antes):
ACTION: nome_da_ferramenta
ARGS: {"param": "valor"}

Após receber OBSERVATION com o resultado, escreva a resposta final normalmente sem ACTION.

Ferramentas disponíveis por categoria:
${catalog}
- abrir_busca_web

Spotify — exemplos de uso correto:
  Tocar música: ACTION: spotify.find_and_play / ARGS: {"query": "nome da música artista"}
  Buscar:       ACTION: spotify.search        / ARGS: {"query": "termo", "limit": 5}
  Abrir faixa:  ACTION: spotify.play          / ARGS: {"uri": "spotify:track:ID"}
  Abrir playlist: ACTION: spotify.playlist    / ARGS: {"uri": "spotify:playlist:ID"}

IMPORTANTE: Para música/Spotify use SEMPRE as tools spotify.* — nunca tente abrir arquivos ou caminhos locais do Spotify. Se não precisar de ferramenta, responda diretamente. Nunca invente resultados.`
}

let _systemPrompt = ''

// ── Entrada Principal ────────────────────────────────────────
async function agentSend(userText) {
  await window.toolsReady

  // Reconstrói o system prompt se ainda não foi definido ou se o histórico foi resetado
  if (!_systemPrompt || _history.length <= 1) {
    _systemPrompt = _buildSystemPrompt()
    _history      = [{ role: 'system', content: _systemPrompt }]
  } else {
    // Atualiza silenciosamente a mensagem system no topo (caso as tools tenham mudado)
    _history[0] = { role: 'system', content: _buildSystemPrompt() }
  }

  _history.push({ role: 'user', content: userText })
  _pruneHistory()

  if (window.MOCK_MODE) {
    const mock = { acao: 'resposta', texto: 'Comando processado no modo mock.' }
    _history.push({ role: 'assistant', content: mock.texto })
    return mock
  }

  try {
    const result = await _reactLoop()
    // Extração de memória em background — não bloqueia nem afeta a resposta
    _extractAndSaveMemory(userText, result.texto).catch(() => {})
    return result
  } catch (err) {
    console.warn('[ARIS-9] Erro:', err.message)
    _emitAgentStage('responder', `fallback — ${err.message}`)
    return { acao: 'resposta', texto: `Falha interna: ${err.message}` }
  }
}

// ── Extração automática de memória ───────────────────────────
// Roda em background após cada turno bem-sucedido.
// Usa um prompt separado para não contaminar o histórico principal.
async function _extractAndSaveMemory(userText, assistantText) {
  if (!assistantText || !userText) return
  if (!window.permissionManager?.can(window.Permission?.STANDARD ?? 1)) return

  // Só processa conversas com alguma substância (evita trivialidades)
  const combined = userText + ' ' + assistantText
  if (combined.length < 60) return

  const extractPrompt = [
    {
      role: 'system',
      content: `Você é um extrator de memória. Analise a conversa abaixo e decida se há informações relevantes para guardar permanentemente (preferências do usuário, nomes, caminhos de pastas, projetos, configurações, fatos importantes mencionados).

Se houver algo relevante, responda APENAS com um JSON no formato:
[{"key": "chave_curta", "value": "valor", "tags": ["tag1"]}]

Se não houver nada relevante, responda: NADA

Seja seletivo — só guarde informações que serão úteis em conversas futuras. Não guarde perguntas simples, cumprimentos ou respostas genéricas.`
    },
    {
      role: 'user',
      content: `Usuário disse: ${userText}\n\nARIS respondeu: ${assistantText}`
    }
  ]

  const raw = await _callModel(extractPrompt)
  if (!raw || raw.trim().toUpperCase() === 'NADA' || !raw.includes('[')) return

  // Tenta extrair o JSON da resposta
  const jsonMatch = raw.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return

  let items
  try { items = JSON.parse(jsonMatch[0]) } catch { return }
  if (!Array.isArray(items) || items.length === 0) return

  // Salva cada item via ToolManager (respeita permissões)
  for (const item of items) {
    const key   = String(item.key   || '').trim().replace(/\s+/g, '_').slice(0, 60)
    const value = item.value
    const tags  = Array.isArray(item.tags) ? item.tags : []

    if (!key || value === undefined || value === null) continue

    try {
      await window.toolManager.execute('memory.set', { key, value, tags: ['auto', ...tags] }, { source: 'agent-bg' })
      console.debug(`[ARIS-9 mem] guardado: ${key} =`, value)
    } catch { /* ignora erros de permissão ou storage */ }
  }
}

// ── ReAct Loop textual ───────────────────────────────────────
async function _reactLoop() {
  const executedTools = []
  const stepLimit = window.UNLIMITED_STEPS ? MAX_STEPS_UNLIMITED : MAX_STEPS

  for (let step = 0; step < stepLimit; step++) {
    _emitAgentStage('planner', step === 0 ? 'processando intenção' : `etapa ${step + 1} — continuando`)

    const raw = await _callModel(_history)
    console.debug(`[ARIS-9 raw step=${step}]`, raw.slice(0, 400))

    // Tenta extrair ACTION + ARGS do texto do modelo
    const action = _parseAction(raw)

    if (!action) {
      // Nenhuma action — resposta final
      let finalText = _cleanFinalResponse(raw)

      // Se veio vazio, tenta novamente pedindo ao modelo para responder
      if (!finalText.trim()) {
        _emitAgentStage('responder', 'resposta vazia — solicitando novamente')
        _history.push({ role: 'user', content: 'Por favor, responda a solicitação do usuário em português.' })
        const retry = await _callModel(_history)
        finalText = _cleanFinalResponse(retry).trim()
        _history.pop() // remove a mensagem de retry do histórico público
      }

      // Último fallback
      if (!finalText.trim()) finalText = '*Processamento concluído.*'

      _history.push({ role: 'assistant', content: finalText })
      if (executedTools.length > 0) _saveTaskToHistory(executedTools, finalText)
      return { acao: 'resposta', texto: finalText, steps: executedTools }
    }

    // ── Executa a tool ───────────────────────────────────────
    const { toolName, args } = action
    _emitAgentStage('executor', `tool [${step + 1}/${MAX_STEPS}]: ${toolName}`)

    // Adiciona a resposta do modelo (com o ACTION) no histórico como assistant
    _history.push({ role: 'assistant', content: raw })

    let observation
    try {
      if (toolName === 'abrir_busca_web') {
        const results = await _doWebSearchRaw(args.query || args.q || '')
        observation = results.length
          ? results.map(r => `- ${r.title}: ${r.url}`).join('\n')
          : 'Nenhum resultado encontrado.'
        executedTools.push({ tool: toolName, args, result: results.length })
      } else {
        const internalName = _resolveTool(toolName)
        if (!internalName) {
          observation = `Erro: ferramenta "${toolName}" não encontrada. Ferramentas disponíveis: ${(window.toolManager?.list() ?? []).map(t => t.name).join(', ')}`
        } else {
          const result = await window.toolManager.execute(internalName, args, { source: 'agent' })
          observation = _formatObservation(result)
          executedTools.push({ tool: internalName, args, result })
        }
      }
    } catch (err) {
      observation = `Erro ao executar ${toolName}: ${err.message}`
      executedTools.push({ tool: toolName, args, error: err.message })
      _emitAgentStage('executor', `erro em ${toolName}: ${err.message}`)
    }

    // Injeta o resultado como user (OBSERVATION) para o próximo turno
    _history.push({ role: 'user', content: `OBSERVATION: ${observation}` })
    _pruneHistory()
  }

  // Limite de etapas — pede resumo
  _emitAgentStage('responder', 'limite de etapas atingido — sintetizando')
  _history.push({ role: 'user', content: 'Resuma brevemente o que foi realizado.' })
  const finalRaw  = await _callModel(_history)
  const finalText = _cleanFinalResponse(finalRaw) || 'Operação concluída.'
  _history.push({ role: 'assistant', content: finalText })
  if (executedTools.length > 0) _saveTaskToHistory(executedTools, finalText)
  return { acao: 'resposta', texto: finalText, steps: executedTools }
}

// ── Parser do bloco ACTION/ARGS ──────────────────────────────
// Detecta qualquer variação que o modelo possa gerar:
//   ACTION: nome\nARGS: {...}
//   ACTION: nome\nARGS: {...}  (com espaços extras)
function _parseAction(text) {
  if (!text || typeof text !== 'string') return null

  // Regex principal: ACTION: <nome>\nARGS: <json>
  const match = text.match(/ACTION:\s*([a-zA-Z0-9_.]+)\s*\nARGS:\s*(\{[\s\S]*?\})(?:\n|$)/i)
  if (match) {
    const toolName = match[1].trim()
    try {
      const args = JSON.parse(match[2])
      return { toolName, args }
    } catch {
      // JSON malformado — tenta extrair mesmo assim
      return { toolName, args: _tryParseLooseJson(match[2]) }
    }
  }

  // Fallback: ACTION sem ARGS (ferramenta sem parâmetros)
  const noArgs = text.match(/ACTION:\s*([a-zA-Z0-9_.]+)\s*(?:\nARGS:\s*\{\s*\})?(?:\n|$)/i)
  if (noArgs) {
    return { toolName: noArgs[1].trim(), args: {} }
  }

  return null
}

// Tenta parsear JSON com aspas simples ou sem aspas
function _tryParseLooseJson(str) {
  try {
    // Tenta normalizar aspas simples → duplas
    const normalized = str
      .replace(/'/g, '"')
      .replace(/(\w+):/g, '"$1":')
    return JSON.parse(normalized)
  } catch {
    return {}
  }
}

// ── Formata o resultado da tool para o modelo ────────────────
function _formatObservation(result) {
  if (result === null || result === undefined) return 'Concluído sem resultado.'
  if (typeof result === 'string') return result
  if (Array.isArray(result)) {
    if (result.length === 0) return 'Lista vazia.'
    // Limita a 30 itens para não sobrecarregar o contexto
    const slice = result.slice(0, 30)
    return JSON.stringify(slice, null, 2) + (result.length > 30 ? `\n... e mais ${result.length - 30} itens.` : '')
  }
  return JSON.stringify(result, null, 2)
}

// ── Limpa a resposta final (remove blocos ACTION/ARGS residuais) ──
function _cleanFinalResponse(text) {
  if (!text) return ''
  return text
    // Remove blocos ACTION+ARGS completos
    .replace(/^ACTION:\s*\S.*\n?^ARGS:\s*\{[^}]*\}\s*$/gim, '')
    // Remove linha ACTION isolada (sem ARGS) apenas se for a linha inteira
    .replace(/^ACTION:\s*[a-zA-Z0-9_.]+\s*$/gm, '')
    // Remove linha ARGS isolada
    .replace(/^ARGS:\s*\{.*\}\s*$/gm, '')
    .trim()
}

// ── Chamada simples ao modelo (sem tool_calls) ───────────────
async function _callModel(messages) {
  const body = {
    model:    LLM_MODEL,
    messages: messages,
    stream:   false
    // Sem "tools" — o modelo recebe as instruções via system prompt
  }

  const res = await fetch(OLLAMA_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Status ${res.status}: ${errText.slice(0, 150)}`)
  }

  const data = await res.json()
  return data.message?.content ?? ''
}

// ── Busca web (retorna array de resultados) ──────────────────
async function _doWebSearchRaw(query) {
  if (!query) return []
  try {
    const res = await fetch(`${DUCKDUCKGO_URL}?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    })
    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
    const html = await res.text()
    return _extractSearchResults(html)
  } catch (err) {
    console.warn('[ARIS-9] busca falhou:', err.message)
    return []
  }
}

// Mantido para compatibilidade com _handleAgentAction no terminal
async function _doWebSearch(query) {
  const results = await _doWebSearchRaw(query)
  if (!results.length) {
    return { acao: 'resposta', texto: `Nenhum resultado encontrado para "${query}".` }
  }
  const searchContext = results.slice(0, 3).map(r => `- ${r.title}: ${r.url}`).join('\n')
  _history.push({ role: 'user', content: `OBSERVATION: Resultados para "${query}":\n${searchContext}` })
  _emitAgentStage('responder', 'sintetizando resposta')
  const finalText = await _callModel(_history)
  _history.push({ role: 'assistant', content: finalText })
  return { acao: 'abrir_busca_web', parametro: query, texto: finalText, resultados: results }
}

function _extractSearchResults(html) {
  const results = []
  const regex   = /<a rel="nofollow" class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const title = match[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').trim()
    const url   = match[1].replace(/^\//, 'https://')
    if (title && url) results.push({ title, url })
  }
  return results.slice(0, 5)
}

// ── Resolve nome de tool (underscore ou ponto) ───────────────
function _resolveTool(funcName) {
  return window.toolManager?.resolveFuncName?.(funcName) ?? null
}

// ── Histórico de tarefas ─────────────────────────────────────
function _saveTaskToHistory(tools, summary) {
  try {
    const HIST_KEY = 'aris9_task_history'
    const history  = JSON.parse(localStorage.getItem(HIST_KEY) || '[]')
    history.unshift({
      at:      new Date().toISOString(),
      tools:   tools.map(t => t.tool),
      summary: String(summary).slice(0, 200)
    })
    localStorage.setItem(HIST_KEY, JSON.stringify(history.slice(0, 50)))
  } catch { /* ignora */ }
}

function agentReset() {
  _systemPrompt = _buildSystemPrompt()
  _history      = [{ role: 'system', content: _systemPrompt }]
}

function agentTaskHistory() {
  try { return JSON.parse(localStorage.getItem('aris9_task_history') || '[]') }
  catch { return [] }
}

function _pruneHistory() {
  if (_history.length <= MAX_HISTORY) return
  const sys  = _history[0]
  let tail   = _history.slice(-(MAX_HISTORY - 1))
  // Não deixa o histórico começar com OBSERVATION (role:user) órfão
  while (tail.length > 0 && tail[0].role === 'user' && String(tail[0].content).startsWith('OBSERVATION:')) {
    tail = tail.slice(1)
  }
  _history = [sys, ...tail]
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
