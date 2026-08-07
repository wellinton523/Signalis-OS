// sysmon.js — Monitor de sistema em tempo real (Versão Segura)
let _sysmonWin = null
let _sysmonInterval = null
let _isUpdating = false // Impede chamadas encavaladas se o servidor demorar

// Mapeamento seguro das APIs com Timeout de 1.5s
window.api = window.api || {
  sysInfo: () => _fetchWithTimeout('/api/system/info'),
  cpuUsage: async () => {
    const data = await _fetchWithTimeout('/api/system/cpu')
    return data?.usage ?? 0
  },
  diskUsage: () => _fetchWithTimeout('/api/system/disk')
}

// Helper para evitar que o fetch trave a interface infinitamente
async function _fetchWithTimeout(url, timeout = 1500) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(id)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(id)
    return null // Retorna null em caso de erro sem quebrar a execução
  }
}

function openSysMon() {
  if (_sysmonWin && document.contains(_sysmonWin)) {
    _sysmonWin.dispatchEvent(new Event('mousedown'))
    return
  }

  // Limpa intervalo anterior se existia
  if (_sysmonInterval) clearInterval(_sysmonInterval)

  _sysmonWin = createWindow('tpl-sysmon')

  // Primeira leitura estática
  api.sysInfo().then(info => {
    if (!info) return
    const hostEl = document.getElementById('sm-host')
    const cpuEl  = document.getElementById('sm-cpu-model')
    const coreEl = document.getElementById('sm-cores')

    if (hostEl) hostEl.textContent = info.hostname || 'Desconhecido'
    if (cpuEl)  cpuEl.textContent  = info.cpuModel || 'CPU Standard'
    if (coreEl) coreEl.textContent = (info.cpuCores || 1) + ' cores'
  })

  // Leitura de disco
  api.diskUsage().then(d => {
    if (d && d.total > 0) {
      const pct   = (d.used / d.total * 100).toFixed(1)
      const usedG = (d.used / 1e9).toFixed(1)
      const totG  = (d.total / 1e9).toFixed(1)
      _setBar('sm-disk', pct, `${usedG} / ${totG} GB`)
    }
  })

  // Atualização periódica segura
  _sysmonUpdate()
  _sysmonInterval = setInterval(_sysmonUpdate, 2000)

  // Observer para limpar o intervalo ao fechar a janela
  const observer = new MutationObserver(() => {
    if (!document.contains(_sysmonWin)) {
      clearInterval(_sysmonInterval)
      _sysmonInterval = null
      observer.disconnect()
    }
  })
  
  const container = document.getElementById('windows-container')
  if (container) {
    observer.observe(container, { childList: true })
  }
}

async function _sysmonUpdate() {
  // Se a requisição anterior ainda estiver rodando, ignora esta rodada
  if (_isUpdating) return
  _isUpdating = true

  try {
    const info = await api.sysInfo()
    if (info) {
      const uptimeEl = document.getElementById('sm-uptime')
      if (uptimeEl) uptimeEl.textContent = _formatUptime(info.uptime || 0)

      if (info.totalRam > 0) {
        const usedRam = info.totalRam - info.freeRam
        const ramPct  = (usedRam / info.totalRam * 100).toFixed(1)
        const usedMB  = (usedRam / 1024 / 1024).toFixed(0)
        const totalMB = (info.totalRam / 1024 / 1024).toFixed(0)
        _setBar('sm-ram', ramPct, `${usedMB} / ${totalMB} MB`)
      }
    }

    const cpu = await api.cpuUsage()
    _setBar('sm-cpu', cpu, `${cpu}%`)

  } catch (err) {
    console.warn('[SysMon] Falha ao atualizar métricas:', err.message)
  } finally {
    _isUpdating = false
  }
}

function _setBar(id, pct, label) {
  const bar = document.getElementById(`${id}-bar`)
  const val = document.getElementById(`${id}-val`)
  if (!bar || !val) return

  const p = Math.min(Math.max(parseFloat(pct) || 0, 0), 100)
  bar.style.width = p + '%'
  bar.className   = 'progress-fill' + (p >= 85 ? ' alert' : p >= 60 ? ' warn' : '')
  val.textContent = label + ` (${Math.round(p)}%)`
}

function _formatUptime(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}