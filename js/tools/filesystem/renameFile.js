window.toolManager.register({
  name: 'filesystem.rename', version: '1.0.0', category: 'filesystem',
  description: 'Renomeia um arquivo ou pasta para um novo nome dentro do mesmo diretório.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: 'Caminho atual do arquivo ou pasta.' },
      newName: { type: 'string', description: 'Novo nome (somente o nome, sem caminho completo).' }
    },
    required: ['path', 'newName']
  },
  async execute({ path, newName }) {
    if (!path) throw new Error('O caminho é obrigatório.')
    if (!newName || newName.includes('/') || newName.includes('\\'))
      throw new Error('newName deve ser apenas um nome, sem separadores de caminho.')
    return window.api.rename(path, newName)
  }
})
