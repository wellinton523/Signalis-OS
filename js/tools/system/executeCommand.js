window.toolManager.register({
  name: 'system.exec',
  version: '1.0.0',
  description: 'Executa um comando de sistema. Use somente quando o modo GOD estiver ativo.',
  category: 'system',
  permission: window.Permission.GOD,
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Comando a executar no sistema operacional.' }
    },
    required: ['command']
  },
  async execute({ command }) {
    if (!command || typeof command !== 'string') throw new Error('O comando é obrigatório.')
    const result = await window.api.exec(command)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
