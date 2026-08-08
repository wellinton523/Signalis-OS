window.toolManager.register({
  name: 'browser.fetch', version: '1.0.0', category: 'browser',
  description: 'Baixa o conteúdo textual de uma URL HTTP/HTTPS e retorna o texto limpo (sem HTML).',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      url:      { type: 'string', description: 'URL HTTP ou HTTPS a buscar.' },
      maxChars: { type: 'integer', description: 'Limite de caracteres do texto retornado. Padrão: 6000.' }
    },
    required: ['url']
  },
  async execute({ url, maxChars = 6000 }) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('A URL deve começar com http:// ou https://.')
    const result = await window.api.browserFetch(url, maxChars)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
