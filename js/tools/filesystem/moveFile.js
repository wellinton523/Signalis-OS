window.toolManager.register({
  name: 'filesystem.move', version: '1.0.0', category: 'filesystem',
  description: 'Move ou renomeia um arquivo ou pasta.',
  permission: window.Permission.STANDARD,
  parameters: { type: 'object', properties: { path: { type: 'string' }, destination: { type: 'string' } }, required: ['path', 'destination'] },
  async execute({ path, destination }) { return window.api.move(path, destination) }
})
