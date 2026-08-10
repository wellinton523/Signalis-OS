window.toolManager.register({
  name: 'git.push', version: '1.0.0', category: 'git',
  description: 'Envia commits locais para o repositório remoto. Ação com efeito em serviço remoto — trate como de alto impacto (peça confirmação se apropriado).',
  permission: window.Permission.ADMIN,
  parameters: {
    type: 'object',
    properties: {
      repoPath: { type: 'string', description: 'Caminho da pasta do repositório git.' },
      remote:   { type: 'string', description: 'Nome do remote. Padrão: origin.' },
      branch:   { type: 'string', description: 'Branch a enviar. Padrão: branch atual configurado no remote.' }
    },
    required: ['repoPath']
  },
  async execute({ repoPath, remote = 'origin', branch }) {
    const result = await window.api.gitPush(repoPath, remote, branch)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao dar push.')
    return { pushed: true, output: (result.output || result.stderr || '').trim() }
  }
})
