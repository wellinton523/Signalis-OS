window.toolManager.register({
  name: 'filesystem.write', version: '1.0.0', category: 'filesystem',
  description: 'Cria ou substitui o conteúdo de um arquivo de texto.',
  permission: window.Permission.STANDARD,
  parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  async execute({ path, content }) { return window.api.writefile(path, content) }
})
