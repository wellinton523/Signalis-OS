# Base de conhecimento — SIGNALIS-OS

Solte arquivos `.md`, `.txt` ou `.json` nesta pasta com informações que você
quer que a IA já saiba, sem precisar pesquisar ou você explicar de novo toda vez.

Exemplos do que colocar aqui:
- Preferências pessoais (ex: "sempre prefiro respostas curtas e diretas")
- Informações de projetos em andamento
- Contatos, endereços, dados recorrentes
- Convenções do seu código/projeto (ex: "este projeto usa Python 3.11 e Poetry")

Arquivos pequenos (poucos parágrafos) são injetados automaticamente no
contexto da IA a cada conversa. Arquivos grandes ficam disponíveis via
busca (tool knowledge.search) em vez de serem injetados por completo,
pra não estourar o contexto do modelo.

Este arquivo (_leia-me.md) é ignorado na injeção automática.
