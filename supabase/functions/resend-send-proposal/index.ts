// deno-lint-ignore-file no-explicit-any
//
// Envia a proposta de pagamento por e-mail via Resend para um
// payment_arrangement. Escreve resultado em proposal_deliveries.
//
// Body: { arrangement_id: uuid }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlTemplate(args: {
  debtorName: string;
  companyName: string;
  valor: number;
  numParcelas: number;
  paymentUrl: string;
  primeiroVencimento: string;
  supportPhone?: string | null;
  legalFooter?: string | null;
}): string {
  const valorFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(args.valor);
  const vencFmt = new Date(args.primeiroVencimento).toLocaleDateString("pt-BR");
  const parcelaLine = args.numParcelas > 1
    ? `${valorFmt} em ${args.numParcelas}x`
    : `${valorFmt} à vista`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Sua proposta de pagamento</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#111;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f4f4f6; padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="max-width:560px; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <h1 style="margin:0; font-size:18px; font-weight:600; color:#111;">Olá, ${escapeHtml(args.debtorName)}</h1>
              <p style="margin:12px 0 0 0; font-size:14px; color:#555; line-height:1.5;">
                Aqui é a equipe da <strong>${escapeHtml(args.companyName)}</strong>. Conforme conversamos no telefone, segue a proposta de pagamento.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 8px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f9fafb; border-radius:8px; padding:16px;">
                <tr>
                  <td style="padding:8px 0; font-size:13px; color:#555;">Valor</td>
                  <td align="right" style="padding:8px 0; font-size:15px; font-weight:600; color:#111;">${escapeHtml(parcelaLine)}</td>
                </tr>
                <tr>
                  <td style="padding:8px 0; font-size:13px; color:#555;">Vencimento</td>
                  <td align="right" style="padding:8px 0; font-size:15px; font-weight:600; color:#111;">${escapeHtml(vencFmt)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 28px;">
              <a href="${escapeAttr(args.paymentUrl)}" style="display:inline-block; padding:14px 28px; background:#7c3aed; color:#fff; font-weight:600; font-size:15px; text-decoration:none; border-radius:8px;">Acessar link de pagamento</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px 28px;">
              <p style="margin:0; font-size:12px; color:#888; line-height:1.5;">
                Este link é oficial e pessoal. Se não reconhecer esta cobrança${args.supportPhone ? `, entre em contato pelo telefone ${escapeHtml(args.supportPhone)}` : ""}.
              </p>
              ${args.legalFooter ? `<p style="margin:12px 0 0 0; font-size:11px; color:#aaa; line-height:1.5;">${escapeHtml(args.legalFooter)}</p>` : ""}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]!));
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "%22");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { arrangement_id: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.arrangement_id) return j({ error: "arrangement_id required" }, 400);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") ?? "cobranca@example.com";
  if (!resendKey) return j({ error: "RESEND_API_KEY not configured" }, 500);

  const { data: arr } = await admin
    .from("payment_arrangements")
    .select(
      `id, account_id, contact_id, valor_negociado, num_parcelas,
       primeiro_vencimento, asaas_payment_url`,
    )
    .eq("id", body.arrangement_id)
    .maybeSingle();
  if (!arr) return j({ error: "arrangement not found" }, 404);
  if (!arr.asaas_payment_url) {
    return j({ error: "arrangement sem payment_url — gere o charge Asaas primeiro" }, 409);
  }

  const { data: contact } = await admin
    .from("contacts")
    .select("name, email")
    .eq("id", arr.contact_id)
    .maybeSingle();
  if (!contact?.email) return j({ error: "contact sem e-mail" }, 409);

  const { data: settings } = await admin
    .from("company_settings")
    .select("company_name, support_phone, legal_footer")
    .eq("account_id", arr.account_id)
    .maybeSingle();

  const companyName = settings?.company_name ?? "sua empresa";
  const html = htmlTemplate({
    debtorName: (contact.name ?? "").split(" ")[0] || "cliente",
    companyName,
    valor: Number(arr.valor_negociado),
    numParcelas: arr.num_parcelas,
    paymentUrl: arr.asaas_payment_url,
    primeiroVencimento: arr.primeiro_vencimento,
    supportPhone: settings?.support_phone,
    legalFooter: settings?.legal_footer,
  });

  const subject = `${companyName} — proposta de pagamento`;

  const { data: delivery } = await admin
    .from("proposal_deliveries")
    .insert({
      account_id: arr.account_id,
      arrangement_id: arr.id,
      channel: "email",
      recipient: contact.email,
      status: "pendente",
      payload_preview: subject,
    })
    .select("id")
    .single();

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [contact.email],
        subject,
        html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    }

    await admin
      .from("proposal_deliveries")
      .update({
        status: "enviado",
        sent_at: new Date().toISOString(),
        provider_msg_id: data?.id ?? null,
      })
      .eq("id", delivery!.id);

    return j({ ok: true, delivery_id: delivery!.id, message_id: data?.id });
  } catch (e: any) {
    await admin
      .from("proposal_deliveries")
      .update({
        status: "falhou",
        failed_at: new Date().toISOString(),
        error_message: String(e?.message ?? e).slice(0, 500),
      })
      .eq("id", delivery!.id);
    return j({ error: String(e?.message ?? e) }, 502);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
