window.toolManager.register({
  name: 'browser.open',
  version: '1.0.0',
  description: 'Abre uma página web no navegador padrão.',
  category: 'browser',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL HTTP ou HTTPS a abrir.' }
    },
    required: ['url']
  },
  async execute({ url }) {
    if (!/^https?:\/\//i.test(url || '')) throw new Error('A URL deve começar com http:// ou https://.')
    await window.api.open(url)
    return { opened: url }
  }
})
