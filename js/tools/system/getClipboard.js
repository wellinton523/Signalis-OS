window.toolManager.register({
  name: 'system.clipboard.get', version: '1.0.0', category: 'system',
  description: 'Lê o conteúdo atual da área de transferência.',
  permission: window.Permission.STANDARD,
  parameters: { type: 'object', properties: {} },
  async execute() {
    const result = await window.api.clipboardGet()
    if (result?.error) throw new Error(result.error)
    return result
  }
})
