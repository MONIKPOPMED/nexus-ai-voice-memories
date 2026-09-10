// deno-lint-ignore-file no-explicit-any
//
// Envia a proposta de pagamento por WhatsApp via Evolution API para um
// payment_arrangement. Escreve resultado em proposal_deliveries.
//
// Body: { arrangement_id: uuid }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { sendText } from "../_shared/evolution/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function buildMessage(args: {
  debtorName: string;
  companyName: string;
  valor: number;
  numParcelas: number;
  paymentUrl: string;
  primeiroVencimento: string;
}): string {
  const valorFmt = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(args.valor);
  const vencFmt = new Date(args.primeiroVencimento).toLocaleDateString("pt-BR");
  const parcelas = args.numParcelas > 1 ? `em ${args.numParcelas}x` : "à vista";

  return (
    `Olá, ${args.debtorName}! Aqui é a *${args.companyName}*.\n\n` +
    `Conforme conversamos, segue o link do seu acordo:\n\n` +
    `💰 Valor: *${valorFmt}* ${parcelas}\n` +
    `📅 Vencimento: *${vencFmt}*\n\n` +
    `🔗 ${args.paymentUrl}\n\n` +
    `O link é oficial e pessoal. Se preferir, posso reenviar por e-mail.\n\n` +
    `Qualquer dúvida, respondê esta mensagem.`
  );
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
    .select("name, phone_number")
    .eq("id", arr.contact_id)
    .maybeSingle();
  if (!contact?.phone_number) return j({ error: "contact sem telefone" }, 409);

  const { data: settings } = await admin
    .from("company_settings")
    .select("company_name")
    .eq("account_id", arr.account_id)
    .maybeSingle();

  // Canal WA ativo para o account
  const { data: channel } = await admin
    .from("channels")
    .select("config")
    .eq("account_id", arr.account_id)
    .eq("channel_type", "whatsapp")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  const cfg = (channel?.config as any) ?? {};
  if (!cfg.evolution_url || !cfg.evolution_api_key || !cfg.evolution_instance_name) {
    return persistFail(admin, arr, contact.phone_number, "Canal WhatsApp não configurado");
  }

  const message = buildMessage({
    debtorName: (contact.name ?? "").split(" ")[0] || "cliente",
    companyName: settings?.company_name ?? "sua empresa",
    valor: Number(arr.valor_negociado),
    numParcelas: arr.num_parcelas,
    paymentUrl: arr.asaas_payment_url,
    primeiroVencimento: arr.primeiro_vencimento,
  });

  // Registra delivery pendente
  const { data: delivery } = await admin
    .from("proposal_deliveries")
    .insert({
      account_id: arr.account_id,
      arrangement_id: arr.id,
      channel: "whatsapp",
      recipient: contact.phone_number,
      status: "pendente",
      payload_preview: message.slice(0, 500),
    })
    .select("id")
    .single();

  try {
    const res = await sendText({
      url: cfg.evolution_url,
      apiKey: cfg.evolution_api_key,
      instanceName: cfg.evolution_instance_name,
      number: contact.phone_number,
      text: message,
    });
    await admin
      .from("proposal_deliveries")
      .update({
        status: "enviado",
        sent_at: new Date().toISOString(),
        provider_msg_id: res.messageId ?? null,
      })
      .eq("id", delivery!.id);

    return j({ ok: true, delivery_id: delivery!.id, messageId: res.messageId });
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

async function persistFail(admin: any, arr: any, recipient: string, msg: string) {
  await admin.from("proposal_deliveries").insert({
    account_id: arr.account_id,
    arrangement_id: arr.id,
    channel: "whatsapp",
    recipient,
    status: "falhou",
    failed_at: new Date().toISOString(),
    error_message: msg,
  });
  return j({ error: msg }, 409);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
