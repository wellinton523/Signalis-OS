window.toolManager.register({
  name: 'vscode.open', version: '1.0.0', category: 'vscode',
  description: 'Abre um arquivo ou pasta no VS Code (via CLI `code`). Se "line" for informado, abre o arquivo posicionado naquela linha. Requer o VS Code instalado com o comando `code` disponível no PATH.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:      { type: 'string',  description: 'Caminho do arquivo ou pasta a abrir.' },
      line:      { type: 'integer', description: 'Linha para posicionar o cursor (opcional, só funciona com arquivo).' },
      newWindow: { type: 'boolean', description: 'Abrir em uma nova janela do VS Code. Padrão: false (reusa janela existente).' }
    },
    required: ['path']
  },
  async execute({ path, line, newWindow = false }) {
    const result = await window.api.vscodeOpen(path, line, newWindow)
    if (!result?.ok) throw new Error(result?.stderr || 'Falha ao abrir no VS Code — verifique se o comando "code" está no PATH.')
    return { opened: result.opened }
  }
})
