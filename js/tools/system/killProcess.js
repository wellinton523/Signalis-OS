window.toolManager.register({
  name: 'system.kill',
  version: '1.0.0',
  description: 'Encerra um processo pelo seu identificador (PID).',
  category: 'system',
  permission: window.Permission.ADMIN,
  parameters: {
    type: 'object',
    properties: {
      pid: { type: 'integer', description: 'Identificador numérico do processo.' }
    },
    required: ['pid']
  },
  async execute({ pid }) {
    if (!Number.isInteger(pid) || pid < 1) throw new Error('O PID deve ser um inteiro positivo.')
    const result = await window.api.killProc(pid)
    if (result?.error) throw new Error(result.error)
    return { pid, ...result }
  }
})
