window.toolManager.register({
  name: 'knowledge.search', version: '1.0.0', category: 'knowledge',
  description: 'Busca um termo em todos os arquivos da base de conhecimento (pasta knowledge/) e retorna os trechos onde aparece. Útil quando você não tem certeza de qual arquivo tem a informação.',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Termo a procurar nos arquivos.' } },
    required: ['query']
  },
  async execute({ query }) {
    if (!query?.trim()) throw new Error('O termo de busca é obrigatório.')
    return window.api.knowledgeSearch(query.trim())
  }
})
