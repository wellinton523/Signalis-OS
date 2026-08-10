window.toolManager.register({
  name: 'vscode.diff', version: '1.0.0', category: 'vscode',
  description: 'Abre uma comparação lado a lado (diff) entre dois arquivos no VS Code. Útil pra revisar mudanças entre versões de um arquivo.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      fileA: { type: 'string', description: 'Caminho do primeiro arquivo (lado esquerdo).' },
      fileB: { type: 'string', description: 'Caminho do segundo arquivo (lado direito).' }
    },
    required: ['fileA', 'fileB']
  },
  async execute({ fileA, fileB }) {
    const result = await window.api.vscodeDiff(fileA, fileB)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao abrir diff no VS Code.')
    return { diffOpened: true, fileA, fileB }
  }
})
