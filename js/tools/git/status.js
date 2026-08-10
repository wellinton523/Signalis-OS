window.toolManager.register({
  name: 'git.status', version: '1.0.0', category: 'git',
  description: 'Mostra o status do repositório git: branch atual, arquivos modificados, novos e staged. Somente leitura.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: { repoPath: { type: 'string', description: 'Caminho da pasta do repositório git.' } },
    required: ['repoPath']
  },
  async execute({ repoPath }) {
    const result = await window.api.gitStatus(repoPath)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao obter status do git.')
    return { status: result.status.trim() || '(nada para commitar, working tree limpo)' }
  }
})
