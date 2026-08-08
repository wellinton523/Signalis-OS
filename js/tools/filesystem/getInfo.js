window.toolManager.register({
  name: 'filesystem.info',
  version: '1.0.0',
  description: 'Retorna metadados detalhados de um arquivo ou pasta: tamanho, data de criação, data de modificação, extensão, permissões e tipo.',
  category: 'filesystem',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Caminho do arquivo ou pasta.' }
    },
    required: ['path']
  },
  async execute({ path }) {
    if (!path || typeof path !== 'string') throw new Error('O caminho é obrigatório.')
    const res = await window.api.fileInfo(path)
    if (res?.error) throw new Error(res.error)
    return res
  }
})
