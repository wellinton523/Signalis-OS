window.toolManager.register({
  name: 'filesystem.duplicates', version: '1.0.0', category: 'filesystem',
  description: 'Detecta arquivos duplicados em uma pasta comparando nome e tamanho.',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: {
      path:      { type: 'string', description: 'Pasta a ser analisada.' },
      recursive: { type: 'boolean', description: 'Incluir subpastas. Padrão: true.' }
    },
    required: ['path']
  },
  async execute({ path, recursive = true }) {
    if (!path) throw new Error('O caminho é obrigatório.')
    const result = await window.api.findDuplicates(path, recursive)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
