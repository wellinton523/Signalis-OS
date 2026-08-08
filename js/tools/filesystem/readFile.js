window.toolManager.register({
  name: 'filesystem.read',
  version: '1.0.0',
  description: 'Lê o conteúdo de um arquivo de texto local.',
  category: 'filesystem',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho do arquivo a ser lido.' }
    },
    required: ['path']
  },
  async execute({ path }) {
    if (!path || typeof path !== 'string') throw new Error('O caminho do arquivo é obrigatório.')
    const content = await window.api.readfile(path)
    if (content?.error) throw new Error(content.error)
    return { path, content: String(content) }
  }
})
