// terminal.js
// ─────────────────────────────────────────────────────────────
// Terminal duplo com suporte estendido a Markdown (Ênfase & Código)
//   • Formatadores suportados: **negrito**, *itálico*, `código`, *`código em itálico`*
//   • Suporte a comandos de ação via **act:comando**
//   • Interceptador de shutdown integrado com contagem regressiva
// ─────────────────────────────────────────────────────────────

let _terminalWin    = null
let _termOutput     = null
let _termInput      = null
let _termPrefix     = null
let _currentDir     = ''
let _terminalBusy   = false

// Controle do temporizador de shutdown
let _shutdownTimer    = null
let _shutdownCountdown = 0

if (typeof window !== 'undefined') {
  window.__onAgentStage = ({ stage, detail }) => {
    if (!_termOutput) return
    const label = String(stage || 'agent').toLowerCase()
    const message = detail ? ` — ${_parseMarkdown(escHtml(detail))}` : ''
    _appendLine(`<span class="t-dim">[agent] ${escHtml(label)}${message}</span>`)
  }
}

function openTerminal() {
  if (_terminalWin && document.contains(_terminalWin)) {
    _terminalWin.dispatchEvent(new Event('mousedown'))
    return
  }

  _terminalWin = createWindow('tpl-terminal')
  _termOutput  = _terminalWin.querySelector('.terminal-output')
  _termInput   = _terminalWin.querySelector('#terminal-input')
  _termPrefix  = _terminalWin.querySelector('#terminal-prefix')

  api.homedir().then(home => {
    _currentDir = home
    _updatePrefix()
  })

  _termInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') _onSubmit(_termInput.value)
  })

  setTimeout(() => _termInput.focus(), 100)

  _typeLine('SIGNALIS-OS // TERMINAL v0.1', 'dim')
  _typeLine('ARIS-9 ONLINE. AGUARDANDO DIRETIVA.', 'aris')
  _typeLine("Comandos diretos iniciam com '.' — Suporte a Markdown expandido.", 'dim')
}


// ── Submissão de comando (Entrada do Usuário) ────────────────
async function _onSubmit(raw) {
  let text = raw.trim()
  _termInput.value = ''
  if (!text) return

  // Extrai ação explícita no formato **act:comando**
  let actionSuffix = null
  const actionMatch = text.match(/\*\*act:([a-zA-Z0-9_\-]+)\*\*$/)

  if (actionMatch) {
    actionSuffix = actionMatch[1].toLowerCase()
    text = text.replace(/\*\*act:([a-zA-Z0-9_\-]+)\*\*$/, '').trim()
  }

  _appendLine(`<span class="t-cmd">> ${_parseMarkdown(escHtml(raw))}</span>`)

  if (actionSuffix) {
    const handled = await _processSuffixAction(actionSuffix, text)
    if (handled) return
  }

  if (text.startsWith('.')) {
    await _runDirect(text.slice(1).trim())
  } else {
    if (_terminalBusy) {
      _appendLine('<span class="t-error">ARIS-9 PROCESSANDO. AGUARDE.</span>')
      return
    }
    _terminalBusy = true
    _termInput.disabled = true
    
    await agentSend(text)
      .then(action => _handleAgentAction(action))
      .catch(err   => _appendLine(`<span class="t-error">[FALHA] ${escHtml(err)}</span>`))
      .finally(() => {
        _terminalBusy = false
        _termInput.disabled = false
        _termInput.focus()
      })
  }
}


// ── Processador de Ações via Sufixo ──────────────────────────
async function _processSuffixAction(actionName, content) {
  switch (actionName) {
    case 'cmd':
    case 'exec':
      await _cmdPassthrough(content)
      return true

    case 'web':
    case 'search':
      await _handleAgentAction({ acao: 'abrir_busca_web', parametro: content, texto: `Buscando: ${content}` })
      return true

    case 'clear':
      _termOutput.innerHTML = ''
      return true

    case 'open':
      await _cmdOpen([content])
      return true

    default:
      return false
  }
}


// ── Comandos diretos ──────────────────────────────────────────
async function _runDirect(cmdRaw) {
  const parts = cmdRaw.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  if (!parts.length) return

  const cmd  = parts[0].toLowerCase()
  const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''))

  switch (cmd) {
    case 'help':     _cmdHelp();                break
    case 'clear':    _termOutput.innerHTML = ''; break
    case 'sysinfo':  await _cmdSysinfo();       break
    case 'ls':
    case 'dir':      await _cmdLs(args);        break
    case 'cd':       await _cmdCd(args);        break
    case 'open':     await _cmdOpen(args);      break
    case 'kill':     await _cmdKill(args);      break
    case 'shutdown': await _cmdShutdown(args);  break
    case 'system':   await _cmdSystem(args);    break
    case 'cmd':      await _cmdPassthrough(cmdRaw.slice(3).trim()); break
    case 'ps':       await _cmdPs();            break
    case 'mem':      await _cmdMem(args);       break
    case 'tools':    _cmdTools(args);           break
    case 'clip':     await _cmdClip(args);      break
    case 'reset':
      agentReset()
      _appendLine('<span class="t-dim">Memória de sessão do ARIS-9 limpa.</span>')
      break
    default:
      _appendLine(`<span class="t-error">Comando desconhecido: .${escHtml(cmd)} — tente .help</span>`)
  }
}


function _cmdHelp() {
  const lines = [
    '<span class="t-dim">── FORMATAÇÕES DE ÊNFASE SUPORTADAS ──────────────</span>',
    '  <span class="t-aris">**texto**</span>          Negrito / Alerta',
    '  <span class="t-aris">*texto*</span>           Itálico / Destaque suave',
    '  <span class="t-aris">`texto`</span>           Código / Comando inline',
    '  <span class="t-aris">*`texto`*</span>         Itálico com estilo de código',
    '<span class="t-dim">── COMANDOS DIRETOS ─────────────────────────────</span>',
    '  .help                            esta lista',
    '  .clear                           limpa o terminal',
    '  .sysinfo                         informações do sistema',
    '  .ls [pasta]                      lista arquivos',
    '  .cd &lt;pasta&gt;                      muda diretório',
    '  .open &lt;caminho ou URL&gt;           abre arquivo ou site',
    '  .kill &lt;PID&gt;                      encerra processo',
    '  .ps                              lista processos em execução',
    '  .shutdown [segundos]             desliga o PC (padrão: 60s)',
    '  .shutdown cancel                 cancela o desligamento',
    '  .system permission               mostra o nível de permissão',
    '  .system permission &lt;nível&gt;       altera: restricted, standard, admin ou god',
    '  .cmd &lt;comando&gt;                   executa no CMD/bash do sistema',
    '  .tools [categoria]               lista ferramentas registradas',
    '  .mem list [tag]                  lista memória persistente (filtro por tag)',
    '  .mem get &lt;chave&gt;                 recupera valor da memória',
    '  .mem set &lt;chave&gt; &lt;valor&gt; [#tag] armazena na memória',
    '  .mem del &lt;chave&gt;                 remove da memória',
    '  .mem search &lt;termo&gt;             busca por texto na memória',
    '  .mem history [n]                 últimas n tarefas executadas',
    '  .mem ctx list|save|load          gerencia contextos de conversa',
    '  .clip get                        lê a área de transferência',
    '  .clip set &lt;texto&gt;               escreve na área de transferência',
    '  .reset                           limpa memória de sessão do ARIS-9',
  ]
  lines.forEach(l => _appendLine(l))
}


async function _cmdSysinfo() {
  const info = await api.sysInfo()
  const usedRam  = ((info.totalRam - info.freeRam) / 1024 / 1024).toFixed(0)
  const totalRam = (info.totalRam / 1024 / 1024).toFixed(0)
  const lines = [
    '<span class="t-dim">── SYSINFO ──────────────────────────────────</span>',
    `  PLATAFORMA : ${info.platform}`,
    `  HOST       : ${info.hostname}`,
    `  USUÁRIO    : ${info.username}`,
    `  CPU        : ${info.cpuModel} (${info.cpuCores} cores)`,
    `  RAM        : ${usedRam} / ${totalRam} MB`,
    `  DIR ATUAL  : ${_currentDir}`,
  ]
  lines.forEach(l => _appendLine(l))
}


async function _cmdLs(args) {
  const target = args[0]
    ? (args[0].match(/^[a-zA-Z]:/) || args[0].startsWith('/') ? args[0] : `${_currentDir}/${args[0]}`)
    : _currentDir

  const entries = await api.readdir(target)
  if (entries.error) {
    _appendLine(`<span class="t-error">Erro: ${escHtml(entries.error)}</span>`)
    return
  }
  _appendLine(`<span class="t-dim">${escHtml(target)}</span>`)
  entries.forEach(e => {
    if (e.isDir) _appendLine(`  <span class="t-warn">[ ${escHtml(e.name)} ]</span>`)
    else         _appendLine(`  ${escHtml(e.name)}`)
  })
}


async function _cmdCd(args) {
  if (!args.length) { _appendLine('<span class="t-error">Uso: .cd &lt;pasta&gt;</span>'); return }

  let target = args[0]
  if (target === '..') {
    const parts = _currentDir.replace(/\\/g, '/').split('/')
    parts.pop()
    target = parts.join('/') || '/'
  } else if (!target.match(/^[a-zA-Z]:/) && !target.startsWith('/')) {
    target = `${_currentDir}/${target}`
  }

  const entries = await api.readdir(target)
  if (entries.error) {
    _appendLine(`<span class="t-error">Pasta não encontrada: ${escHtml(target)}</span>`)
    return
  }
  _currentDir = target
  _updatePrefix()
  _appendLine(`<span class="t-dim">Diretório: ${escHtml(_currentDir)}</span>`)
}


async function _cmdOpen(args) {
  if (!args.length) { _appendLine('<span class="t-error">Uso: .open &lt;caminho ou URL&gt;</span>'); return }
  const target = args.join(' ')
  await api.open(target)
  _appendLine(`<span class="t-dim">Abrindo: ${escHtml(target)}</span>`)
}


async function _cmdKill(args) {
  if (!args.length) { _appendLine('<span class="t-error">Uso: .kill &lt;PID&gt;</span>'); return }
  const pid = parseInt(args[0])
  if (isNaN(pid)) { _appendLine(`<span class="t-error">PID inválido: ${escHtml(args[0])}</span>`); return }

  const result = await api.killProc(pid)
  if (result.error) _appendLine(`<span class="t-error">Falha: ${escHtml(result.error)}</span>`)
  else              _appendLine(`<span class="t-dim">Processo ${pid} encerrado.</span>`)
}


// ── .shutdown ─────────────────────────────────────────────────
async function _cmdShutdown(args) {
  const arg = args[0] ?? ''

  if (arg.toLowerCase() === 'cancel') {
    if (!_shutdownTimer) {
      _appendLine('<span class="t-warn">Nenhum desligamento agendado.</span>')
      return
    }
    clearInterval(_shutdownTimer)
    _shutdownTimer = null

    const cancelCmd = process?.platform === 'win32'
      ? 'shutdown /a'
      : 'shutdown -c ""'
    await api.exec(cancelCmd)

    _appendLine('<span class="t-warn">[ SHUTDOWN CANCELADO ]</span>')
    return
  }

  if (_shutdownTimer) {
    _appendLine('<span class="t-error">Já existe um desligamento agendado. Use .shutdown cancel primeiro.</span>')
    return
  }

  const seconds = arg === '' ? 60 : parseInt(arg)
  if (isNaN(seconds) || seconds < 1) {
    _appendLine('<span class="t-error">Uso: .shutdown [segundos] | .shutdown cancel</span>')
    return
  }

  _shutdownCountdown = seconds

  const shutdownCmd = process?.platform === 'win32'
    ? `shutdown /s /t ${seconds}`
    : `shutdown -h +${Math.max(1, Math.ceil(seconds / 60))}`

  await api.exec(shutdownCmd)

  _appendLine(`<span class="t-error">[ SHUTDOWN AGENDADO — ${seconds}s ]</span>`)
  _appendLine('<span class="t-dim">Use .shutdown cancel para cancelar.</span>')

  _shutdownTimer = setInterval(() => {
    _shutdownCountdown--

    if (_shutdownCountdown <= 10 || _shutdownCountdown % 10 === 0) {
      _appendLine(`<span class="t-error">DESLIGANDO EM ${_shutdownCountdown}s</span>`)
    }

    if (_shutdownCountdown <= 0) {
      clearInterval(_shutdownTimer)
      _shutdownTimer = null
    }
  }, 1000)
}


// ── .cmd — passthrough para CMD/bash ──────────────────────────
async function _cmdPassthrough(rawCmd) {
  if (!rawCmd) {
    _appendLine('<span class="t-error">Uso: .cmd &lt;comando&gt;  — ex: .cmd ipconfig</span>')
    return
  }

  _appendLine(`<span class="t-dim">$ ${escHtml(rawCmd)}</span>`)

  let result
  try {
    result = await window.toolManager.execute('system.exec', { command: rawCmd }, { source: 'terminal' })
  } catch (err) {
    _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    return
  }

  if (result.stdout?.trim()) {
    result.stdout.trim().split('\n').forEach(line => {
      _appendLine(`<span style="color:#c8d8e8">${escHtml(line)}</span>`)
    })
  }

  if (result.stderr?.trim()) {
    result.stderr.trim().split('\n').forEach(line => {
      _appendLine(`<span class="t-error">${escHtml(line)}</span>`)
    })
  }

  if (result.error) {
    _appendLine(`<span class="t-error">Erro ao executar: ${escHtml(result.error)}</span>`)
  }
}


// ── Resposta do ARIS-9 ────────────────────────────────────────
async function _handleAgentAction(action) {
  if (!action) return

  if (String(action.acao ?? '').toLowerCase() === 'sequencia' && Array.isArray(action.acoes)) {
    for (const step of action.acoes) {
      await _handleAgentAction(step)
    }
    return
  }

  let rawText = action.texto ?? ''

  let agentActionSuffix = null
  const actionMatch = rawText.match(/\*\*act:([a-zA-Z0-9_\-]+)\*\*$/)

  if (actionMatch) {
    agentActionSuffix = actionMatch[1].toLowerCase()
    rawText = rawText.replace(/\*\*act:([a-zA-Z0-9_\-]+)\*\*$/, '').trim()
    action.texto = rawText
  }

  _showAgentAction(action)

  if (agentActionSuffix) {
    const handled = await _processSuffixAction(agentActionSuffix, action.parametro || rawText)
    if (handled) return
  }

  switch (String(action.acao ?? '').toLowerCase()) {
    case 'buscar_web': {
      const query = String(action.parametro ?? '').trim() || 'pesquisa web'
      _logTool('search', 'start', query)
      try {
        const results = Array.isArray(action.resultados) && action.resultados.length
          ? action.resultados
          : await window.agentSearchDuckDuckGo?.(query)
        if (results?.length) {
          _appendLine(`<span class="t-aris">Resultados encontrados para ${escHtml(query)}:</span>`)
          results.slice(0, 3).forEach(item => {
            _appendLine(`<span class="t-dim">• ${escHtml(item.title)}<br><span style="color:#6ee7f9">${escHtml(item.url)}</span></span>`)
          })
          if (action.texto) {
            _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto))}</span>`)
          }
          _logTool('search', 'ok', `${results.length} resultados`)
        } else {
          _appendLine(`<span class="t-warn">Nenhum resultado encontrado.</span>`)
          if (action.texto) {
            _appendLine(`<span class="t-warn">${_parseMarkdown(escHtml(action.texto))}</span>`)
          }
          _logTool('search', 'ok', 'sem resultados')
        }
      } catch (err) {
        _appendLine(`<span class="t-error">Falha na pesquisa: ${escHtml(err.message || err)}</span>`)
        _logTool('search', 'error', err.message || err)
      }
      break
    }
    case 'abrir_site':
      _logTool('open', 'start', action.parametro || 'site')
      api.open(action.parametro)
      _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto ?? ''))}</span>`)
      _logTool('open', 'ok', action.parametro || 'site')
      break
    case 'abrir_arquivo':
      _logTool('open', 'start', action.parametro || 'arquivo')
      api.open(action.parametro)
      _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto ?? ''))}</span>`)
      _logTool('open', 'ok', action.parametro || 'arquivo')
      break
    case 'pesquisar':
    case 'abrir_busca_web':
      api.open(`https://www.google.com/search?q=${encodeURIComponent(action.parametro)}`)
      _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto ?? ''))}</span>`)
      break
    case 'buscar_conhecimento':
      _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto ?? ''))}</span>`)
      break
    case 'executar_comando': {
      const cmd = String(action.parametro ?? '').trim()

      // Intercepta e delega o desligamento para o temporizador nativo do terminal
      if (cmd.toLowerCase().startsWith('shutdown')) {
        const parts = cmd.split(/\s+/)
        const tIndex = parts.indexOf('/t') !== -1 ? parts.indexOf('/t') : parts.indexOf('-t')
        const seconds = tIndex !== -1 && parts[tIndex + 1] ? parts[tIndex + 1] : '10'
        
        if (action.texto) _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto))}</span>`)
        await _cmdShutdown([seconds])
        break
      }

      if (cmd) {
        _logTool('exec', 'start', cmd)
        _appendLine(`<span class="t-dim">$ ${escHtml(cmd)}</span>`)
        const result = await api.exec(cmd)
        if (result.stdout?.trim()) {
          result.stdout.trim().split('\n').forEach(line => {
            _appendLine(`<span style="color:#c8d8e8">${escHtml(line)}</span>`)
          })
        }
        if (result.stderr?.trim()) {
          result.stderr.trim().split('\n').forEach(line => {
            _appendLine(`<span class="t-error">${escHtml(line)}</span>`)
          })
        }
        if (result.error) {
          _appendLine(`<span class="t-error">Erro ao executar: ${escHtml(result.error)}</span>`)
          _logTool('exec', 'error', result.error)
        } else {
          _logTool('exec', 'ok', 'comando concluído')
        }
      }
      if (action.texto) _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto))}</span>`)
      break
    }
    case 'editar_arquivo':
      _appendLine(`<span class="t-aris">${_parseMarkdown(escHtml(action.texto ?? `Atualizando ${action.parametro ?? 'arquivo'}`))}</span>`)
      break
    case 'resposta':
    default: {
      // Exibe as etapas executadas (tools do ReAct loop) antes da resposta final
      if (Array.isArray(action.steps) && action.steps.length > 0) {
        action.steps.forEach(s => {
          const label = s.error
            ? `<span class="t-error">[tool] ${escHtml(s.tool)} — erro: ${escHtml(s.error)}</span>`
            : `<span class="t-dim">[tool] ${escHtml(s.tool)} — ok</span>`
          _appendLine(label)
        })
      }
      _typeLine(action.texto ?? '...', 'aris')
      break
    }
  }
}

function _showAgentAction(action) {
  if (!action || !action.acao) return

  const label = String(action.acao).toLowerCase()
  let message = ''
  let className = 't-warn'

  switch (label) {
    case 'abrir_site':
      message = `abrindo ${action.parametro || 'site'}`
      break
    case 'abrir_arquivo':
      message = `abrindo ${action.parametro || 'arquivo'}`
      break
    case 'pesquisar':
    case 'abrir_busca_web':
    case 'buscar_web':
      message = `abrindo busca web para ${action.parametro || 'termo'}`
      break
    case 'sequencia':
      message = 'executando sequência de ações'
      break
    case 'buscar_conhecimento':
      message = `aprendendo sobre ${action.parametro || 'tema'}`
      break
    case 'executar_comando':
      message = `executando ${action.parametro || 'comando'}`
      className = 't-error'
      break
    case 'editar_arquivo':
      message = `atualizando ${action.parametro || 'arquivo'}`
      className = 't-warn'
      break
    case 'resposta':
    default:
      // Não exibe "[ARIS-9] respondendo" — a resposta em si já aparece na linha seguinte
      return
  }

  _appendLine(`<span class="${className}">[ARIS-9] ${escHtml(message)}</span>`)
}


function _parseMarkdown(str) {
  let text = String(str);

  // Guarda blocos markdown temporariamente para evitar dupla conversão
  const placeholders = [];

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, target) => {
    const id = placeholders.length;

    const safeTarget = target
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'");

    placeholders.push(
      `<a href="#" onclick="api.open('${safeTarget}');return false;" class="t-link">${escHtml(label)}</a>`
    );

    return `§LINK${id}§`;
  });

  // URLs diretas
  text = text.replace(
    /\bhttps?:\/\/[^\s<>"')]+/gi,
    url => {
      const safe = url
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");

      return `<a href="#" onclick="api.open('${safe}');return false;" class="t-link">${escHtml(url)}</a>`;
    }
  );

  // Código itálico
  text = text.replace(
    /\*`([^`]+)`\*/g,
    '<code class="t-code t-code-italic">$1</code>'
  );

  // Negrito
  text = text.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong>$1</strong>'
  );

  // Itálico
  text = text.replace(
    /\*([^*]+)\*/g,
    '<em>$1</em>'
  );

  // Código
  text = text.replace(
    /`([^`]+)`/g,
    '<code class="t-code">$1</code>'
  );

  // Restaura links markdown
  text = text.replace(/§LINK(\d+)§/g, (_, i) => placeholders[Number(i)]);

  return text;
}

function _logTool(name, status, detail = '') {
  if (!_termOutput) return
  const colorClass = status === 'ok' ? 't-aris' : status === 'error' ? 't-error' : 't-dim'
  const detailText = detail ? ` — ${_parseMarkdown(escHtml(detail))}` : ''
  _appendLine(`<span class="${colorClass}">[tool] ${escHtml(name)} ${escHtml(status)}${detailText}</span>`)
}

function _appendLine(html) {
  if (!_termOutput) return
  const div = document.createElement('div')
  div.innerHTML = html
  _termOutput.appendChild(div)
  _termOutput.scrollTop = _termOutput.scrollHeight
}

async function _typeLine(text, cssClass = '') {
  if (!_termOutput) return
  const div = document.createElement('div')
  if (cssClass) div.className = `t-${cssClass}`
  _termOutput.appendChild(div)

  const formattedHtml = _parseMarkdown(escHtml(text))
  div.innerHTML = formattedHtml
  _termOutput.scrollTop = _termOutput.scrollHeight
}

function _updatePrefix() {
  if (!_termPrefix) return
  const parts = _currentDir.replace(/\\/g, '/').split('/')
  const short = parts[parts.length - 1] || '/'
  _termPrefix.textContent = `ARIS@OS:${short}$ `
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function escHtml(str) {
  return String(str)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function _cmdSystem(args) {
  if (args[0]?.toLowerCase() !== 'permission') {
    _appendLine('<span class="t-error">Uso: .system permission [restricted|standard|admin|god]</span>')
    return
  }

  const requested = args[1]?.toLowerCase()
  if (!requested) {
    _appendLine(`<span class="t-dim">Nível atual: ${escHtml(window.permissionManager.name)}</span>`)
    return
  }

  if (requested === 'god') {
    _appendLine('<span class="t-warn">Para ativar GOD, execute: .system permission god CONFIRM</span>')
    if (args[2] !== 'CONFIRM') return
  }

  try {
    window.permissionManager.setByName(requested)
    _appendLine(`<span class="t-aris">Nível de permissão alterado para: ${escHtml(window.permissionManager.name)}</span>`)
  } catch (err) {
    _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
  }
}


// ── .ps — lista processos ─────────────────────────────────────
async function _cmdPs() {
  let procs
  try {
    procs = await window.toolManager.execute('system.processes', {}, { source: 'terminal' })
  } catch (err) {
    _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    return
  }
  if (!Array.isArray(procs) || !procs.length) {
    _appendLine('<span class="t-dim">Nenhum processo retornado.</span>')
    return
  }
  _appendLine('<span class="t-dim">── PROCESSOS ────── PID ─── MEM% ──</span>')
  procs.slice(0, 40).forEach(p => {
    const mem = typeof p.mem === 'number' ? p.mem.toFixed(1) + '%' : '—'
    _appendLine(`  <span style="color:#c8d8e8">${escHtml(String(p.name).padEnd(30))} ${String(p.pid).padEnd(8)} ${mem}</span>`)
  })
  if (procs.length > 40) _appendLine(`<span class="t-dim">... e mais ${procs.length - 40} processo(s)</span>`)
}


// ── .tools — lista tools registradas ──────────────────────────
function _cmdTools(args) {
  const filter = args[0]?.toLowerCase() || ''
  const tools = window.toolManager?.list() ?? []
  const filtered = filter ? tools.filter(t => t.category?.toLowerCase().includes(filter)) : tools

  if (!filtered.length) {
    _appendLine(`<span class="t-warn">Nenhuma ferramenta encontrada${filter ? ` para categoria "${escHtml(filter)}"` : ''}.</span>`)
    return
  }

  const byCategory = {}
  filtered.forEach(t => {
    const cat = t.category || 'geral'
    ;(byCategory[cat] = byCategory[cat] || []).push(t)
  })

  Object.entries(byCategory).forEach(([cat, list]) => {
    _appendLine(`<span class="t-dim">── ${escHtml(cat.toUpperCase())} ──</span>`)
    list.forEach(t => {
      const perm = ['RESTRICTED','STANDARD','ADMIN','GOD'][t.permission] ?? '?'
      _appendLine(`  <span class="t-aris">${escHtml(t.name)}</span> <span class="t-dim">[${perm}]</span> — ${escHtml(t.description)}`)
    })
  })
}


// ── .mem — memória persistente ────────────────────────────────
async function _cmdMem(args) {
  const sub = args[0]?.toLowerCase()

  if (!sub || sub === 'list') {
    const tag = args[1] || undefined
    let entries
    try {
      entries = await window.toolManager.execute('memory.list', tag ? { tag } : {}, { source: 'terminal' })
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
      return
    }
    if (!entries.length) {
      _appendLine(`<span class="t-dim">Memória persistente vazia${tag ? ` (tag: ${escHtml(tag)})` : ''}.</span>`)
      return
    }
    _appendLine(`<span class="t-dim">── MEMÓRIA PERSISTENTE${tag ? ' [tag:' + escHtml(tag) + ']' : ''} ───────────────</span>`)
    entries.forEach(e => {
      const val  = typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value)
      const tags = e.tags?.length ? ` <span class="t-dim">[${e.tags.join(', ')}]</span>` : ''
      _appendLine(`  <span class="t-aris">${escHtml(e.key)}</span>${tags} = ${escHtml(val)} <span class="t-dim">(${e.updatedAt})</span>`)
    })
    return
  }

  if (sub === 'get') {
    const key = args[1]
    if (!key) { _appendLine('<span class="t-error">Uso: .mem get &lt;chave&gt;</span>'); return }
    try {
      const r = await window.toolManager.execute('memory.get', { key }, { source: 'terminal' })
      if (!r.found) _appendLine(`<span class="t-warn">Chave não encontrada: ${escHtml(key)}</span>`)
      else {
        const val  = typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
        const tags = r.tags?.length ? ` <span class="t-dim">[${r.tags.join(', ')}]</span>` : ''
        _appendLine(`<span class="t-aris">${escHtml(key)}</span>${tags} = ${escHtml(val)}`)
      }
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'set') {
    const key  = args[1]
    const rest = args.slice(2)
    // suporte a tags: .mem set chave valor #tag1 #tag2
    const tagArgs = rest.filter(a => a.startsWith('#')).map(a => a.slice(1))
    const valArgs = rest.filter(a => !a.startsWith('#'))
    const value   = valArgs.join(' ')
    if (!key || !value) { _appendLine('<span class="t-error">Uso: .mem set &lt;chave&gt; &lt;valor&gt; [#tag]</span>'); return }
    try {
      await window.toolManager.execute('memory.set', { key, value, tags: tagArgs }, { source: 'terminal' })
      const tagStr = tagArgs.length ? ` [${tagArgs.join(', ')}]` : ''
      _appendLine(`<span class="t-dim">Armazenado: ${escHtml(key)}${escHtml(tagStr)} = ${escHtml(value)}</span>`)
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'del' || sub === 'delete' || sub === 'rm') {
    const key = args[1]
    if (!key) { _appendLine('<span class="t-error">Uso: .mem del &lt;chave&gt;</span>'); return }
    try {
      const r = await window.toolManager.execute('memory.delete', { key }, { source: 'terminal' })
      _appendLine(r.deleted
        ? `<span class="t-dim">Chave removida: ${escHtml(key)}</span>`
        : `<span class="t-warn">Chave não encontrada: ${escHtml(key)}</span>`)
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'search') {
    const query = args.slice(1).join(' ')
    if (!query) { _appendLine('<span class="t-error">Uso: .mem search &lt;termo&gt;</span>'); return }
    try {
      const results = await window.toolManager.execute('memory.search', { query }, { source: 'terminal' })
      if (!results.length) { _appendLine(`<span class="t-warn">Nenhum resultado para "${escHtml(query)}".</span>`); return }
      _appendLine(`<span class="t-dim">── RESULTADOS (${results.length}) ──</span>`)
      results.forEach(e => {
        const val = typeof e.value === 'object' ? JSON.stringify(e.value) : String(e.value)
        _appendLine(`  <span class="t-aris">${escHtml(e.key)}</span> = ${escHtml(val)}`)
      })
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'history') {
    const limit = parseInt(args[1] || '10')
    try {
      const history = await window.toolManager.execute('memory.history', { limit }, { source: 'terminal' })
      if (!history.length) { _appendLine('<span class="t-dim">Nenhuma tarefa registrada ainda.</span>'); return }
      _appendLine('<span class="t-dim">── HISTÓRICO DE TAREFAS ──────────────</span>')
      history.forEach(h => {
        const tools = h.tools?.join(', ') || '—'
        _appendLine(`  <span class="t-dim">${h.at}</span>`)
        _appendLine(`  <span class="t-aris">ferramentas:</span> ${escHtml(tools)}`)
        _appendLine(`  ${escHtml(h.summary)}`)
      })
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'ctx') {
    const action = args[1]?.toLowerCase()
    if (!action || action === 'list') {
      try {
        const ctxs = await window.toolManager.execute('memory.context.list', {}, { source: 'terminal' })
        if (!ctxs.length) { _appendLine('<span class="t-dim">Nenhum contexto salvo.</span>'); return }
        _appendLine('<span class="t-dim">── CONTEXTOS SALVOS ──────────────────</span>')
        ctxs.forEach(c => _appendLine(`  <span class="t-aris">${escHtml(c.name)}</span> <span class="t-dim">(${c.savedAt})</span> — ${escHtml(c.preview)}`))
      } catch (err) {
        _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
      }
      return
    }
    if (action === 'save') {
      const name    = args[2]
      const content = args.slice(3).join(' ')
      if (!name || !content) { _appendLine('<span class="t-error">Uso: .mem ctx save &lt;nome&gt; &lt;conteúdo&gt;</span>'); return }
      try {
        await window.toolManager.execute('memory.context.save', { name, content }, { source: 'terminal' })
        _appendLine(`<span class="t-dim">Contexto salvo: ${escHtml(name)}</span>`)
      } catch (err) {
        _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
      }
      return
    }
    if (action === 'load') {
      const name = args[2]
      if (!name) { _appendLine('<span class="t-error">Uso: .mem ctx load &lt;nome&gt;</span>'); return }
      try {
        const r = await window.toolManager.execute('memory.context.load', { name }, { source: 'terminal' })
        if (!r.found) _appendLine(`<span class="t-warn">Contexto não encontrado: ${escHtml(name)}</span>`)
        else _appendLine(`<span class="t-aris">${escHtml(name)}:</span>\n${escHtml(r.content)}`)
      } catch (err) {
        _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
      }
      return
    }
    _appendLine('<span class="t-error">Uso: .mem ctx [list|save|load]</span>')
    return
  }

  _appendLine('<span class="t-error">Uso: .mem [list|get|set|del|search|history|ctx] ...</span>')
}


// ── .clip — área de transferência ────────────────────────────
async function _cmdClip(args) {
  const sub = args[0]?.toLowerCase()

  if (!sub || sub === 'get') {
    try {
      const r = await window.toolManager.execute('system.clipboard.get', {}, { source: 'terminal' })
      _appendLine(`<span class="t-dim">Área de transferência:</span>`)
      _appendLine(`<span style="color:#c8d8e8">${escHtml(r.text || '(vazio)')}</span>`)
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  if (sub === 'set') {
    const text = args.slice(1).join(' ')
    if (!text) { _appendLine('<span class="t-error">Uso: .clip set &lt;texto&gt;</span>'); return }
    try {
      await window.toolManager.execute('system.clipboard.set', { text }, { source: 'terminal' })
      _appendLine(`<span class="t-dim">Copiado para a área de transferência.</span>`)
    } catch (err) {
      _appendLine(`<span class="t-error">${escHtml(err.message)}</span>`)
    }
    return
  }

  _appendLine('<span class="t-error">Uso: .clip [get|set &lt;texto&gt;]</span>')
}
