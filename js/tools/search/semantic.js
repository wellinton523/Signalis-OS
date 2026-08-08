;(function () {

  // ── search.semantic ───────────────────────────────────────────
  // Pesquisa semântica: encontra arquivos pelo CONTEÚDO sem saber o nome.
  // Lê arquivos de texto de uma pasta e usa o LLM para encontrar o mais relevante.
  window.toolManager.register({
    name: 'search.semantic', version: '1.0.0', category: 'search',
    description: 'Pesquisa semântica inteligente: encontra arquivos pelo conteúdo mesmo sem saber o nome. Ex: "onde está meu currículo?", "encontre documentos sobre contratos de aluguel". Varre uma pasta e usa IA para identificar arquivos relevantes.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        query:     { type: 'string',  description: 'Descrição do que você procura em linguagem natural.' },
        path:      { type: 'string',  description: 'Pasta onde pesquisar. Padrão: pasta home do usuário.' },
        maxFiles:  { type: 'integer', description: 'Número máximo de arquivos a analisar. Padrão: 30.' },
        recursive: { type: 'boolean', description: 'Pesquisar recursivamente em subpastas. Padrão: false.' }
      },
      required: ['query']
    },
    async execute({ query, path, maxFiles = 30, recursive = false }) {
      if (!query?.trim()) throw new Error('A descrição do que procura é obrigatória.')

      // Determina pasta base
      let basePath = path
      if (!basePath) {
        const home = await window.api.homedir()
        basePath = home || 'C:/Users'
      }

      // Lista arquivos de texto legíveis
      const TEXT_EXT = new Set(['.txt', '.md', '.html', '.htm', '.csv', '.json', '.xml',
                                 '.js', '.py', '.ts', '.css', '.yaml', '.yml', '.log',
                                 '.docx', '.pdf', '.rtf'])
      const entries = await window.api.readdir(basePath)
      if (!Array.isArray(entries)) throw new Error('Não foi possível listar a pasta.')

      const candidates = entries
        .filter(e => {
          if (e.isDir) return false
          const ext = (e.name || '').toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
          return TEXT_EXT.has(ext) || ext === ''
        })
        .slice(0, maxFiles)

      if (candidates.length === 0) return { query, found: [], message: 'Nenhum arquivo de texto encontrado na pasta.' }

      // Lê uma prévia de cada arquivo (primeiros 500 chars)
      const previews = await Promise.all(
        candidates.map(async e => {
          try {
            const content = await window.api.readfile(e.path)
            const preview = typeof content === 'string' ? content.slice(0, 500) : ''
            return { name: e.name, path: e.path, preview }
          } catch {
            return { name: e.name, path: e.path, preview: '' }
          }
        })
      )

      // Monta catálogo para o LLM decidir
      const catalog = previews
        .map((f, i) => `[${i}] ${f.name}\n${f.preview || '(sem prévia)'}`)
        .join('\n---\n')

      const prompt = `Você é um assistente de busca. O usuário procura: "${query}"

Abaixo estão arquivos disponíveis com uma prévia do conteúdo. Identifique os arquivos mais relevantes para a busca e responda APENAS com um JSON array de índices ordenado por relevância (mais relevante primeiro). Exemplo: [2, 0, 4]

Arquivos:
${catalog}

JSON:`

      const res = await fetch('/api/ollama/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b',
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      })
      const data = await res.json()
      const raw  = data.message?.content ?? ''

      // Extrai o array de índices
      let indices = []
      try {
        const match = raw.match(/\[[\s\d,]+\]/)
        if (match) indices = JSON.parse(match[0]).filter(i => typeof i === 'number')
      } catch { /* usa ordem padrão */ }

      if (indices.length === 0) indices = previews.map((_, i) => i).slice(0, 5)

      const found = indices.slice(0, 10).map(i => previews[i]).filter(Boolean).map(f => ({
        name: f.name, path: f.path
      }))

      return { query, basePath, found, totalScanned: candidates.length }
    }
  })

  // ── search.files_by_content ───────────────────────────────────
  // Pesquisa textual por conteúdo (grep-like) em múltiplos arquivos de uma pasta.
  window.toolManager.register({
    name: 'search.files_by_content', version: '1.0.0', category: 'search',
    description: 'Busca um termo ou frase dentro do conteúdo de arquivos em uma pasta (tipo grep). Retorna arquivos e linhas onde o termo foi encontrado.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        query:      { type: 'string',  description: 'Texto a buscar no conteúdo dos arquivos.' },
        path:       { type: 'string',  description: 'Pasta onde pesquisar.' },
        ignoreCase: { type: 'boolean', description: 'Ignorar maiúsculas/minúsculas. Padrão: true.' },
        maxFiles:   { type: 'integer', description: 'Máximo de arquivos a varrer. Padrão: 50.' }
      },
      required: ['query', 'path']
    },
    async execute({ query, path, ignoreCase = true, maxFiles = 50 }) {
      if (!query?.trim()) throw new Error('O termo de busca é obrigatório.')
      if (!path?.trim())  throw new Error('A pasta é obrigatória.')

      const entries = await window.api.readdir(path)
      if (!Array.isArray(entries)) throw new Error('Não foi possível listar a pasta.')

      const TEXT_EXT = new Set(['.txt', '.md', '.html', '.htm', '.csv', '.json', '.xml',
                                 '.js', '.py', '.ts', '.css', '.yaml', '.yml', '.log'])
      const files = entries
        .filter(e => !e.isDir && TEXT_EXT.has((e.name || '').toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''))
        .slice(0, maxFiles)

      const term = ignoreCase ? query.toLowerCase() : query
      const matches = []

      for (const file of files) {
        try {
          const content = await window.api.readfile(file.path)
          if (typeof content !== 'string') continue
          const lines = content.split('\n')
          const hits  = lines
            .map((line, i) => ({ line: i + 1, text: line }))
            .filter(({ text }) => (ignoreCase ? text.toLowerCase() : text).includes(term))
            .slice(0, 10)
          if (hits.length > 0) {
            matches.push({ file: file.name, path: file.path, hits })
          }
        } catch { /* ignora arquivos ilegíveis */ }
      }

      return {
        query, path,
        fileCount: files.length,
        matchCount: matches.length,
        matches
      }
    }
  })

})()
