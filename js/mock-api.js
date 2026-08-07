// mock-api.js
// ─────────────────────────────────────────────────────────────
// Substitui o window.api do Electron quando rodando no browser.
// Simula respostas plausíveis para todas as funções de sistema.
// ─────────────────────────────────────────────────────────────

window.api = {

  // ── Janela (no browser não faz nada, só evita erro) ────────
  minimize: () => Promise.resolve(),
  maximize: () => Promise.resolve(),
  close:    () => { if (confirm('Fechar o SIGNALIS-OS?')) window.close() },

  // ── Sistema de arquivos (simulado) ────────────────────────
  homedir: () => Promise.resolve('C:/Users/operador'),

  readdir: (path) => Promise.resolve([
    { name: 'Documents',  isDir: true,  path: path + '/Documents'  },
    { name: 'Downloads',  isDir: true,  path: path + '/Downloads'  },
    { name: 'Desktop',    isDir: true,  path: path + '/Desktop'    },
    { name: 'Pictures',   isDir: true,  path: path + '/Pictures'   },
    { name: 'relatorio.pdf',   isDir: false, path: path + '/relatorio.pdf'   },
    { name: 'notas.txt',       isDir: false, path: path + '/notas.txt'       },
    { name: 'config.json',     isDir: false, path: path + '/config.json'     },
  ]),

  readfile: (path) => Promise.resolve(
    `[MOCK] Conteúdo simulado de: ${path}`
  ),

  open: (target) => {
    // No browser abre em nova aba se for URL, senão só loga
    if (target.startsWith('http://') || target.startsWith('https://')) {
      window.open(target, '_blank')
    } else {
      console.log('[MOCK] Abrir:', target)
    }
    return Promise.resolve()
  },

  // ── Sistema (dados simulados realistas) ───────────────────
  sysInfo: () => Promise.resolve({
    platform:  'browser (mock)',
    arch:      'x64',
    hostname:  'SIGNALIS-NODE',
    username:  'operador',
    totalRam:  8 * 1024 * 1024 * 1024,   // 8 GB
    freeRam:   3 * 1024 * 1024 * 1024,   // 3 GB livres
    uptime:    Math.floor(performance.now() / 1000),
    cpuModel:  'Intel Core i7-8750H (Mock)',
    cpuCores:  6,
  }),

  // CPU oscila entre 20-70% pra parecer real
  cpuUsage: () => new Promise(resolve => {
    setTimeout(() => resolve(20 + Math.floor(Math.random() * 50)), 500)
  }),

  diskUsage: () => Promise.resolve({
    used:  120 * 1e9,   // 120 GB
    total: 512 * 1e9,   // 512 GB
  }),

  // ── Processos (lista simulada) ────────────────────────────
  listProcs: () => Promise.resolve([
    { name: 'System',        pid: 4,    mem: '0.1%' },
    { name: 'explorer.exe',  pid: 1234, mem: '1.2%' },
    { name: 'chrome.exe',    pid: 2341, mem: '8.4%' },
    { name: 'signalis-os',   pid: 3456, mem: '2.1%' },
    { name: 'ollama.exe',    pid: 4567, mem: '3.8%' },
    { name: 'code.exe',      pid: 5678, mem: '5.2%' },
  ]),

  killProc: (pid) => {
    console.log('[MOCK] Kill PID:', pid)
    return Promise.resolve({ ok: true })
  },

  // ── Exec (simula output de comandos comuns) ───────────────
  exec: (cmd) => {
    const c = cmd.trim().toLowerCase()
    let stdout = ''

    if (c.startsWith('shutdown')) {
      stdout = '[MOCK] Shutdown agendado (simulado — PC não será desligado).'
    } else if (c.includes('ipconfig') || c.includes('ifconfig')) {
      stdout = [
        'Adaptador Ethernet:',
        '   Endereço IPv4: 192.168.1.42',
        '   Máscara: 255.255.255.0',
        '   Gateway: 192.168.1.1',
        '',
        'Adaptador Wi-Fi:',
        '   Endereço IPv4: 192.168.0.105',
      ].join('\n')
    } else if (c.includes('ping')) {
      const host = cmd.split(' ').pop()
      stdout = [
        `Disparando ping em ${host} [142.250.78.46]:`,
        'Resposta de 142.250.78.46: bytes=32 tempo=14ms TTL=118',
        'Resposta de 142.250.78.46: bytes=32 tempo=12ms TTL=118',
        'Resposta de 142.250.78.46: bytes=32 tempo=13ms TTL=118',
        '',
        'Estatísticas do Ping: Enviados=3, Recebidos=3, Perdidos=0',
      ].join('\n')
    } else if (c.includes('tasklist') || c.includes('ps')) {
      stdout = [
        'Nome da imagem          PID    Sessão     Uso de Mem',
        '======================== ====== ========== ===========',
        'System                      4   Services       8 KB',
        'explorer.exe             1234   Console    45.320 KB',
        'chrome.exe               2341   Console   312.448 KB',
        'ollama.exe               4567   Console    98.120 KB',
      ].join('\n')
    } else if (c.startsWith('echo')) {
      stdout = cmd.slice(5)
    } else if (c.includes('dir') || c.includes('ls')) {
      stdout = '[MOCK] Use .ls para listar arquivos no SIGNALIS-OS.'
    } else {
      stdout = `[MOCK] Comando simulado: ${cmd}\n(No Electron real, isso executaria no CMD/bash do sistema)`
    }

    return Promise.resolve({ stdout, stderr: '', error: null })
  },
}

console.log('[SIGNALIS-OS] Rodando em modo browser (mock API ativa)')
