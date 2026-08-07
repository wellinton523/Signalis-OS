// terminal.js
// ─────────────────────────────────────────────────────────────
// Terminal duplo:
//   • Texto normal  → ARIS-9 (agente de IA)
//   • .comando      → executa direto, sem chamar a IA
//   • .cmd <texto>  → passa direto pro CMD/bash do sistema
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
    const message = detail ? ` — ${escHtml(detail)}` : ''
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
  _typeLine("Comandos diretos iniciam com '.' — .help para listar.", 'dim')
}


// ── Submissão de comando ──────────────────────────────────────
async function _onSubmit(raw) {
  const text = raw.trim()
  _termInput.value = ''
  if (!text) return

  _appendLine(`<span class="t-cmd">> ${escHtml(text)}</span>`)

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
    case 'cmd':      await _cmdPassthrough(cmdRaw.slice(3).trim()); break
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
    '<span class="t-dim">── COMANDOS DIRETOS ─────────────────────────────</span>',
    '  .help                     esta lista',
    '  .clear                    limpa o terminal',
    '  .sysinfo                  informações do sistema',
    '  .ls [pasta]               lista arquivos',
    '  .cd &lt;pasta&gt;               muda diretório',
    '  .open &lt;caminho ou URL&gt;    abre arquivo ou site',
    '  .kill &lt;PID&gt;               encerra processo',
    '  .shutdown [segundos]      desliga o PC (padrão: 60s)',
    '  .shutdown cancel          cancela o desligamento',
    '  .cmd &lt;comando&gt;            executa no CMD/bash do sistema',
    '  .reset                    limpa memória do ARIS-9',
    '<span class="t-dim">── EXEMPLOS .cmd ────────────────────────────────</span>',
    '  .cmd ipconfig             info de rede (Windows)',
    '  .cmd tasklist             processos (Windows)',
    '  .cmd ping google.com      testa conexão',
    '  .cmd echo olá             imprime texto',
    '<span class="t-dim">── ARIS-9 ───────────────────────────────────────</span>',
    '  Qualquer texto sem ponto vai para o ARIS-9.',
    '  Ex: <span class="t-aris">abra o youtube</span>  /  <span class="t-aris">qual o clima?</span>',
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
// .shutdown          → desliga em 60 segundos (padrão)
// .shutdown 300      → desliga em 5 minutos
// .shutdown cancel   → cancela o desligamento agendado
async function _cmdShutdown(args) {
  const arg = args[0] ?? ''

  // Cancelar
  if (arg.toLowerCase() === 'cancel') {
    if (!_shutdownTimer) {
      _appendLine('<span class="t-warn">Nenhum desligamento agendado.</span>')
      return
    }
    clearInterval(_shutdownTimer)
    _shutdownTimer = null

    // Cancela também no nível do SO
    const cancelCmd = process?.platform === 'win32'
      ? 'shutdown /a'
      : 'shutdown -c ""'
    await api.exec(cancelCmd)

    _appendLine('<span class="t-warn">[ SHUTDOWN CANCELADO ]</span>')
    return
  }

  // Se já tem um timer rodando, bloqueia
  if (_shutdownTimer) {
    _appendLine('<span class="t-error">Já existe um desligamento agendado. Use .shutdown cancel primeiro.</span>')
    return
  }

  // Determina o tempo em segundos
  const seconds = arg === '' ? 60 : parseInt(arg)
  if (isNaN(seconds) || seconds < 1) {
    _appendLine('<span class="t-error">Uso: .shutdown [segundos] | .shutdown cancel</span>')
    return
  }

  _shutdownCountdown = seconds

  // Emite o comando real de shutdown no SO
  // No Windows: shutdown /s /t <segundos>
  // No Linux/Mac: shutdown -h +<minutos> (mínimo 1 min no Linux)
  const shutdownCmd = process?.platform === 'win32'
    ? `shutdown /s /t ${seconds}`
    : `shutdown -h +${Math.max(1, Math.ceil(seconds / 60))}`

  await api.exec(shutdownCmd)

  _appendLine(`<span class="t-error">[ SHUTDOWN AGENDADO — ${seconds}s ]</span>`)
  _appendLine('<span class="t-dim">Use .shutdown cancel para cancelar.</span>')

  // Contador visual no terminal, atualizado a cada segundo
  _shutdownTimer = setInterval(() => {
    _shutdownCountdown--

    // A cada 10 segundos (e nos últimos 10) mostra o countdown
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
// Executa qualquer comando do sistema e mostra o output no terminal.
// Exemplos: .cmd ipconfig  /  .cmd ls -la  /  .cmd ping google.com
async function _cmdPassthrough(rawCmd) {
  if (!rawCmd) {
    _appendLine('<span class="t-error">Uso: .cmd &lt;comando&gt;  — ex: .cmd ipconfig</span>')
    return
  }

  _appendLine(`<span class="t-dim">$ ${escHtml(rawCmd)}</span>`)

  const result = await api.exec(rawCmd)

  // stdout — output normal do comando
  if (result.stdout?.trim()) {
    result.stdout.trim().split('\n').forEach(line => {
      _appendLine(`<span style="color:#c8d8e8">${escHtml(line)}</span>`)
    })
  }

  // stderr — erros ou avisos do comando
  if (result.stderr?.trim()) {
    result.stderr.trim().split('\n').forEach(line => {
      _appendLine(`<span class="t-error">${escHtml(line)}</span>`)
    })
  }

  // Erro de execução em si (ex: comando não encontrado)
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

  _showAgentAction(action)

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
            _appendLine(`<span class="t-aris">${escHtml(action.texto)}</span>`)
          }
          _logTool('search', 'ok', `${results.length} resultados`)
        } else {
          _appendLine(`<span class="t-warn">Nenhum resultado encontrado.</span>`)
          if (action.texto) {
            _appendLine(`<span class="t-warn">${escHtml(action.texto)}</span>`)
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
      _appendLine(`<span class="t-aris">${escHtml(action.texto ?? '')}</span>`)
      _logTool('open', 'ok', action.parametro || 'site')
      break
    case 'abrir_arquivo':
      _logTool('open', 'start', action.parametro || 'arquivo')
      api.open(action.parametro)
      _appendLine(`<span class="t-aris">${escHtml(action.texto ?? '')}</span>`)
      _logTool('open', 'ok', action.parametro || 'arquivo')
      break
    case 'pesquisar':
    case 'abrir_busca_web':
      api.open(`https://www.google.com/search?q=${encodeURIComponent(action.parametro)}`)
      _appendLine(`<span class="t-aris">${escHtml(action.texto ?? '')}</span>`)
      break
    case 'buscar_conhecimento':
      _appendLine(`<span class="t-aris">${escHtml(action.texto ?? '')}</span>`)
      break
    case 'executar_comando': {
      const cmd = String(action.parametro ?? '').trim()
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
      if (action.texto) _appendLine(`<span class="t-aris">${escHtml(action.texto)}</span>`)
      break
    }
    case 'editar_arquivo':
      _appendLine(`<span class="t-aris">${escHtml(action.texto ?? `Atualizando ${action.parametro ?? 'arquivo'}`)}</span>`)
      break
    case 'resposta':
    default:
      _typeLine(action.texto ?? '...', 'aris')
      break
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
      message = 'respondendo'
      className = 't-aris'
      break
  }

  _appendLine(`<span class="${className}">[ARIS-9] ${escHtml(message)}</span>`)
}


// ── Helpers de output ─────────────────────────────────────────
function _logTool(name, status, detail = '') {
  if (!_termOutput) return
  const colorClass = status === 'ok' ? 't-aris' : status === 'error' ? 't-error' : 't-dim'
  const detailText = detail ? ` — ${escHtml(detail)}` : ''
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

  for (const char of text) {
    div.textContent += char
    _termOutput.scrollTop = _termOutput.scrollHeight
    await _sleep(12)
  }
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
