# Corrigir inclusão na base de conhecimento da Bia

## Diagnóstico confirmado

A tela está enviando o documento corretamente, mas a inclusão falha porque essa ação usa a chave global `ELEVENLABS_API_KEY`. A resposta externa é `401 — Invalid API key`. Outras ações da Bia já usam a credencial ElevenLabs salva especificamente para a conta POPMED, mas a função da base RAG ainda não segue esse padrão.

## Alterações

1. Fazer a inclusão de texto e URL na base de conhecimento usar primeiro a credencial ElevenLabs da conta POPMED, com o mesmo resolvedor já usado na sincronização da agente.
2. Manter a chave global apenas como fallback legado, sem expor nenhuma credencial.
3. Retornar mensagens claras para chave ausente, inválida ou sem permissão, em vez de apresentar apenas “erro 502”.
4. Preservar o texto preenchido quando ocorrer falha, para evitar que o usuário precise digitá-lo novamente.
5. Publicar novamente a função existente e testar a inclusão real do documento “Política de negociação e descontos”.
6. Confirmar que o documento aparece em “Documentos no agente” e fica vinculado à Bia cobrança.

## Resultado esperado

O botão **Adicionar à base** passa a usar a conexão ElevenLabs da POPMED. A inclusão só será marcada como concluída após confirmação real da ElevenLabs; credencial inválida será mostrada como problema de configuração.

## Observação técnica

A correção reutilizará `resolveCredentialsForAccount` em `elevenlabs-kb-add`, mantendo a verificação de acesso à conta e o vínculo do documento com o agente já sincronizado.
