// document analysis tools — text-based summarization and search using the local LLM
;(function () {

  // Helper: call the ARIS-9 LLM with a one-shot prompt, returns response text
  async function _llmOneShot(prompt) {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    })
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
    const data = await res.json()
    return data.message?.content ?? ''
  }

  window.toolManager.register({
    name: 'document.summarize', version: '1.0.0', category: 'document',
    description: 'Lê um arquivo de texto e retorna um resumo gerado pela IA. Suporta TXT, MD, HTML, CSV, JSON e XML.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        path:     { type: 'string', description: 'Caminho do arquivo a resumir.' },
        maxChars: { type: 'integer', description: 'Limite de caracteres a enviar para a IA. Padrão: 4000.' }
      },
      required: ['path']
    },
    async execute({ path, maxChars = 4000 }) {
      if (!path) throw new Error('O caminho é obrigatório.')
      const fileData = await window.api.readfile(path)
      if (typeof fileData !== 'string') throw new Error('Não foi possível ler o arquivo.')
      const snippet = fileData.slice(0, maxChars)
      const prompt = `Você é ARIS-9. Leia o conteúdo abaixo e forneça um resumo conciso em português:\n\n${snippet}`
      const summary = await _llmOneShot(prompt)
      return { path, summary, truncated: fileData.length > maxChars }
    }
  })

  window.toolManager.register({
    name: 'document.search', version: '1.0.0', category: 'document',
    description: 'Busca por conteúdo em um arquivo de texto. Retorna as linhas que contêm o termo buscado.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        path:        { type: 'string', description: 'Caminho do arquivo a analisar.' },
        query:       { type: 'string', description: 'Termo ou frase a buscar no documento.' },
        ignoreCase:  { type: 'boolean', description: 'Ignorar maiúsculas/minúsculas. Padrão: true.' }
      },
      required: ['path', 'query']
    },
    async execute({ path, query, ignoreCase = true }) {
      if (!path) throw new Error('O caminho é obrigatório.')
      if (!query) throw new Error('O termo de busca é obrigatório.')
      const content = await window.api.readfile(path)
      if (typeof content !== 'string') throw new Error('Não foi possível ler o arquivo.')
      const lines = content.split('\n')
      const term = ignoreCase ? query.toLowerCase() : query
      const matches = lines
        .map((line, i) => ({ line: i + 1, text: line }))
        .filter(({ text }) => (ignoreCase ? text.toLowerCase() : text).includes(term))
      return { path, query, matchCount: matches.length, matches: matches.slice(0, 100) }
    }
  })

  window.toolManager.register({
    name: 'document.extract', version: '1.0.0', category: 'document',
    description: 'Extrai informações estruturadas de um documento (e-mails, datas, valores monetários, URLs).',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo a analisar.' }
      },
      required: ['path']
    },
    async execute({ path }) {
      if (!path) throw new Error('O caminho é obrigatório.')
      const content = await window.api.readfile(path)
      if (typeof content !== 'string') throw new Error('Não foi possível ler o arquivo.')
      const emails  = [...new Set((content.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g) || []))]
      const urls    = [...new Set((content.match(/https?:\/\/[^\s<>"']+/g) || []))]
      const dates   = [...new Set((content.match(/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g) || []))]
      const values  = [...new Set((content.match(/R\$\s*[\d.,]+|US\$\s*[\d.,]+|\$\s*[\d.,]+/g) || []))]
      return { path, emails, urls, dates, monetaryValues: values }
    }
  })

})()
