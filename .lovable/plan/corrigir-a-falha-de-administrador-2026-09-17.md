# Corrigir a falha de administrador

## Objetivo
Impedir que um usuário comum transforme a própria conta em superadministrador, sem remover as permissões legítimas da administradora da POPMED.

## Alterações
- Remover a regra duplicada de atualização do perfil que atualmente ignora a proteção do campo `is_super_admin`.
- Adicionar uma proteção no banco que bloqueia alterações desse campo feitas por usuários comuns, mesmo em chamadas diretas.
- Restringir as permissões das tabelas de perfil, associação e funções administrativas ao mínimo necessário.
- Manter `monikmendes@popmed.com.br` como administradora da conta POPMED e superadministradora.
- Validar as regras finais e confirmar que o acesso administrativo legítimo continua ativo.

## Fora deste ajuste
- Não configurar e-mail nem Asaas.
- A cobrança continuará usando importação por planilha; nenhuma integração será marcada como conectada sem verificação.
