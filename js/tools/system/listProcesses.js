window.toolManager.register({
  name: 'system.processes',
  version: '1.0.0',
  description: 'Lista os processos atualmente em execução.',
  category: 'system',
  permission: window.Permission.RESTRICTED,
  parameters: { type: 'object', properties: {} },
  async execute() {
    return window.api.listProcs()
  }
})
