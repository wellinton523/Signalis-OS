window.toolManager.register({
  name: 'browser.scrape', version: '1.0.0', category: 'browser',
  description: 'Extrai links, títulos e parágrafos estruturados de uma página web.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      url:    { type: 'string', description: 'URL HTTP ou HTTPS a analisar.' },
      filter: { type: 'string', description: 'Filtro de texto para links (opcional). Retorna apenas links cujo href contém o termo.' }
    },
    required: ['url']
  },
  async execute({ url, filter }) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('A URL deve começar com http:// ou https://.')
    const result = await window.api.browserScrape(url, filter || null)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
