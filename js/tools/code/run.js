window.toolManager.register({
  name: 'code.run', version: '1.0.0', category: 'code',
  description: 'Executa código de verdade e retorna stdout/stderr/código de saída — use pra TESTAR código que você acabou de escrever (com filesystem.write ou code.patch) antes de dizer que está pronto. Dois modos: passe "path" pra rodar um arquivo existente (extensão define o interpretador: .py, .js, .mjs, .sh, .ps1), ou "code" + "language" pra rodar um snippet sem precisar criar arquivo primeiro. Mesmo nível de risco que system.exec — roda com permissões totais do sistema.',
  permission: window.Permission.GOD,
  parameters: {
    type: 'object',
    properties: {
      path:     { type: 'string',  description: 'Caminho de um arquivo de código já existente a executar.' },
      code:     { type: 'string',  description: 'Snippet de código a executar diretamente (alternativa a "path").' },
      language: { type: 'string',  enum: ['python', 'javascript', 'node', 'bash', 'shell', 'powershell'], description: 'Linguagem do snippet — obrigatório se usar "code".' },
      args:     { type: 'array',   items: { type: 'string' }, description: 'Argumentos de linha de comando pro script.' },
      timeout:  { type: 'integer', description: 'Tempo máximo em segundos. Padrão: 30, máximo: 120.' }
    }
  },
  async execute({ path, code, language, args = [], timeout = 30 }) {
    if (!path && !code) throw new Error('Informe "path" (arquivo existente) ou "code" + "language" (snippet).')
    const result = await window.api.codeRun({ path, code, language, args, timeout })
    if (!result) throw new Error('Sem resposta do executor de código.')
    return {
      sucesso: result.ok,
      codigoSaida: result.exitCode,
      stdout: result.stdout || '',
      stderr: result.stderr || ''
    }
  }
})
