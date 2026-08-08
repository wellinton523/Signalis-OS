window.toolManager.register({
  name: 'filesystem.delete', version: '1.0.0', category: 'filesystem',
  description: 'Exclui definitivamente um arquivo ou pasta local.',
  permission: window.Permission.ADMIN,
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async execute({ path }) { return window.api.remove(path) }
})
