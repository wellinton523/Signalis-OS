window.toolManager.register({
  name: 'git.commit', version: '1.0.0', category: 'git',
  description: 'Cria um commit com as mudanças já staged (git add). Use git.add antes se necessário.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Caminho da pasta do repositório git.' },
      message:  { type: 'string', description: 'Mensagem do commit.' }
    },
    required: ['repoPath', 'message']
  },
  async execute({ repoPath, message }) {
    const result = await window.api.gitCommit(repoPath, message)
    if (!result?.ok) throw new Error(result?.stderr || result?.output || 'Falha ao criar commit.')
    return { committed: true, output: result.output.trim() }
  }
})
