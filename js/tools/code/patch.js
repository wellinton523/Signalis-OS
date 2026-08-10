window.toolManager.register({
  name: 'code.patch', version: '1.0.0', category: 'code',
  description: 'Edita um arquivo de código substituindo um trecho exato por outro — SEM precisar reescrever o arquivo inteiro. Ideal pra mudanças pontuais (corrigir uma função, trocar uma linha, adicionar um import). "oldStr" precisa casar EXATAMENTE (incluindo espaços/indentação) e aparecer só uma vez no arquivo — se aparecer mais de uma vez ou não for encontrado, a tool falha e explica o problema, sem alterar nada. Pra criar um arquivo novo, use filesystem.write.',
  permission: window.Permission.STANDARD,
  parameters: {
    type: 'object',
    properties: {
      path:   { type: 'string', description: 'Caminho do arquivo a editar.' },
      oldStr: { type: 'string', description: 'Trecho exato a ser substituído. Deve aparecer exatamente uma vez no arquivo.' },
      newStr: { type: 'string', description: 'Texto que substitui oldStr. Pode ser vazio para remover o trecho.' }
    },
    required: ['path', 'oldStr', 'newStr']
  },
  async execute({ path, oldStr, newStr }) {
    if (oldStr === newStr) throw new Error('oldStr e newStr são idênticos — nada a fazer.')

    const current = await window.api.readfile(path)
    if (current?.error) throw new Error(current.error)
    const content = String(current)

    const firstIdx = content.indexOf(oldStr)
    if (firstIdx === -1) {
      throw new Error('oldStr não encontrado no arquivo. Confira espaços/indentação — o texto precisa casar exatamente. Considere ler o arquivo (filesystem.read) antes de tentar de novo.')
    }
    const secondIdx = content.indexOf(oldStr, firstIdx + oldStr.length)
    if (secondIdx !== -1) {
      throw new Error('oldStr aparece mais de uma vez no arquivo — inclua mais contexto ao redor pra torná-lo único.')
    }

    const updated = content.slice(0, firstIdx) + newStr + content.slice(firstIdx + oldStr.length)
    const result = await window.api.writefile(path, updated)
    if (result?.error) throw new Error(result.error)

    const oldLines = oldStr.split('\n').length
    const newLines = newStr.split('\n').length
    return { patched: true, path, linesRemoved: oldLines, linesAdded: newLines }
  }
})
