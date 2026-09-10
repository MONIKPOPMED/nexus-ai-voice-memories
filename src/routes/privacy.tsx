import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — cobrAI" },
      {
        name: "description",
        content:
          "Como o cobrAI coleta, processa e protege dados pessoais no contexto de cobrança por voz.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade" updatedAt="2026-04-24">
      <p>
        O cobrAI é uma plataforma de cobrança automatizada por voz que permite à
        empresa credora (nossa cliente) realizar chamadas telefônicas para seus
        devedores, negociar acordos e enviar propostas de pagamento. Esta política
        descreve quais dados pessoais tratamos, para quais finalidades, com quem
        compartilhamos e quais são os direitos do titular, em conformidade com a
        Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
      </p>

      <H2>1. Dados que tratamos</H2>
      <p>
        <strong>Do titular devedor:</strong> nome, CPF ou CNPJ, telefone,
        e-mail, valor da dívida, data de vencimento, histórico de tentativas de
        contato, gravações das chamadas, transcrição das conversas, resultado da
        ligação (contato com devedor, acordo, recusa, etc.) e dados de pagamento
        resultantes (valor negociado, método, parcelas).
      </p>
      <p>
        <strong>De usuários operadores:</strong> nome, e-mail, papel de acesso.
      </p>

      <H2>2. Base legal</H2>
      <ul>
        <li>
          <strong>Execução de contrato / legítimo interesse da credora</strong>{" "}
          (art. 7º, V e IX, LGPD): para a atividade legítima de cobrança de dívida
          existente entre a credora e o titular devedor.
        </li>
        <li>
          <strong>Cumprimento de obrigação legal</strong> (art. 7º, II): para
          retenção mínima de registros de comunicação e consentimento de gravação.
        </li>
        <li>
          <strong>Consentimento</strong> (art. 7º, I): para envio de propostas por
          e-mail e WhatsApp além da chamada inicial.
        </li>
      </ul>

      <H2>3. Finalidades</H2>
      <ul>
        <li>
          Efetuar chamadas telefônicas com agente de IA para informar o débito e
          negociar acordo.
        </li>
        <li>
          Enviar a proposta de pagamento por WhatsApp e/ou e-mail após negociação.
        </li>
        <li>
          Gerar cobranças (PIX, boleto, cartão) via gateway de pagamento.
        </li>
        <li>
          Registrar e auditar o histórico de tentativas de contato e resultados.
        </li>
      </ul>

      <H2>4. Gravação de chamadas</H2>
      <p>
        Toda ligação efetuada pelo cobrAI inicia com aviso verbal de que pode ser
        gravada. A gravação e sua transcrição são utilizadas para fins de auditoria
        da negociação, treinamento do agente e resolução de disputas. Gravações são
        retidas pelo prazo configurado pela credora (padrão: 90 dias) e excluídas
        automaticamente após esse período.
      </p>

      <H2>5. Direito de oposição (DNC)</H2>
      <p>
        A qualquer momento o titular pode solicitar a remoção do seu número da
        lista de contato dizendo frases como "não me ligue mais", "remova meu
        número" ou "tira minha lista". Ao detectar o pedido, a plataforma inclui
        automaticamente o número na DNC (Do Not Call) da credora e cancela todas
        as tentativas pendentes. O bloqueio é imediato e permanente até revogação
        expressa do próprio titular.
      </p>

      <H2>6. Janela legal de contato</H2>
      <p>
        O cobrAI respeita, por padrão, janela de contato aceita no mercado brasileiro:
        segunda a sexta das 8h às 20h e sábado das 8h às 14h, não ligando em
        domingos nem feriados nacionais. A janela pode ser ajustada pela credora
        dentro de parâmetros legítimos, porém nunca fora dos horários estabelecidos
        pelo Código de Defesa do Consumidor (art. 42) e pela ANATEL.
      </p>

      <H2>7. Compartilhamento</H2>
      <p>
        Os dados pessoais podem ser compartilhados com os seguintes operadores:
      </p>
      <ul>
        <li>
          <strong>Provedores de voz:</strong> Twilio (telefonia) e ElevenLabs
          (síntese de voz + agente conversacional).
        </li>
        <li>
          <strong>Provedor de WhatsApp:</strong> Evolution API (instância da credora).
        </li>
        <li>
          <strong>Provedor de e-mail:</strong> Resend (envio de propostas).
        </li>
        <li>
          <strong>Gateway de pagamento:</strong> Asaas (emissão de cobranças PIX/boleto).
        </li>
        <li>
          <strong>Infra:</strong> Supabase (banco de dados) e Cloudflare (borda).
        </li>
      </ul>

      <H2>8. Direitos do titular</H2>
      <p>
        O titular pode solicitar confirmação, acesso, correção, portabilidade,
        eliminação e informação sobre compartilhamento dos seus dados, entrando em
        contato pelo e-mail informado pela credora ou por nossa página de{" "}
        <Link to="/data-deletion" className="underline">exclusão de dados</Link>.
      </p>

      <H2>9. Segurança</H2>
      <p>
        Aplicamos controles de segurança alinhados a boas práticas: criptografia
        em trânsito (TLS) e em repouso, isolamento por RLS no banco de dados,
        acesso mediante autenticação e registro de auditoria.
      </p>

      <H2>10. Contato do encarregado</H2>
      <p>
        Para dúvidas sobre esta política ou exercício de direitos, o encarregado
        pode ser contatado pelo e-mail cadastrado pela credora em Configurações →
        Geral → E-mail de suporte.
      </p>
    </LegalLayout>
  );
}

export function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            cobrAI
          </Link>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/data-deletion" className="hover:text-foreground">
              Exclusão de dados
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Última atualização: {new Date(updatedAt).toLocaleDateString("pt-BR")}
        </p>
        <div className="prose prose-invert mt-8 max-w-none space-y-4 text-sm leading-relaxed text-foreground/90">
          {children}
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} cobrAI — Agente de cobrança por voz
        </div>
      </footer>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-semibold text-foreground">{children}</h2>
  );
}
