# Remix of Agente de cobrança 

## CONTEXTO GERAL DO PRODUTO

**Nexus** é uma plataforma omnichannel de atendimento com IA que clona o estilo e a voz de agentes humanos reais, responde automaticamente em WhatsApp/Instagram/Web Chat/Voz, mantém memória persistente de cada cliente, e se auto-melhora com base em resultados reais do negócio (não CSAT).

**Diferencial**: não é "Chatwoot + IA". É um call center autônomo onde 1 agente humano escala pra 10.000 atendimentos idênticos, com:
- Voice clone do melhor agente respondendo em voz natural
- Customer Memory Graph: cada conversa/call/fato sobre o cliente vira memória permanente
- Self-improvement loop: resultados reais → geração de prompt variants → eval sintético → promoção automática
- Time Machine: edita mensagem da IA retroativamente e simula o que teria acontecido
- War Room: supervisor puxa o microfone de uma conversa da IA sem o cliente perceber (mesma voz)
- Sinais sub-textuais: pausa longa, mudança de sentimento, caps lock detectados em tempo real

**Stack obrigatório**:
- Frontend: React 19 + Vite + Tailwind v4 + wouter routing + @tanstack/react-query
- Backend: Express 5 + TypeScript + Drizzle ORM + PostgreSQL com pgvector
- LLM: Anthropic Claude (Opus 4.5 para raciocínio, Haiku 4.5 para tarefas rápidas)
- Embeddings: OpenAI text-embedding-3-small (1536 dims)
- Voz: Deepgram STT + ElevenLabs TTS + Twilio Media Streams
- Canais: Meta Cloud API (WhatsApp/Instagram), SDK JS customizado (Web Widget)
- Monorepo pnpm workspace
- Idioma: tudo em Português Brasileiro (PT-BR)
- Tema: dark premium com identidade violet/fuchsia, NUNCA light mode

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://nexus-ai-voice-memories.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8dfe8a99-797f-4664-8595-b57321b059c6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
