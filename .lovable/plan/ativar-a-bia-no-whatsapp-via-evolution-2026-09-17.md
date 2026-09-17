# Ativar a Bia no WhatsApp via Evolution

## Situação atual
- A agente **Bia cobrança** está ativa e sincronizada para ligações.
- Ela ainda não está vinculada a nenhuma caixa de mensagens.
- Não existe uma caixa de WhatsApp criada na conta POPMED.
- O projeto já possui conexão Evolution por URL + chave, leitura do QR Code, recebimento de mensagens e resposta automática da agente.

## Implementação
1. Criar a tela **Canais** que os atalhos atuais já tentam abrir, sem alterar a configuração de voz da Bia.
2. Nessa tela, permitir conectar o WhatsApp via Evolution usando somente:
   - URL do servidor Evolution;
   - chave global da Evolution API.
3. Testar essas credenciais antes de salvar; sem confirmação externa, mostrar **Não configurada** ou **Com problema**, nunca **Conectada**.
4. Após criar a instância, exibir o QR Code e acompanhar o pareamento até o WhatsApp confirmar a conexão.
5. Permitir escolher **Bia cobrança** para a caixa de WhatsApp e ativá-la em modo automático, com limite diário e confiança mínima editáveis.
6. Desativar envio e resposta automática enquanto a conexão não estiver confirmada ou a Bia não estiver vinculada.
7. Validar o fluxo completo com uma mensagem real recebida e uma resposta enviada; registrar claramente qualquer etapa que dependa das credenciais ou do pareamento.

## Resultado
A mesma Bia continuará fazendo ligações e também poderá responder conversas recebidas no WhatsApp conectado, usando o prompt dela. As duas ativações permanecerão independentes.

## Credenciais necessárias
Somente a URL e a chave global do seu servidor Evolution serão solicitadas. Nenhuma chave fictícia será criada.
