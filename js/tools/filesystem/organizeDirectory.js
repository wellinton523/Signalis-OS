window.toolManager.register({
  name: 'filesystem.organize', version: '1.0.0', category: 'filesystem',
  description: 'Organiza automaticamente os arquivos de uma pasta em subpastas por tipo/extensão.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:    { type: 'string', description: 'Pasta a ser organizada.' },
      dryRun:  { type: 'boolean', description: 'Se true, simula a operação sem mover arquivos. Padrão: false.' }
    },
    required: ['path']
  },
  async execute({ path, dryRun = false }) {
    if (!path) throw new Error('O caminho é obrigatório.')
    const result = await window.api.organizeDir(path, dryRun)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
