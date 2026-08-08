;(function () {

  // ── Helper central ───────────────────────────────────────────
  async function _spotify(method, ...args) {
    const fn = window.api[method]
    if (!fn) throw new Error(`API Spotify não disponível (${method}).`)
    const result = await fn(...args)
    if (result?.error) throw new Error(result.error)
    return result
  }

  // ── spotify.search ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.search', version: '1.0.0', category: 'spotify',
    description: 'Busca músicas e playlists no Spotify por nome, artista ou termo. Retorna URIs, links e informações das faixas/playlists encontradas.',
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
    description: 'Abre uma música específica do Spotify no navegador pelo URI (spotify:track:ID) ou URL (https://open.spotify.com/track/ID). Use spotify.search primeiro para obter o URI da música desejada.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        uri: { type: 'string', description: 'URI da faixa no formato spotify:track:ID ou URL https://open.spotify.com/track/ID.' }
      },
      required: ['uri']
    },
    async execute({ uri }) {
      if (!uri?.trim()) throw new Error('O URI da faixa é obrigatório.')
      // Normaliza URL web → URI
      let resolved = uri.trim()
      const urlMatch = resolved.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/)
      if (urlMatch) resolved = `spotify:track:${urlMatch[1]}`
      if (!resolved.startsWith('spotify:track:')) throw new Error('URI inválido. Use spotify:track:<ID> ou https://open.spotify.com/track/<ID>.')
      return _spotify('spotifyPlay', resolved)
    }
  })

  // ── spotify.playlist ─────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.playlist', version: '1.0.0', category: 'spotify',
    description: 'Abre uma playlist do Spotify no navegador pelo URI (spotify:playlist:ID), URL (https://open.spotify.com/playlist/ID) ou ID direto. Use spotify.search para encontrar playlists.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        uri:         { type: 'string', description: 'URI da playlist: spotify:playlist:ID, URL completa ou somente o ID.' },
        playlist_id: { type: 'string', description: 'ID direto da playlist (alternativo ao uri).' }
      }
    },
    async execute({ uri, playlist_id }) {
      let resolved = (uri || playlist_id || '').trim()
      if (!resolved) throw new Error('Informe o uri ou playlist_id da playlist.')
      // Normaliza URL web → URI
      const urlMatch = resolved.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/)
      if (urlMatch) resolved = `spotify:playlist:${urlMatch[1]}`
      // ID puro (sem prefixo) → monta URI
      if (!resolved.startsWith('spotify:')) resolved = `spotify:playlist:${resolved}`
      const pl_id = resolved.split(':').pop()
      return _spotify('spotifyPlaylist', resolved, pl_id)
    }
  })

  // ── spotify.status ───────────────────────────────────────────
  window.toolManager.register({
    name: 'spotify.status', version: '1.0.0', category: 'spotify',
    description: 'Retorna o status de configuração do Spotify no servidor (se as credenciais estão configuradas).',
    permission: window.Permission.RESTRICTED,
    parameters: { type: 'object', properties: {} },
    async execute() { return _spotify('spotifyStatus') }
  })

  // ── spotify.find_and_play ────────────────────────────────────
  // Tool composta: busca a música e já abre no browser — poupa um turno do agente
  window.toolManager.register({
    name: 'spotify.find_and_play', version: '1.0.0', category: 'spotify',
    description: 'Busca uma música no Spotify pelo nome/artista e a abre automaticamente no navegador. Combina spotify.search + spotify.play em uma única ação.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nome da música e/ou artista a buscar e tocar.' }
      },
      required: ['query']
    },
    async execute({ query }) {
      if (!query?.trim()) throw new Error('Informe o nome da música ou artista.')
      const res = await _spotify('spotifySearch', query.trim(), 1)
      const first = res?.tracks?.[0]
      if (!first) return { found: false, query, message: `Nenhuma faixa encontrada para "${query}".` }
      await _spotify('spotifyPlay', first.uri)
      return {
        found:   true,
        opened:  first.url,
        name:    first.name,
        artist:  first.artist,
        album:   first.album,
        uri:     first.uri
      }
    }
  })

})()
