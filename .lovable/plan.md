# Corrigir credenciais Twilio

## Objetivo
Fazer todas as ações de telefonia usarem as credenciais Twilio verificadas da conta ativa, sem misturar credenciais globais antigas.

## Alterações
- Corrigir a discagem de saída para carregar `Account SID` e autenticação do cofre da conta.
- Corrigir cancelamentos de chamadas para usar as credenciais da conta de cada ligação.
- Ajustar o carregador compartilhado do número para respeitar a mesma origem de credenciais.
- Manter a integração como indisponível quando faltarem credenciais e preservar os erros reais da Twilio.
- Publicar as funções alteradas e validar as credenciais com uma consulta segura, sem originar chamada paga.

## Detalhes técnicos
A ordem será: credenciais da conta no cofre, configuração específica do número e, apenas quando o cofre não estiver disponível, variáveis globais. A autenticação aceitará Auth Token ou API Key + API Secret conforme já suportado pelo cliente compartilhado.
