window.toolManager.register({
  name: 'git.log', version: '1.0.0', category: 'git',
  description: 'Lista os commits mais recentes do repositório (hash, autor, data, mensagem). Somente leitura.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string',  description: 'Caminho da pasta do repositório git.' },
      limit:    { type: 'integer', description: 'Número de commits a retornar. Padrão: 15, máximo: 100.' }
    },
    required: ['repoPath']
  },
  async execute({ repoPath, limit = 15 }) {
    const result = await window.api.gitLog(repoPath, limit)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao obter log do git.')
    return { commits: result.commits }
  }
})
