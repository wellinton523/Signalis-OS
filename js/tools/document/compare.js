;(function () {

  // Helper: call local LLM with a one-shot prompt
  async function _llm(prompt) {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: window.LLM_MODEL ?? 'nexusriot/Gemma-4-Uncensored-HauhauCS-Aggressive:e2b',
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    })
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`)
    const data = await res.json()
    return data.message?.content ?? ''
  }

  // ── document.compare ─────────────────────────────────────────
  window.toolManager.register({
    name: 'document.compare', version: '1.0.0', category: 'document',
    description: 'Compara dois arquivos de texto e retorna as diferenças e semelhanças entre eles. Útil para comparar versões de documentos, contratos, relatórios, etc.',
    permission: window.Permission.RESTRICTED,
    parameters: {
      type: 'object',
      properties: {
        pathA:    { type: 'string', description: 'Caminho do primeiro arquivo.' },
        pathB:    { type: 'string', description: 'Caminho do segundo arquivo.' },
        maxChars: { type: 'integer', description: 'Limite de caracteres por arquivo. Padrão: 3000.' }
      },
      required: ['pathA', 'pathB']
    },
    async execute({ pathA, pathB, maxChars = 3000 }) {
      if (!pathA || !pathB) throw new Error('Os dois caminhos são obrigatórios.')
      const [contentA, contentB] = await Promise.all([
        window.api.readfile(pathA),
        window.api.readfile(pathB)
      ])
      if (typeof contentA !== 'string') throw new Error(`Não foi possível ler: ${pathA}`)
      if (typeof contentB !== 'string') throw new Error(`Não foi possível ler: ${pathB}`)

      const snippetA = contentA.slice(0, maxChars)
      const snippetB = contentB.slice(0, maxChars)

      // Diff rápido por linhas
      const linesA = snippetA.split('\n')
      const linesB = snippetB.split('\n')
      const setA = new Set(linesA)
      const setB = new Set(linesB)
      const onlyInA = linesA.filter(l => l.trim() && !setB.has(l)).slice(0, 20)
      const onlyInB = linesB.filter(l => l.trim() && !setA.has(l)).slice(0, 20)
      const common  = linesA.filter(l => l.trim() && setB.has(l)).length

      const prompt = `Compare os dois documentos abaixo e forneça uma análise concisa em português:
- Semelhanças principais
- Diferenças mais relevantes
- Conclusão: qual versão é mais completa ou recente?

[Documento A — ${pathA}]:
${snippetA}

[Documento B — ${pathB}]:
${snippetB}`

      const analysis = await _llm(prompt)

      return {
        pathA, pathB,
        statsA: { lines: linesA.length, chars: contentA.length },
        statsB: { lines: linesB.length, chars: contentB.length },
        diff: { onlyInA, onlyInB, commonLineCount: common },
        analysis,
        truncated: contentA.length > maxChars || contentB.length > maxChars
      }
    }
  })

})()
