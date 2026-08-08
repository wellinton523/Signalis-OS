window.toolManager.register({
  name: 'system.open', version: '1.0.0', category: 'system',
  description: 'Abre um aplicativo ou arquivo usando o programa padrão do sistema.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Caminho do executável ou arquivo a abrir.' }
    },
    required: ['target']
  },
  async execute({ target }) {
    if (!target) throw new Error('O destino é obrigatório.')
    const result = await window.api.open(target)
    if (result?.error) throw new Error(result.error)
    return { opened: target }
  }
})
