window.toolManager.register({
  name: 'knowledge.list', version: '1.0.0', category: 'knowledge',
  description: 'Lista os arquivos na base de conhecimento (pasta knowledge/) que o usuário colocou pra você já saber sem precisar pesquisar. Os arquivos pequenos já vêm automaticamente no seu contexto a cada conversa — use esta tool pra ver o que existe, e knowledge.read/search pra pegar o conteúdo completo de um arquivo grande.',
  permission: window.Permission.RESTRICTED,
  parameters: { type: 'object', properties: {} },
  async execute() { return window.api.knowledgeList() }
})
