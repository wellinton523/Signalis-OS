window.toolManager.register({
  name: 'system.clipboard.set', version: '1.0.0', category: 'system',
  description: 'Escreve texto na área de transferência.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Texto a ser copiado para a área de transferência.' }
    },
    required: ['text']
  },
  async execute({ text }) {
    if (typeof text !== 'string') throw new Error('O texto é obrigatório.')
    const result = await window.api.clipboardSet(text)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
