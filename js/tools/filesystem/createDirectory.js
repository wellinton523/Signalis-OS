window.toolManager.register({
  name: 'filesystem.mkdir', version: '1.0.0', category: 'filesystem',
  description: 'Cria uma pasta local, incluindo pastas pai quando necessário.',
  permission: window.Permission.STANDARD,
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  async execute({ path }) { return window.api.mkdir(path) }
})
