window.toolManager.register({
  name: 'filesystem.open',
  version: '1.0.0',
  description: 'Abre um arquivo ou pasta local usando o aplicativo padrão.',
  category: 'filesystem',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho local a abrir.' }
    },
    required: ['path']
  },
  async execute({ path }) {
    if (!path || typeof path !== 'string') throw new Error('O caminho é obrigatório.')
    await window.api.open(path)
    return { opened: path }
  }
})
