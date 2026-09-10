# Fix: ElevenLabs phnum órfão travando discagem

## Problema

O número `+18159498468` tem `elevenlabs_phone_number_id = phnum_5801kq5t6vgxfjtbj4kpf7kt3z3v` salvo no banco, mas o ElevenLabs responde **404 document_not_found** — o número foi removido do workspace EL (ou a API key trocou). Toda discagem via essa rota cai em 502.

## Solução (2 partes, faço as duas)

### 1. Migration: limpar o ID órfão agora

```sql
UPDATE phone_numbers
SET elevenlabs_phone_number_id = NULL
WHERE elevenlabs_phone_number_id = 'phnum_5801kq5t6vgxfjtbj4kpf7kt3z3v';
```

Depois disso, a discagem cai automaticamente na rota Twilio direta (`voice-outbound`) porque `placeCall()` em `src/lib/voice.ts` decide a rota com base nesse campo.

### 2. Self-healing em `elevenlabs-outbound-call/index.ts`

Quando o EL devolver `404` com `code: "document_not_found"`:
- Limpa o `elevenlabs_phone_number_id` no banco (pra não travar a próxima ligação).
- Faz fallback automático pra `voice-outbound` (Twilio direto), que já existe e é chamado em outros caminhos de erro 5xx.
- Retorna `via: "twilio_fallback"` com `reason: "elevenlabs_phone_not_registered"` pra UI mostrar toast claro.

## Reativar a IA do EL depois

Quando quiser voltar a usar a integração nativa do EL nesse número, vai em **/phone-numbers** → botão **"Ativar IA do ElevenLabs"** — ele chama `elevenlabs-phone-register` que registra novo `phnum_...` e salva no banco.

## Arquivos tocados

- **migration nova** — UPDATE do phone_numbers
- **`supabase/functions/elevenlabs-outbound-call/index.ts`** — detectar 404 document_not_found, limpar ID, fallback Twilio

Sem mudanças em UI nem em outros lugares.
