window.toolManager.register({
  name: 'filesystem.copy', version: '1.0.0', category: 'filesystem',
  description: 'Copia um arquivo ou pasta para outro local.',
  permission: window.Permission.STANDARD,
  parameters: { type: 'object', properties: { path: { type: 'string' }, destination: { type: 'string' } }, required: ['path', 'destination'] },
  async execute({ path, destination }) { return window.api.copy(path, destination) }
})
