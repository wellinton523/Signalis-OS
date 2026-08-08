window.toolManager.register({
  name: 'filesystem.extract', version: '1.0.0', category: 'filesystem',
  description: 'Extrai um arquivo compactado (.zip) em um diretório de destino.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:        { type: 'string', description: 'Caminho do arquivo .zip a extrair.' },
      destination: { type: 'string', description: 'Pasta de destino para extração (opcional).' }
    },
    required: ['path']
  },
  async execute({ path, destination }) {
    if (!path) throw new Error('O caminho é obrigatório.')
    const result = await window.api.extract(path, destination || null)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
