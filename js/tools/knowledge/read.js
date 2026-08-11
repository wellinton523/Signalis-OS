window.toolManager.register({
  name: 'knowledge.read', version: '1.0.0', category: 'knowledge',
  description: 'Lê o conteúdo completo de um arquivo específico da base de conhecimento (pasta knowledge/). Use quando o resumo automático no seu contexto não for suficiente ou o arquivo for grande demais pra ter sido injetado por completo.',
  permission: window.Permission.RESTRICTED,
  parameters: {
    type: 'object',
    properties: { file: { type: 'string', description: 'Nome do arquivo (ex: "preferencias.md"), sem caminho — use knowledge.list pra ver os nomes disponíveis.' } },
    required: ['file']
  },
  async execute({ file }) {
    if (!file) throw new Error('O nome do arquivo é obrigatório.')
    const result = await window.api.knowledgeRead(file)
    if (result?.error) throw new Error(result.error)
    return result
  }
})
