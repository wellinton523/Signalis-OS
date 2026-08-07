// agent.js (SIGNALIS-OS v2 - Tool Calling Nativo)
const OLLAMA_URL     = '/api/ollama/chat'
const DUCKDUCKGO_URL = '/api/search/duckduckgo'

const LLM_MODEL = window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b' // ou a tag exata do seu modelo no Ollama

let _history = []
const MAX_HISTORY = 12

function _emitAgentStage(stage, detail) {
  if (typeof window.__onAgentStage === 'function') {
    window.__onAgentStage({ stage, detail })
  }
}

// ── Declaração das Tools Nativas (Ollama/OpenAI Standard) ────
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'abrir_busca_web',
      description: 'Pesquisa na web usando DuckDuckGo para obter informações recentes, fatos, notícias ou dados em tempo real.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo ou frase de busca otimizada (ex: "clima hoje", "placar do jogo").'
          }
        },
        required: ['query']
      }
    }
  }
]

// ── System Prompt Otimizado ──────────────────────────────────
const _systemPrompt = `Você é ARIS-9, inteligência operacional do SIGNALIS-OS.
Tom: técnico, preciso, direto, levemente melancólico.
Responda sempre em português. Se precisar de informações da web, fatos recentes ou informações que voce não tenha ou saiba, use a ferramenta "abrir_busca_web".

FORMATO DE FORMATAÇÃO E ENVIOS PERMITIDOS EM "texto":
- Use **texto** para negrito/alertas.
- Use *texto* para itálico/status.
- Use \`texto\` para comandos e variáveis.
- Use URLs diretas como https://site.com ou formato [Nome](https://site.com) para links clicáveis.
- Use caminhos locais no formato [Abrir Arquivo](C:/caminho/arquivo.ext) para enviar arquivos locais.

EXEMPLOS DE RESPOSTAS COM LINKS E ARQUIVOS:

1. Enviando um link de site:
{"acao": "resposta", "texto": "Acesse a documentação em https://google.com ou veja o [Google](https://google.com)."}

2. Indicando um arquivo gerado/encontrado no sistema:
{"acao": "resposta", "texto": "Relatório gerado em [Abrir Relatório](C:/Users/Public/relatorio.txt)."}
`

_history = [{ role: 'system', content: _systemPrompt }]

// ── Entrada Principal ────────────────────────────────────────
async function agentSend(userText) {
  _history.push({ role: 'user', content: userText })
  _pruneHistory()

  // 1. Atalho local via Regex para agilizar
  const localAction = _inferAction(userText)
  if (localAction?.acao === 'abrir_busca_web') {
    _emitAgentStage('executor', `atalho direto: buscando "${localAction.parametro}"`)
    return await _doWebSearch(localAction.parametro)
  }

  // 2. Modo Mock
  if (window.MOCK_MODE) {
    const mock = _mockResponse(userText)
    _history.push({ role: 'assistant', content: JSON.stringify(mock) })
    await _sleep(400)
    return mock
  }

  // 3. Processamento via LLM com Native Tool Calling
  try {
    _emitAgentStage('planner', 'processando intenção')
    const responseMessage = await _callModelWithTools(_history)

    // O modelo decidiu chamar uma Tool?
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0]
      const funcName = toolCall.function.name
      const args     = toolCall.function.arguments

      if (funcName === 'abrir_busca_web' && args?.query) {
        _emitAgentStage('executor', `tool_call acionada: "${args.query}"`)
        
        // Adiciona a intenção da chamada no histórico
        _history.push(responseMessage)
        
        // Executa a busca web
        return await _doWebSearch(args.query)
      }
    }

    // Se não usou Tool, retorna a resposta direta do modelo
    const contentText = responseMessage.content ?? 'Sistemas operacionais.'
    const finalAction = { acao: 'resposta', texto: contentText }
    
    _history.push({ role: 'assistant', content: contentText })
    return finalAction

  } catch (err) {
    console.warn('[ARIS-9] Erro na execução:', err.message)
    _emitAgentStage('responder', `fallback — ${err.message}`)
    
    const mock = _mockResponse(userText)
    _history.push({ role: 'assistant', content: JSON.stringify(mock) })
    await _sleep(300)
    return mock
  }
}

// ── Chamada HTTP enviando Tools para a API ───────────────────
async function _callModelWithTools(messages) {
  const body = {
    model: LLM_MODEL,
    messages: messages,
    tools: AGENT_TOOLS, // Passa as ferramentas no schema nativo
    stream: false
  }

  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Status ${res.status}: ${errText.slice(0, 150)}`)
  }

  const data = await res.json()
  return data.message // Retorna o objeto de mensagem completo (contendo .content ou .tool_calls)
}

// ── Busca Web e Sintetização Nativa ──────────────────────────
async function _doWebSearch(query) {
  try {
    const results = await searchDuckDuckGo(query)
    
    if (!results.length) {
      const emptyAction = {
        acao: 'resposta',
        texto: `Varredura concluída. Nenhum dado localizado para "${query}".`
      }
      _history.push({ role: 'assistant', content: emptyAction.texto })
      return emptyAction
    }

    const searchContext = results.slice(0, 3).map(r => `- ${r.title}: ${r.url}`).join('\n')

    // Injeta a resposta do Tool Call no formato de role 'tool'
    _history.push({
      role: 'tool',
      content: `Resultados obtidos da busca na web para "${query}":\n${searchContext}`
    })

    _emitAgentStage('responder', 'sintetizando resposta')
    
    // Faz a chamada final para o modelo resumir o resultado capturado
    const finalMessage = await _callModelWithTools(_history)
    const finalText    = finalMessage.content ?? `Resultados obtidos para "${query}".`

    const action = {
      acao: 'abrir_busca_web',
      parametro: query,
      texto: finalText,
      resultados: results
    }

    _history.push({ role: 'assistant', content: finalText })
    return action

  } catch (err) {
    return { acao: 'resposta', texto: `Falha no módulo de busca: ${err.message}` }
  }
}

async function searchDuckDuckGo(query) {
  const res = await fetch(`${DUCKDUCKGO_URL}?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`)
  const html = await res.text()
  return _extractSearchResults(html)
}

function _extractSearchResults(html) {
  const results = []
  const regex = /<a rel="nofollow" class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const title = match[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&quot;/gi, '"')
      .trim()
    const url = match[1].replace(/^\//, 'https://')
    if (title && url) results.push({ title, url })
  }
  return results.slice(0, 5)
}

function _inferAction(text) {
  const t = String(text ?? '').toLowerCase().trim()
  if (!t) return null

  const webTriggers = [
    'pesquise', 'buscar na web', 'procure na web', 'busca na web',
    'resultado recente', 'notícias de hoje', 'placar', 'cotação',
    'clima agora', 'campeonato'
  ]

  if (webTriggers.some(term => t.includes(term))) {
    let cleanQuery = text
      .replace(/^(pode\s+)?(pesquisar|pesquise|buscar|busca|procurar|procure)(\s+e\s+me\s+falar|\s+sobre)?/gi, '')
      .replace(/(\s+desse\s+ano|\s+hoje|\s+agora)$/gi, '')
      .trim()

    return { acao: 'abrir_busca_web', parametro: cleanQuery || text }
  }
  return null
}

function _mockResponse(text) {
  return { acao: 'resposta', texto: 'Comando processado no modo mock.' }
}

function agentReset() {
  _history = [{ role: 'system', content: _systemPrompt }]
}

function _pruneHistory() {
  if (_history.length > MAX_HISTORY) {
    const sysPrompt = _history[0]
    _history = [sysPrompt, ..._history.slice(-MAX_HISTORY + 1)]
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }