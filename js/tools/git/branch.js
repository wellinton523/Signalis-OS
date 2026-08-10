window.toolManager.register({
  name: 'git.branch', version: '1.0.0', category: 'git',
  description: 'Lista as branches do repositório, ou cria e troca para uma nova branch se "name" for informado.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Caminho da pasta do repositório git.' },
      name:     { type: 'string', description: 'Nome de uma nova branch a criar e trocar (opcional). Se omitido, apenas lista as branches existentes.' }
    },
    required: ['repoPath']
  },
  async execute({ repoPath, name }) {
    const result = await window.api.gitBranch(repoPath, name)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha na operação de branch.')
    return name
      ? { created: true, branch: name }
      : { branches: result.output.split('\n').map(l => l.trim()).filter(Boolean) }
  }
})
