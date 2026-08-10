window.toolManager.register({
  name: 'git.add', version: '1.0.0', category: 'git',
  description: 'Adiciona (stage) arquivos para o próximo commit.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Caminho da pasta do repositório git.' },
      files:    { type: 'array', items: { type: 'string' }, description: 'Lista de caminhos (relativos ao repo) a adicionar. Use ["."] para tudo.' }
    },
    required: ['repoPath', 'files']
  },
  async execute({ repoPath, files }) {
    const result = await window.api.gitAdd(repoPath, files)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao adicionar arquivos.')
    return { added: result.added }
  }
})
