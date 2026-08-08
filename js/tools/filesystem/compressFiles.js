window.toolManager.register({
  name: 'filesystem.compress', version: '1.0.0', category: 'filesystem',
  description: 'Compacta um arquivo ou pasta em um arquivo .zip.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:        { type: 'string', description: 'Caminho do arquivo ou pasta a compactar.' },
      destination: { type: 'string', description: 'Caminho de destino do arquivo .zip (opcional).' }
    },
    required: ['path']
  },
  async execute({ path, destination }) {
    if (!path) throw new Error('O caminho é obrigatório.')
    const result = await window.api.compress(path, destination || null)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
