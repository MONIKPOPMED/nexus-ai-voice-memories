# Cobrança ativa automática da Bia no WhatsApp

## Objetivo
Criar campanhas de WhatsApp que usem os devedores e as dívidas já cadastradas, com mensagem inicial individual gerada pela Bia e continuidade automática quando o devedor responder.

## Experiência no painel
- Adicionar em **Canais** uma área de **Campanhas de WhatsApp**, com criação, acompanhamento, pausa e cancelamento.
- Ao criar uma campanha, permitir:
  - escolher devedores específicos da carteira; ou
  - incluir todos os devedores com dívida aberta e telefone válido;
  - revisar a lista antes de confirmar;
  - enviar agora ou agendar data e hora;
  - visualizar uma prévia do tipo de mensagem que será gerada;
  - usar limite inicial de **100 mensagens por dia**.
- Mostrar totais de aguardando, enviadas, respondidas, ignoradas e falhas, com motivo quando um contato não puder receber.
- Manter o envio individual atual para testes e números novos.

## Regras da cobrança
- A Bia criará uma primeira mensagem diferente para cada devedor usando nome, empresa, descrição da dívida, valor e vencimento.
- O texto seguirá o prompt e a base de conhecimento da Bia, sem inventar condições, valores ou dados ausentes.
- A mensagem não exibirá CPF completo nem detalhes sensíveis além do necessário.
- Só serão elegíveis dívidas em aberto ou em negociação, com WhatsApp válido.
- Números bloqueados para contato, duplicados, sem telefone ou com dívida já encerrada serão ignorados e registrados.
- Quando o devedor responder, a conversa existente será assumida pela Bia já ativa no WhatsApp.

## Segurança e confiabilidade
- Exigir perfil administrador para criar, iniciar, pausar ou cancelar campanhas.
- Exigir WhatsApp confirmado como conectado e Bia ativa antes de iniciar.
- Criar registros próprios para campanhas e destinatários, com isolamento por conta, permissões de acesso e histórico de cada tentativa.
- Gerar a mensagem no servidor e manter credenciais fora do navegador.
- Processar os envios em fila, com espaçamento entre mensagens, limite diário e retomada segura sem duplicar envios.
- Pausar a campanha se a IA ficar indisponível por crédito/permissão ou se o WhatsApp perder a conexão; não marcar como enviada sem confirmação do servidor Evolution.
- Registrar a mensagem enviada na conversa do devedor para aparecer em **Conversas**.

## Implementação técnica
- Criar tabelas de campanhas e destinatários de WhatsApp, com índices, `GRANT`, RLS e políticas para membros da conta.
- Criar funções para listar/criar/controlar campanhas e um processador agendado para a fila.
- Reutilizar o canal Evolution confirmado, a caixa de entrada, o vínculo da Bia, os contatos, dívidas, conversas e mensagens existentes.
- Gerar textos pela Lovable AI usando o modelo padrão, com chamada no servidor, tratamento explícito de erros e sem repetição automática em falhas definitivas.
- Configurar o processamento periódico da fila para atender campanhas imediatas e agendadas.
- Adicionar os controles e indicadores à tela **Canais**, preservando o restante do painel.

## Validação
- Criar campanha de teste com poucos devedores e confirmar seleção, agendamento e limite diário.
- Confirmar que cada mensagem contém somente os dados corretos daquele devedor.
- Confirmar envio pela Evolution e gravação em **Conversas**.
- Confirmar que pausas, cancelamentos, bloqueios, falhas e respostas são refletidos no painel sem duplicação.
