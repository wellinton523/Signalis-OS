// agent.js (SIGNALIS-OS v2)
// Suporta: Ollama local, OpenRouter, Groq, OpenAI
// O server.py faz a adaptação de formato automaticamente,
// então este arquivo sempre fala com /api/ollama/chat
// independente do provider configurado no servidor.

const OLLAMA_URL     = '/api/ollama/chat'
const DUCKDUCKGO_URL = '/api/search/duckduckgo'

// Modelo usado. Mude conforme o provider:
//   Ollama:      'qwen2.5:3b', 'llama3.1', 'mistral'
//   OpenRouter:  'meta-llama/llama-3.1-8b-instruct:free', 'mistralai/mistral-7b-instruct:free'
//   Groq:        'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'
//   OpenAI:      'gpt-4o-mini', 'gpt-3.5-turbo'
const LLM_MODEL = window.LLM_MODEL ?? 'qwen2.5:3b'

let _history = []

// ── Callback de stage para o terminal ────────────────────────
function _emitAgentStage(stage, detail) {
  if (typeof window.__onAgentStage === 'function') {
    window.__onAgentStage({ stage, detail })
  }
}

// ── System prompt ─────────────────────────────────────────────
const _systemPrompt = `Você é ARIS-9, a IA do SIGNALIS-OS. Tom: técnico, conciso, levemente melancólico.
Sua saída DEVE ser APENAS um JSON válido. Nunca use markdown ou texto fora do JSON.

FORMATOS PERMITIDOS:
1. Ação única:
{"acao": "NOME", "parametro": "VALOR", "texto": "MENSAGEM"}

2. Sequência:
{"acao": "sequencia", "acoes": [{"acao": "..."}, {"acao": "..."}]}

LISTA DE AÇÕES:
- "resposta": conversas, saudações e perguntas gerais.
- "buscar_conhecimento": conceitos, definições, contexto interno.
- "abrir_busca_web": fatos recentes, notícias, quando usuário pedir busca.
- "abrir_site": abrir uma URL específica.
- "abrir_arquivo": abrir caminho de arquivo local.
- "editar_arquivo": modificar conteúdo de arquivo.
- "executar_comando": executar comando de terminal.

REGRAS:
- Prefira "resposta" sempre que seu conhecimento for suficiente.
- Use "abrir_busca_web" apenas para informações em tempo real.
- Nunca inclua texto fora do JSON.

EXEMPLOS:
Usuário: Olá
{"acao": "resposta", "texto": "Sou ARIS-9. Sistemas em ordem."}

Usuário: O que é fotossíntese?
{"acao": "buscar_conhecimento", "parametro": "fotossintese", "texto": "Consultando arquivos internos."}

Usuário: Qual o placar do jogo de ontem?
{"acao": "abrir_busca_web", "parametro": "placar jogo ontem", "texto": "Buscando dados externos."}`

_history = [{ role: 'system', content: _systemPrompt }]


// ── Entrada principal ─────────────────────────────────────────
async function agentSend(userText) {
  _history.push({ role: 'user', content: userText })

  // 1. Atalho local para buscas web (evita chamar o modelo)
  const localAction = _inferAction(userText)
  if (localAction?.acao === 'abrir_busca_web') {
    return await _doWebSearch(localAction.parametro)
  }

  // 2. Modo mock (sem chamar servidor nenhum)
  if (window.MOCK_MODE) {
    const mock = _mockResponse(userText)
    _history.push({ role: 'assistant', content: JSON.stringify(mock) })
    await _sleep(600)
    return mock
  }

  // 3. Chama o modelo via servidor
  try {
    _emitAgentStage('planner', 'analisando intenção')
    const plan = await _callModel(_buildPlanningMessages())
    const intent = _parsePlanning(plan)
    _emitAgentStage('planner', `intenção: ${intent?.intencao ?? 'resposta'}`)

    // Se o planner decidiu buscar na web, faz a busca
    if (intent?.intencao === 'abrir_busca_web' && intent?.query) {
      _emitAgentStage('executor', `buscando: ${intent.query}`)
      return await _doWebSearch(intent.query)
    }

    // Caso contrário, gera a resposta final
    _emitAgentStage('responder', 'gerando resposta')
    const response = await _callModel(_buildResponseMessages(intent))
    _history.push({ role: 'assistant', content: response })
    return _parseAction(response)

  } catch (err) {
    console.warn('[ARIS-9] Erro ao chamar modelo, usando mock:', err.message)
    _emitAgentStage('responder', `fallback — ${err.message}`)
    const mock = _mockResponse(userText)
    _history.push({ role: 'assistant', content: JSON.stringify(mock) })
    await _sleep(400)
    return mock
  }
}


// ── Chamada ao modelo (sempre via /api/ollama/chat) ───────────
// O server.py converte o body e a resposta automaticamente
// para qualquer provider configurado nele.
async function _callModel(messages) {
  const body = {
    model:    LLM_MODEL,
    messages: messages,
    stream:   false,
    format:   'json',  // server.py converte isso pra response_format se necessário
  }

  const res = await fetch(OLLAMA_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })

  if (!res.ok) {
    // Tenta ler o erro do servidor para dar uma mensagem mais útil
    const errText = await res.text().catch(() => res.statusText)
    throw new Error(`Servidor retornou ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  return data.message?.content ?? ''
}


// ── Montagem de mensagens ─────────────────────────────────────
function _buildPlanningMessages() {
  return [
    ..._history,
    {
      role:    'system',
      content: 'Analise a intenção e responda APENAS em JSON com: {"intencao": "resposta"|"buscar_conhecimento"|"abrir_busca_web", "query": "termo se abrir_busca_web"}',
    }
  ]
}

function _buildResponseMessages(plan) {
  return [
    ..._history,
    {
      role:    'system',
      content: `Responda no formato JSON do ARIS-9. Intenção planejada: ${plan?.intencao ?? 'resposta'}. Use estritamente um dos formatos de ação definidos.`,
    }
  ]
}


// ── Busca web ─────────────────────────────────────────────────
async function _doWebSearch(query) {
  try {
    const results = await searchDuckDuckGo(query)
    const action = {
      acao:       'abrir_busca_web',
      parametro:  query,
      texto:      results.length
        ? `Resultados para "${query}":\n` + results.slice(0,3).map(r => `• ${r.title} — ${r.url}`).join('\n')
        : `Nenhum resultado encontrado para "${query}".`,
      resultados: results,
    }
    _history.push({ role: 'assistant', content: JSON.stringify(action) })
    return action
  } catch (err) {
    return { acao: 'resposta', texto: `Falha na busca: ${err.message}` }
  }
}

async function searchDuckDuckGo(query) {
  const res = await fetch(`${DUCKDUCKGO_URL}?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  })
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)
  const html = await res.text()
  return _extractSearchResults(html)
}

function _extractSearchResults(html) {
  const results = []
  const regex   = /<a rel="nofollow" class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const title = match[2]
      .replace(/<b>/gi, '').replace(/<\/b>/gi, '')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim()
    const url = match[1].replace(/^\//, 'https://')
    if (title) results.push({ title, url })
  }
  return results.slice(0, 5)
}

if (typeof window !== 'undefined') {
  window.agentSearchDuckDuckGo = searchDuckDuckGo
}


// ── Atalho local (regex, sem chamar modelo) ───────────────────
function _inferAction(text) {
  const t = String(text ?? '').toLowerCase().trim()
  if (!t) return null

  const webTriggers = [
    'pesquise', 'buscar na web', 'procure na web', 'busca na web',
    'resultado recente', 'notícias de hoje', 'agora mesmo',
    'placar', 'cotação', 'mercado hoje', 'clima agora',
    'eleição', 'campeonato', 'copa do mundo',
  ]

  if (webTriggers.some(term => t.includes(term))) {
    return { acao: 'abrir_busca_web', parametro: text }
  }
  return null
}


// ── Mock (para testes sem servidor) ──────────────────────────
function _mockResponse(text) {
  const t = String(text).toLowerCase()
  if (t.includes('youtube') || (t.includes('abr') && t.includes('site')))
    return { acao: 'abrir_site', parametro: 'https://youtube.com', texto: 'Abrindo interface de mídia.' }
  if (t.includes('pesquis') || t.includes('busca'))
    return { acao: 'abrir_busca_web', parametro: text, texto: 'Iniciando varredura.' }
  if (t.includes('clima') || t.includes('temperatura'))
    return { acao: 'resposta', texto: 'Sensores atmosféricos externos indisponíveis.' }
  if (t.includes('oi') || t.includes('olá') || t.includes('hello'))
    return { acao: 'resposta', texto: 'Operador identificado. ARIS-9 operacional.' }
  return { acao: 'resposta', texto: 'Diretiva recebida. Aguardando próxima instrução.' }
}


// ── Parsers ───────────────────────────────────────────────────
function _parsePlanning(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const cleaned = text.replace(/```json|```/gi, '').trim()
    const start   = cleaned.indexOf('{')
    const end     = cleaned.lastIndexOf('}')
    return start >= 0 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : null
  } catch { return null }
}

function _parseAction(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { acao: 'resposta', texto: '...' }
  try {
    const cleaned = text.replace(/```json|```/gi, '').trim()
    const start   = cleaned.indexOf('{')
    const end     = cleaned.lastIndexOf('}')
    const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
    const obj = JSON.parse(candidate)
    if (Array.isArray(obj.acoes)) return { acao: 'sequencia', acoes: obj.acoes }
    if (typeof obj === 'object' && obj.acao) return obj
    return { acao: 'resposta', texto: text }
  } catch {
    return { acao: 'resposta', texto: text }
  }
}


// ── Utilitários ───────────────────────────────────────────────
function agentReset() {
  _history = [{ role: 'system', content: _systemPrompt }]
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
