;(function () {

  window.toolManager.register({
    name: 'browser.download', version: '1.0.0', category: 'browser',
    description: 'Baixa um arquivo de uma URL e salva no disco local. Retorna o caminho onde o arquivo foi salvo.',
    permission: window.Permission.STANDARD,
    parameters: {
      type: 'object',
      properties: {
        url:         { type: 'string',  description: 'URL do arquivo a baixar.' },
        destination: { type: 'string',  description: 'Caminho local onde salvar (incluindo nome do arquivo). Se omitido, salva na pasta Downloads do usuário com o nome original.' }
      },
      required: ['url']
    },
    async execute({ url, destination }) {
      if (!url?.trim()) throw new Error('A URL é obrigatória.')
      const res = await window.api.browserDownload(url.trim(), destination ?? null)
      if (res?.error) throw new Error(res.error)
      return res
    }
  })

})()
