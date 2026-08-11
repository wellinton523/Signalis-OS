;(function () {

  // ── Helper central ───────────────────────────────────────────
  async function _spotify(method, ...args) {
    const fn = window.api[method]
    if (!fn) throw new Error(`API Spotify não disponível (${method}).`)
    const result = await fn(...args)
    if (result?.error) throw new Error(result.error)
    return result
  }

  // ── spotify.login ────────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.login', version: '1.0.0', category: 'spotify',
    description: 'Autoriza o SIGNALIS-OS a controlar a reprodução real do Spotify (play/pause/próxima/volume). Abre uma página de login/consentimento do Spotify no navegador. SEM isso, spotify.play só abre a página da música no navegador em vez de tocar de verdade — use esta tool sempre que o usuário reclamar que a música "abre mas não toca". Requer conta Spotify Premium pra controle remoto funcionar.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() {
      await _spotify('spotifyLogin')
      return { loginOpened: true, message: 'Abri a página de autorização do Spotify no navegador. Peça pro usuário fazer login/aceitar, e então confirme com spotify.auth_status antes de tentar tocar algo.' }
    }
  })

  // ── spotify.auth_status ──────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.auth_status', version: '1.0.0', category: 'spotify',
    description: 'Verifica se o usuário já autorizou o controle real de playback (via spotify.login). Use ANTES de spotify.play se não tiver certeza — evita tentar tocar e falhar silenciosamente.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() {
      const result = await _spotify('spotifyAuthStatus')
      return { authenticated: !!result.authenticated }
    }
  })

  // ── spotify.logout ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.logout', version: '1.0.0', category: 'spotify',
    description: 'Revoga a autorização de controle real do Spotify guardada localmente. Depois disso, spotify.play volta a só abrir a página no navegador.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyLogout') }
  })

  // ── spotify.search ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.search', version: '1.0.0', category: 'spotify',
    description: 'Busca músicas e playlists no Spotify por nome, artista ou termo. Retorna URIs, links e informações das faixas/playlists encontradas — retorna vários resultados, então escolha o mais compatível com o pedido do usuário antes de chamar spotify.play (não assuma cegamente que o primeiro resultado é o certo, especialmente se a busca for ambígua ou genérica).',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termo de busca (nome da música, artista, álbum ou playlist).' },
        limit: { type: 'integer', description: 'Quantidade de resultados por tipo (padrão 5, máximo 10).' }
      },
      required: ['query']
    },
    async execute({ query, limit = 5 }) {
      if (!query?.trim()) throw new Error('O termo de busca é obrigatório.')
      const n = Math.max(1, Math.min(10, parseInt(limit) || 5))
      return _spotify('spotifySearch', query.trim(), n)
    }
  })

  // ── spotify.play ─────────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.play', version: '1.0.0', category: 'spotify',
    description: 'Toca uma música específica pelo URI (spotify:track:ID) ou URL. Se o usuário já autorizou via spotify.login, toca DE VERDADE no dispositivo Spotify ativo dele (app ou web player já aberto — precisa de algum dispositivo com o Spotify aberto, e conta Premium). Se NÃO autorizou, só abre a página da música no navegador — isso NÃO é playback real, avise o usuário disso e sugira spotify.login. Use spotify.search primeiro para obter o URI correto.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        uri:      { type: 'string', description: 'URI da faixa no formato spotify:track:ID ou URL https://open.spotify.com/track/ID.' },
        deviceId: { type: 'string', description: 'ID de um dispositivo específico (obtido via spotify.devices). Opcional — sem isso usa o dispositivo ativo padrão.' }
      },
      required: ['uri']
    },
    async execute({ uri, deviceId }) {
      if (!uri?.trim()) throw new Error('O URI da faixa é obrigatório.')
      let resolved = uri.trim()
      const urlMatch = resolved.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/)
      if (urlMatch) resolved = `spotify:track:${urlMatch[1]}`
      if (!resolved.startsWith('spotify:track:')) throw new Error('URI inválido. Use spotify:track:<ID> ou https://open.spotify.com/track/<ID>.')
      const result = await _spotify('spotifyPlay', resolved, deviceId)
      if (!result.real_playback) {
        return { ...result, aviso: 'Isso só abriu a página no navegador, NÃO tocou de verdade. Diga isso ao usuário e sugira usar spotify.login pra controle real.' }
      }
      return result
    }
  })

  // ── spotify.playlist ─────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.playlist', version: '1.0.0', category: 'spotify',
    description: 'Toca uma playlist do Spotify pelo URI, URL ou ID direto. Mesma regra do spotify.play: só toca de verdade se o usuário autorizou via spotify.login — senão só abre a página no navegador.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        uri:         { type: 'string', description: 'URI da playlist: spotify:playlist:ID, URL completa ou somente o ID.' },
        playlist_id: { type: 'string', description: 'ID direto da playlist (alternativo ao uri).' },
        deviceId:    { type: 'string', description: 'ID de um dispositivo específico (obtido via spotify.devices). Opcional.' }
      }
    },
    async execute({ uri, playlist_id, deviceId }) {
      let resolved = (uri || playlist_id || '').trim()
      if (!resolved) throw new Error('Informe o uri ou playlist_id da playlist.')
      const urlMatch = resolved.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/)
      if (urlMatch) resolved = `spotify:playlist:${urlMatch[1]}`
      if (!resolved.startsWith('spotify:')) resolved = `spotify:playlist:${resolved}`
      const pl_id = resolved.split(':').pop()
      const result = await _spotify('spotifyPlaylist', resolved, pl_id, deviceId)
      if (!result.real_playback) {
        return { ...result, aviso: 'Isso só abriu a página no navegador, NÃO tocou de verdade. Diga isso ao usuário e sugira usar spotify.login pra controle real.' }
      }
      return result
    }
  })

  // ── spotify.pause / resume / next / previous ──────────────────
  window.toolManager.register({
    name: 'spotify.pause', version: '1.0.0', category: 'spotify',
    description: 'Pausa a reprodução atual no Spotify. Requer autorização prévia via spotify.login e um dispositivo Spotify ativo.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyPause') }
  })

  window.toolManager.register({
    name: 'spotify.resume', version: '1.0.0', category: 'spotify',
    description: 'Retoma a reprodução pausada no Spotify. Requer autorização prévia via spotify.login e um dispositivo Spotify ativo.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyResume') }
  })

  window.toolManager.register({
    name: 'spotify.next', version: '1.0.0', category: 'spotify',
    description: 'Pula para a próxima faixa no Spotify. Requer autorização prévia via spotify.login e um dispositivo Spotify ativo.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyNext') }
  })

  window.toolManager.register({
    name: 'spotify.previous', version: '1.0.0', category: 'spotify',
    description: 'Volta para a faixa anterior no Spotify. Requer autorização prévia via spotify.login e um dispositivo Spotify ativo.',
    permission: window.Permission.STANDARD,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyPrevious') }
  })

  // ── spotify.volume ────────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.volume', version: '1.0.0', category: 'spotify',
    description: 'Ajusta o volume da reprodução do Spotify (0 a 100). Requer autorização prévia via spotify.login e um dispositivo Spotify ativo.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: { volumePercent: { type: 'integer', description: 'Volume de 0 a 100.' } },
      required: ['volumePercent']
    },
    async execute({ volumePercent }) {
      const pct = parseInt(volumePercent)
      if (isNaN(pct) || pct < 0 || pct > 100) throw new Error('volumePercent deve ser um número entre 0 e 100.')
      return _spotify('spotifyVolume', pct)
    }
  })

  // ── spotify.devices ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.devices', version: '1.0.0', category: 'spotify',
    description: 'Lista os dispositivos Spotify disponíveis no momento (celular, desktop, web player). Use pra descobrir o deviceId quando quiser mandar tocar num dispositivo específico, ou pra checar se existe algum dispositivo ativo (necessário pro playback real funcionar).',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyDevices') }
  })

  // ── spotify.status ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.status', version: '1.0.0', category: 'spotify',
    description: 'Retorna o status atual: se está autenticado com playback real, e se sim, a faixa tocando agora, progresso e dispositivo. Se não estiver autenticado, avisa que spotify.login é necessário pra controle real.',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyStatus') }
  })

  // ── spotify.find_and_play ────────────────────────────────────
  // Tool composta: busca a música e já toca (ou abre) — poupa um turno do agente.
  window.toolManager.register({
    name: 'spotify.find_and_play', version: '1.0.0', category: 'spotify',
    description: 'Busca uma música pelo nome/artista e toca a que melhor combina com o pedido (compara os resultados por nome/artista antes de escolher — não pega cegamente o primeiro item). Toca de verdade se autorizado via spotify.login; senão só abre a página no navegador.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'Nome da música e/ou artista a buscar e tocar.' },
        deviceId: { type: 'string', description: 'ID de um dispositivo específico (opcional).' }
      },
      required: ['query']
    },
    async execute({ query, deviceId }) {
      if (!query?.trim()) throw new Error('Informe o nome da música ou artista.')
      const q = query.trim()
      const res = await _spotify('spotifySearch', q, 5)
      const candidates = res?.tracks || []
      if (!candidates.length) return { found: false, query: q, message: `Nenhuma faixa encontrada para "${q}".` }

      // Escolhe o melhor candidato: prioriza match de nome+artista no texto
      // buscado, em vez de assumir cegamente que o 1º resultado é o certo.
      const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const qNorm = norm(q)
      let best = candidates[0]
      let bestScore = -1
      for (const c of candidates) {
        const nameNorm   = norm(c.name)
        const artistNorm = norm(c.artist)
        let score = 0
        if (qNorm.includes(nameNorm) || nameNorm.includes(qNorm)) score += 2
        if (artistNorm && qNorm.includes(artistNorm)) score += 2
        if (score > bestScore) { bestScore = score; best = c }
      }

      const playResult = await _spotify('spotifyPlay', best.uri, deviceId)
      return {
        found:  true,
        name:   best.name,
        artist: best.artist,
        album:  best.album,
        uri:    best.uri,
        opened: playResult.opened,
        real_playback: !!playResult.real_playback,
        outrosCandidatos: candidates.filter(c => c.uri !== best.uri).slice(0, 3).map(c => `${c.name} — ${c.artist}`),
        aviso: playResult.real_playback ? undefined : 'Isso só abriu a página no navegador, NÃO tocou de verdade — sugira spotify.login pro usuário pra controle real.'
      }
    }
  })

})()