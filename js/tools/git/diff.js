window.toolManager.register({
  name: 'git.diff', version: '1.0.0', category: 'git',
  description: 'Mostra as diferenças (diff) de mudanças ainda não commitadas. Somente leitura.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string',  description: 'Caminho da pasta do repositório git.' },
      staged:   { type: 'boolean', description: 'Mostrar diff das mudanças já staged (git add). Padrão: false.' },
      file:     { type: 'string',  description: 'Limitar o diff a um arquivo específico (opcional).' }
    },
    required: ['repoPath']
  },
  async execute({ repoPath, staged = false, file }) {
    const result = await window.api.gitDiff(repoPath, staged, file)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao obter diff do git.')
    return { diff: result.diff.trim() || '(sem mudanças)', truncated: !!result.truncated }
  }
})
