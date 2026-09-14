# Integrações independentes e opcionais

## Objetivo
Permitir que cada integração seja ativada separadamente. A ausência de credenciais não bloqueia o painel nem recursos que não dependem daquela integração.

## Alterações
- Trocar o fluxo inicial obrigatório por configuração opcional: cada provedor poderá ser pulado e configurado depois em **Configurações → Integrações**.
- Exibir estados distintos e reais em cada integração:
  - **Não configurada** quando faltarem credenciais;
  - **Com problema** quando houver credenciais, mas a verificação falhar;
  - **Conectada** somente após uma verificação bem-sucedida no serviço externo.
- Manter o painel carregando mesmo quando uma ou várias integrações estiverem ausentes ou indisponíveis.
- Desativar ações dependentes no local de uso, com indicação da integração necessária. Por exemplo, comprar/importar números e fazer ligações exigem Twilio; clonagem e ativação de voz nativa exigem ElevenLabs.
- Manter as ações de configuração disponíveis para que uma integração ausente possa ser conectada individualmente.
- Ajustar a prontidão geral para não tratar integrações opcionais como bloqueio global.
- Remover qualquer aparência de conexão baseada apenas na existência de uma chave; a resposta confirmada do provedor será a fonte do estado “Conectada”.

## Próxima configuração
Como a tela atual é **Números de telefone**, começar pela **Twilio**. Solicitar somente `TWILIO_ACCOUNT_SID` e `TWILIO_AUTH_TOKEN` no formulário da própria integração; nenhuma outra credencial será pedida agora.

## Validação
- Conferir os estados sem credenciais, com credenciais inválidas e com credenciais válidas.
- Confirmar que o restante do painel permanece utilizável sem integrações configuradas.
- Confirmar que ações dependentes ficam desativadas e voltam a funcionar após conexão verificada.
