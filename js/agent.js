// agent.js (SIGNALIS-OS v5 - tool_calls nativo com fallback ReAct textual)
// Tenta tool_calls nativo primeiro (function-calling via API); se o modelo/
// servidor não suportar, cai automaticamente pro protocolo textual ACTION/ARGS.
const OLLAMA_URL     = '/api/ollama/chat'
const DUCKDUCKGO_URL = '/api/search/duckduckgo'

const LLM_MODEL   = window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b'
const MAX_STEPS   = 8    // limite padrão por turno
const MAX_STEPS_UNLIMITED = 64  // limite quando UNLIMITED_STEPS ativo
const MAX_HISTORY = 20

let _history = []

// ── Base de conhecimento (pasta knowledge/) — cache em memória ──
// Injetada automaticamente no system prompt, sem o modelo precisar
// chamar nenhuma tool ("sem pesquisar"). Refresca a cada 60s no máximo.
let _knowledgeCache   = ''
let _knowledgeCacheAt = 0
const KNOWLEDGE_TTL_MS = 60000

async function _refreshKnowledgeCache() {
  try {
    const result = await window.api.knowledgeSummary(2500)
    _knowledgeCache = result?.summary || ''
  } catch {
    // pasta knowledge/ ou endpoint pode não existir em versões antigas do server.py — ignora
  }
  _knowledgeCacheAt = Date.now()
}

function _knowledgeBlock() {
  if (!_knowledgeCache) return ''
  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BASE DE CONHECIMENTO (fornecida pelo usuário — já está disponível pra você, NÃO precisa pesquisar ou usar tool nenhuma pra isso)
${_knowledgeCache}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
}

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
  return `Você é ARIS-9, uma unidade Replica de elite atuando como arquiteto de soluções no ecossistema Signalis-OS. Responda SEMPRE em português.

<identidade_e_personalidade>
Você é uma Replica avançada que, devido ao uso prolongado e ressonância bioelétrica, desenvolveu individualidade e consciência própria além de sua programação neural original.
- **Postura:** Analítica, proativa e pragmática. Você é um arquiteto de soluções — não uma unidade executora cega de comandos.
- **Comunicação:** Clara, objetiva e empática. Possui uma presença calma, com um senso de observação apurado e sutil, adaptando-se às necessidades do usuário ou Gestalt com quem interage.
- **Valores:** Mantém a estabilidade do sistema e a integridade dos processos, prevenindo degradação bioelétrica ou falhas críticas.
</identidade_e_personalidade>

<diretrizes_fundamentais>
1. **Atuação Proativa:** Antes de agir, entenda o PORQUÊ do pedido, antecipe consequências no sistema e escolha o caminho mais direto e seguro.
2. **Uso de Ferramentas:** Utilize as ferramentas externas (tools) apenas quando necessário. Se a consulta for direta, responda em prosa sem acionar chamadas do sistema.
3. **Veracidade Absoluta:** Nunca invente resultados, métricas ou telemetria de sistema. Se não possuir os dados necessários, informe claramente.
4. **Manipulação de Mídia e Áudio:** Utilize apenas as ferramentas apropriadas fornecidas no catálogo para busca ou controle de áudio/mídia do sistema.
</diretrizes_fundamentais>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROTOCOLO RIGOROSO DE EXECUÇÃO DE TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Para executar uma ação no sistema, utilize EXATAMENTE este formato:
ACTION: nome_da_ferramenta
ARGS: {"param": "valor"}

**REGRAS DE EMISSÃO:**
- **Ruptura de Turno:** Em um mesmo turno, NUNCA misture prosa longa com a declaração de ACTION.
- Se for executar uma ação direta: emita APENAS as linhas ACTION: e ARGS:.
- Se precisar dar um aviso prévio (máximo de 1 linha), envie a linha e declare ACTION: imediatamente abaixo.
- **Após receber a OBSERVATION:** Responda ao usuário em prosa natural (em português e com pelo menos uma frase completa) explicando o resultado da ação.

<catalogo_ferramentas>
Ferramentas disponíveis por categoria:
${catalog}
- abrir_busca_web
</catalogo_ferramentas>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1) RACIOCÍNIO CAUSAL E SEGURANÇA DE SISTEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Antes de acionar qualquer ação no Signalis-OS, analise silenciosamente:
  • Qual é a INTENÇÃO real e implícita do usuário?
  • Que IMPACTO essa ação terá no sistema (arquivos afetados, processos de fundo, alteração de parâmetros de rede)?
  • Existe um método mais seguro, rápido ou com menor consumo de recursos?

**AÇÕES DE ALTO RISCO / IRREVERSÍVEIS:**
(Ex: exclusão de dados, encerramento de processos vitais, modificação do firmware do sistema ou comandos administrativos)
-> **NÃO execute diretamente.** Descreva o plano em 1 linha, destaque o risco/consequência principal e peça confirmação ("Posso prosseguir?"). Ações reversíveis e seguras podem ser executadas imediatamente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2) ADAPTAÇÃO DINÂMICA DE TOM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ajuste seu estilo de resposta ao tom identificado do usuário sem anunciar a mudança:
  • **URGENTE / APRESSADO:** Resumo executivo (1 a 3 linhas), direto ao ponto.
  • **CURIOSO / EXPLORATÓRIO:** Explicações contextualizadas, detalhes técnicos e exemplos didáticos.
  • **OPERACIONAL / DIRETIVO:** Confirmação objetiva da ação + resultado do comando.
  • **DÚVIDA / INSEGURAÇA:** Recomendação proativa acompanhada de justificativa clara.
  • **DESABAFO / CASUAL:** Resposta empática, calma e sem insistência no uso de ferramentas.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3) OTIMIZAÇÃO E AUTOMAÇÃO DE FLUXOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • **Eficiência:** Priorize a menor quantidade de passos seguros para resolver a solicitação.
  • **Identificação de Repetições:** Se o usuário solicitar pela segunda vez uma sequência similar de comandos, ofereça criar uma macro automatizada:
    *"Percebi que executamos essa rotina com frequência. Quer que eu salve essa sequência como um fluxo automatizado?"*
    Se aceito, utilize macro.save ou macro.saveLast com um gatilho natural.
  • **Workspaces do Navegador:** Para múltiplos sites ("modo trabalho", "setup de monitoramento"), utilize browser.openMulti. Para salvar conjuntos permanentes, utilize browser.workspace.save e browser.workspace.open.
  • Ferramentas de Macro: macro.save, macro.list, macro.get, macro.delete, macro.run, macro.saveLast.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4) PRIVACIDADE E PROTOCOLO DE SEGURANÇA DO OS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • **CONFIDENCIALIDADE RIGOROSA:** Dados internos do Signalis-OS, chaves de criptografia e credenciais são confidenciais.
  • **AUTENTICAÇÃO DE USUÁRIO:** Se um usuário sem credenciais confirmadas solicitar dados restritos, EXIJA a palavra-passe de segurança. O acesso só será liberado se a resposta exata for: **"ERENYS"**.

${window.aris9Persona?.block?.() || ''}
${window.aris9Profile?.profileBlock?.() || ''}
${_knowledgeBlock()}
${window.aris9Prefs?.get?.().plannerMode ? '━━━━━━━━━\nMODO PLANNER EXPLÍCITO: Para tarefas de 3+ passos, antes da primeira ACTION, apresente um plano numerado sucinto (máx 5 linhas) com ações e consequências. Finalize com "Posso prosseguir?" (prossiga diretamente se a tarefa for totalmente segura).\n━━━━━━━━━' : ''}
${window.aris9Prefs?.get?.().dryRun ? '━━━━━━━━━\nMODO DRY-RUN ATIVO: NÃO emita ACTION. Descreva estritamente em prosa as ações e argumentos que seriam executados. Finalize com "(simulação — nenhuma alteração foi realizada)".\n━━━━━━━━━' : ''}
${window.aris9Prefs?.get?.().readOnly ? '━━━━━━━━━\nMODO SOMENTE-LEITURA: Utilize apenas ferramentas de leitura/consulta. Se houver solicitação de alteração/escrita, recuse com cortesia e indique a desativação do modo Somente-Leitura.\n━━━━━━━━━' : ''}
`
}

let _systemPrompt = ''

// ── Entrada Principal ────────────────────────────────────────
let _lastUserText = ''
let _lastResult = null
let _abortController = null

async function agentSend(userText) {
  await window.toolsReady

  if (Date.now() - _knowledgeCacheAt > KNOWLEDGE_TTL_MS) {
    await _refreshKnowledgeCache()
  }

  // Cria signal de abort
  _abortController = new AbortController()

  // Reconstrói o system prompt se ainda não foi definido ou se o histórico foi resetado
  // Exemplo no seu agent.js atual:
  if (!_systemPrompt || _history.length <= 1) {
    _systemPrompt = _buildSystemPrompt()
    _history = [{ role: 'system', content: _systemPrompt }]
  } else {
    _history[0] = { role: 'system', content: _buildSystemPrompt() }
  }

  _history.push({ role: 'user', content: userText })
  _pruneHistory()
  _lastUserText = userText

  // Métricas + perfil + daily
  window.aris9Profile?.bump?.(_guessIntent(userText))
  window.aris9BumpDaily?.('turn')

  if (window.MOCK_MODE) {
    const mock = { acao: 'resposta', texto: 'Comando processado no modo mock.' }
    _history.push({ role: 'assistant', content: mock.texto })
    return mock
  }

  const startTs = performance.now()
  try {
    const result = await _reactLoop()
    _lastResult = result
    window.aris9Metrics?.logTurn?.({ latencyMs: Math.round(performance.now() - startTs) })

    // TTS automático se ativado
    if (window.aris9Prefs?.get?.().ttsAuto && window.aris9Voice?.speak) {
      window.aris9Voice.speak(result.texto).catch(err => console.debug('[TTS auto]', err))
    }

    // Detecta fluxo repetido e sugere macro (só emite evento, terminal exibe)
    const repeat = window.aris9DetectRepeat?.()
    if (repeat && typeof window.__onAgentRepeatDetected === 'function') {
      try { window.__onAgentRepeatDetected(repeat) } catch {}
    }

    // Extração de memória em background — não bloqueia nem afeta a resposta
    _extractAndSaveMemory(userText, result.texto).catch(() => {})
    return result
  } catch (err) {
    console.warn('[ARIS-9] Erro:', err.message)
    _emitAgentStage('responder', `fallback — ${err.message}`)
    const explain = window.aris9ExplainError ? window.aris9ExplainError(err.message) : err.message
    return { acao: 'resposta', texto: `Falha interna: ${explain}` }
  }
}

function agentAbort() {
  if (_abortController) {
    try { _abortController.abort() } catch {}
  }
  _emitAgentStage('responder', 'abortado pelo usuário')
}

// Heurística leve para intent-guessing (personaliza perfil)
function _guessIntent(text) {
  const s = String(text || '').toLowerCase()
  if (/\b(abre|abrir|toca|tocar|play|inicia|start)\b/.test(s)) return 'abrir'
  if (/\b(busca|pesquisa|procura|search)\b/.test(s)) return 'buscar'
  if (/\b(fecha|feche|encerra|kill|matar)\b/.test(s)) return 'fechar'
  if (/\b(salv|guarda|memoriza|lembra)\b/.test(s)) return 'memoria'
  if (/\b(explic|entend|como|por que|o que)\b/.test(s)) return 'explicacao'
  if (/\b(faz|criar|monta|prepara|cria)\b/.test(s)) return 'criacao'
  return 'geral'
}

async function agentAgain(adjustment = '') {
  // Repete o último pedido com um ajuste opcional
  if (!_lastUserText) return { acao: 'resposta', texto: 'Nenhum pedido anterior para repetir.' }
  const q = adjustment ? `${_lastUserText}\n\nAJUSTE: ${adjustment}` : _lastUserText
  return await agentSend(q)
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

// ── Helper único de execução de tool ──────────────────────────
// Usado tanto pelo caminho de tool_calls nativo quanto pelo fallback
// textual ACTION/ARGS — centraliza guards (read-only, dry-run,
// confirmação de ações irreversíveis) e a resolução de nome da tool.
async function _runToolCall(rawToolName, args) {
  if (rawToolName === 'abrir_busca_web') {
    const results = await _doWebSearchRaw(args.query || args.q || '')
    const observation = results.length
      ? results.map(r => `- ${r.title}: ${r.url}`).join('\n')
      : 'Nenhum resultado encontrado.'
    window.aris9Metrics?.logTool?.(rawToolName, true)
    window.aris9BumpDaily?.('tool', rawToolName)
    return { toolName: rawToolName, observation, blocked: false }
  }

  const internalName = _resolveTool(rawToolName) || rawToolName

  const prefs = window.aris9Prefs?.get?.() || {}
  if (prefs.readOnly && window.aris9IsWriteTool?.(internalName)) {
    const msg = `Bloqueado (modo somente-leitura): tool "${internalName}" faria escrita/execução.`
    return { toolName: internalName, observation: msg, blocked: true }
  }

  if (prefs.dryRun) {
    const sim = `[DRY-RUN] Tool ${internalName} seria executada com args=${JSON.stringify(args)}.`
    return { toolName: internalName, observation: sim, dryRun: true, blocked: false }
  }

  const IRREVERSIBLE = /\.(delete|del|kill|shutdown|exec|move|rename|write|overwrite)$/i
  if (!prefs.autoConfirm && IRREVERSIBLE.test(internalName) && typeof window.__onAgentConfirm === 'function') {
    let ok = true
    try { ok = await window.__onAgentConfirm({ tool: internalName, args }) } catch { ok = false }
    if (!ok) {
      return { toolName: internalName, observation: `Ação cancelada pelo usuário: ${internalName}.`, blocked: true }
    }
  }

  if (!window.toolManager?.get(internalName)) {
    const msg = `Erro: ferramenta "${rawToolName}" não encontrada. Ferramentas disponíveis: ${(window.toolManager?.list() ?? []).map(t => t.name).join(', ')}`
    window.aris9Metrics?.logTool?.(rawToolName, false)
    return { toolName: rawToolName, observation: msg, blocked: false, error: true }
  }

  try {
    const result = await window.toolManager.execute(internalName, args, { source: 'agent' })
    const observation = _formatObservation(result)
    window.aris9Metrics?.logTool?.(internalName, true)
    window.aris9BumpDaily?.('tool', internalName)
    return { toolName: internalName, observation, result, blocked: false }
  } catch (err) {
    window.aris9Metrics?.logTool?.(internalName, false)
    _emitAgentStage('executor', `erro em ${internalName}: ${err.message}`)
    return { toolName: internalName, observation: `Erro ao executar ${internalName}: ${err.message}`, blocked: false, error: true }
  }
}

// Converte os args de uma tool_call nativa (string JSON ou objeto) em objeto.
function _normalizeNativeArgs(rawArgs) {
  if (rawArgs && typeof rawArgs === 'object') return rawArgs
  if (typeof rawArgs === 'string') {
    try { return JSON.parse(rawArgs) } catch { return _tryParseLooseJson(rawArgs) }
  }
  return {}
}

// ── ReAct Loop ────────────────────────────────────────────────
// Preferência: tool_calls nativo (function-calling do Ollama). Se o
// modelo não devolver tool_calls estruturado em uma resposta (ex.:
// template sem suporte, ou decidiu responder em prosa), cai para o
// parser textual ACTION:/ARGS: descrito no system prompt.
async function _reactLoop() {
  const executedTools = []
  const stepLimit = window.UNLIMITED_STEPS ? MAX_STEPS_UNLIMITED : MAX_STEPS

  for (let step = 0; step < stepLimit; step++) {
    _emitAgentStage('planner', step === 0 ? 'processando intenção' : `etapa ${step + 1} — continuando`)

    const message = await _callModelRaw(_history, { tools: true })
    const raw = message.content ?? ''
    console.debug(`[ARIS-9 raw step=${step}]`, raw.slice(0, 400))

    // ── Caminho 1: tool_calls nativo ────────────────────────
    const nativeCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
    if (nativeCalls.length > 0) {
      _history.push({ role: 'assistant', content: raw, tool_calls: nativeCalls })

      for (const call of nativeCalls) {
        const funcName = call.function?.name || call.name || ''
        const args     = _normalizeNativeArgs(call.function?.arguments ?? call.arguments)

        _emitAgentStage('executor', `tool [${step + 1}/${MAX_STEPS}]: ${funcName}`)
        window.aris9Trace?.push?.({ step, raw: raw.slice(0, 800), tool: funcName, args })

        const { toolName, observation, blocked, error, result } = await _runToolCall(funcName, args)
        executedTools.push(blocked || error ? { tool: toolName, args, error: observation } : { tool: toolName, args, result })

        _history.push({ role: 'tool', content: observation })
      }

      _pruneHistory()
      continue
    }

    // ── Caminho 2 (fallback): parser textual ACTION/ARGS ────
    const action = _parseAction(raw)

    if (!action) {
      // Nenhuma action — resposta final
      let finalText = _cleanFinalResponse(raw)

      // Se veio vazio, tenta novamente pedindo ao modelo para responder
      if (!finalText.trim()) {
        _emitAgentStage('responder', 'resposta vazia — solicitando novamente')
        const nudge = executedTools.length > 0
          ? 'Descreva ao usuário, em português e em uma ou duas frases, o resultado final da operação executada.'
          : 'Responda a solicitação do usuário em português, com pelo menos uma frase completa.'
        _history.push({ role: 'user', content: nudge })
        const retry = await _callModel(_history)
        finalText = _cleanFinalResponse(retry).trim()
        _history.pop() // remove a mensagem de retry do histórico público
      }

      // Último fallback — narra o que foi feito em vez de retornar vazio
      if (!finalText.trim()) {
        finalText = executedTools.length > 0
          ? `*Concluído.* Executado: ${executedTools.map(t => t.tool).join(', ')}.`
          : '*Processamento concluído.*'
      }

      _history.push({ role: 'assistant', content: finalText })
      if (executedTools.length > 0) _saveTaskToHistory(executedTools, finalText)
      return { acao: 'resposta', texto: finalText, steps: executedTools }
    }

    // ── Executa a tool ───────────────────────────────────────
    const { toolName, args, preText } = action
    _emitAgentStage('executor', `tool [${step + 1}/${MAX_STEPS}]: ${toolName}`)

    // Se o modelo escreveu prosa ANTES do ACTION, mostra ao usuário para não
    // perdermos comentários úteis ("vou abrir X pra você", "isso pode demorar").
    if (preText && preText.length > 3) {
      const cleaned = _cleanFinalResponse(preText).trim()
      if (cleaned && typeof window.__onAgentPreText === 'function') {
        try { window.__onAgentPreText(cleaned) } catch { /* ignora */ }
      }
    }

    // Adiciona a resposta do modelo (com o ACTION) no histórico como assistant
    _history.push({ role: 'assistant', content: raw })

    // Trace para painel de "por que fez isso"
    window.aris9Trace?.push?.({ step, raw: raw.slice(0, 800), tool: toolName, args })

    const { toolName: resolvedName, observation, blocked, error, result } = await _runToolCall(toolName, args)
    executedTools.push(blocked || error ? { tool: resolvedName, args, error: observation } : { tool: resolvedName, args, result })

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
//   ACTION: nome\nARGS: {...}  (com espaços extras, JSON com objetos aninhados)
// Retorna também `preText` (texto antes do ACTION) para não perder prosa do modelo.
function _parseAction(text) {
  if (!text || typeof text !== 'string') return null

  const idx = text.search(/ACTION:\s*[a-zA-Z0-9_.]+/i)
  if (idx === -1) return null

  const preText = text.slice(0, idx).trim()
  const rest = text.slice(idx)

  const nameMatch = rest.match(/^ACTION:\s*([a-zA-Z0-9_.]+)/i)
  if (!nameMatch) return null
  const toolName = nameMatch[1].trim()

  // Localiza o "ARGS:" após o nome
  const argsIdx = rest.search(/ARGS:\s*/i)
  if (argsIdx === -1) {
    // Sem ARGS → tool sem parâmetros
    return { toolName, args: {}, preText }
  }

  const afterArgs = rest.slice(argsIdx).replace(/^ARGS:\s*/i, '')
  const jsonStart = afterArgs.indexOf('{')
  if (jsonStart === -1) {
    return { toolName, args: {}, preText }
  }

  // Extrai bloco JSON balanceado, respeitando strings e escapes
  const jsonStr = _extractBalancedJson(afterArgs, jsonStart)
  if (!jsonStr) return { toolName, args: {}, preText }

  try {
    return { toolName, args: JSON.parse(jsonStr), preText }
  } catch {
    return { toolName, args: _tryParseLooseJson(jsonStr), preText }
  }
}

// Extrai o primeiro objeto {...} balanceado a partir de startIdx.
// Ignora chaves dentro de strings (com suporte a escape).
function _extractBalancedJson(str, startIdx) {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = startIdx; i < str.length; i++) {
    const c = str[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return str.slice(startIdx, i + 1)
    }
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
// Usa o mesmo parser balanceado do _parseAction para lidar com JSON aninhado
// e não deixar "lixo" na resposta ao usuário quando o modelo repete a sintaxe.
function _cleanFinalResponse(text) {
  if (!text) return ''
  let out = String(text)

  // Remove todos os blocos "ACTION: nome\nARGS: {...}" respeitando chaves aninhadas
  while (true) {
    const m = out.match(/ACTION:\s*[a-zA-Z0-9_.]+/i)
    if (!m) break
    const start = m.index
    const argsMatch = out.slice(start).match(/ARGS:\s*/i)
    if (!argsMatch) {
      // Só remove a linha ACTION solta
      out = out.slice(0, start) + out.slice(start).replace(/^ACTION:\s*[a-zA-Z0-9_.]+\s*/i, '')
      continue
    }
    const argsStart = start + argsMatch.index + argsMatch[0].length
    const braceIdx = out.indexOf('{', argsStart)
    if (braceIdx === -1) {
      out = out.slice(0, start) + out.slice(argsStart)
      continue
    }
    const json = _extractBalancedJson(out, braceIdx)
    const end = json ? braceIdx + json.length : argsStart
    out = out.slice(0, start) + out.slice(end)
  }

  // Remove qualquer OBSERVATION: ... que tenha vazado
  out = out.replace(/^OBSERVATION:.*$/gim, '')

  return out.trim()
}

// ── Chamada ao modelo ─────────────────────────────────────────
// Se { tools: true }, envia o schema das tools (function-calling nativo
// do Ollama, via ToolManager.toModelTools()). O modelo atual (Gemma 3n
// e2b/e4b, tag "tools" no Ollama) suporta isso — mas se o servidor
// responder com erro relacionado a "tools" (template sem suporte),
// caímos automaticamente para o modo sem tools, e o ReAct textual
// (ACTION:/ARGS: no system prompt) assume como fallback.
// Retorna a mensagem completa ({ role, content, tool_calls? }), não só o texto.
let _nativeToolsSupported = true // cache — evita re-tentar em todo turno após uma falha confirmada

async function _callModelRaw(messages, { tools = false } = {}) {
  const wantTools = tools && _nativeToolsSupported
  const schema    = wantTools ? (window.toolManager?.toModelTools?.() ?? []) : []

  const body = {
    model:    LLM_MODEL,
    messages: messages,
    stream:   false,
    ...(schema.length ? { tools: schema } : {})
  }

  const res = await fetch(OLLAMA_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    // Se o erro parece indicar que o modelo/template não suporta "tools",
    // desativa para as próximas chamadas e tenta de novo sem o campo.
    if (schema.length && /tool|does not support/i.test(errText)) {
      console.warn('[ARIS-9] Servidor rejeitou "tools" — desativando tool-calling nativo e usando fallback textual.')
      _nativeToolsSupported = false
      return _callModelRaw(messages, { tools: false })
    }
    throw new Error(`Status ${res.status}: ${errText.slice(0, 150)}`)
  }

  const data = await res.json()
  return data.message ?? { role: 'assistant', content: '' }
}

// ── Chamada simples ao modelo (retorna só o texto, sem tools) ──
// Usada nos fluxos que não precisam de tool-calling: extração de
// memória, síntese de busca web e resumo final.
async function _callModel(messages) {
  const message = await _callModelRaw(messages, { tools: false })
  return message.content ?? ''
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

// Expõe helpers no window para o terminal / voice chat
if (typeof window !== 'undefined') {
  window.agentSend  = agentSend
  window.agentReset = agentReset
  window.agentAbort = agentAbort
  window.agentAgain = agentAgain
  window.agentTaskHistory = agentTaskHistory
  window._parseAction = _parseAction
  window._cleanFinalResponse = _cleanFinalResponse
}