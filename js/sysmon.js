// sysmon.js — Monitor de sistema em tempo real
let _sysmonWin = null
let _sysmonInterval = null

function openSysMon() {
  if (_sysmonWin && document.contains(_sysmonWin)) {
    _sysmonWin.dispatchEvent(new Event('mousedown'))
    return
  }

  _sysmonWin = createWindow('tpl-sysmon')

  // Primeira leitura de dados estáticos
  api.sysInfo().then(info => {
    document.getElementById('sm-host').textContent       = info.hostname
    document.getElementById('sm-cpu-model').textContent  = info.cpuModel
    document.getElementById('sm-cores').textContent      = info.cpuCores + ' cores'
  })

  // Leitura de disco (muda raramente, uma vez basta)
  api.diskUsage().then(d => {
    if (d.total > 0) {
      const pct  = (d.used / d.total * 100).toFixed(1)
      const usedG = (d.used  / 1e9).toFixed(1)
      const totG  = (d.total / 1e9).toFixed(1)
      _setBar('sm-disk', pct, `${usedG} / ${totG} GB`)
    }
  })

  // Atualização periódica: CPU, RAM, uptime
  _sysmonUpdate()
  _sysmonInterval = setInterval(_sysmonUpdate, 2000)

  // Para o intervalo quando a janela é fechada
  const observer = new MutationObserver(() => {
    if (!document.contains(_sysmonWin)) {
      clearInterval(_sysmonInterval)
      observer.disconnect()
    }
  })
  observer.observe(document.getElementById('windows-container'), { childList: true })
}


async function _sysmonUpdate() {
  // Uptime do sistema
  const info = await api.sysInfo()
  document.getElementById('sm-uptime').textContent = _formatUptime(info.uptime)

  // RAM
  const usedRam  = info.totalRam - info.freeRam
  const ramPct   = (usedRam / info.totalRam * 100).toFixed(1)
  const usedMB   = (usedRam  / 1024 / 1024).toFixed(0)
  const totalMB  = (info.totalRam / 1024 / 1024).toFixed(0)
  _setBar('sm-ram', ramPct, `${usedMB} / ${totalMB} MB`)

  // CPU (lento — faz por último)
  const cpu = await api.cpuUsage()
  _setBar('sm-cpu', cpu, `${cpu}%`)
}


// Define valor e cor da barra de progresso
function _setBar(id, pct, label) {
  const bar = document.getElementById(`${id}-bar`)
  const val = document.getElementById(`${id}-val`)
  if (!bar || !val) return

  const p = parseFloat(pct)
  bar.style.width = p + '%'
  bar.className   = 'progress-fill' +
    (p >= 85 ? ' alert' : p >= 60 ? ' warn' : '')
  val.textContent = label + ` (${Math.round(p)}%)`
}


function _formatUptime(secs) {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
