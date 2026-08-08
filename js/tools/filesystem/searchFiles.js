window.toolManager.register({
  name: 'filesystem.search', version: '1.0.0', category: 'filesystem',
  description: 'Procura arquivos e pastas por nome dentro de uma pasta.',
  permission: window.Permission.RESTRICTED,
  parameters: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' } }, required: ['path', 'query'] },
  async execute({ path, query }) { return window.api.searchFiles(path, query) }
})
