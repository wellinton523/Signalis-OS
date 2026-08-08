window.toolManager.register({
  name: 'filesystem.list',
  version: '1.0.0',
  description: 'Lista arquivos e diretórios de uma pasta local.',
  category: 'filesystem',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho da pasta a ser listada.' }
    },
    required: ['path']
  },
  async execute({ path }) {
    if (!path || typeof path !== 'string') throw new Error('O caminho da pasta é obrigatório.')
    const entries = await window.api.readdir(path)
    if (entries?.error) throw new Error(entries.error)
    return entries
  }
})
