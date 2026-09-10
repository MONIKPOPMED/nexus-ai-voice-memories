// deno-lint-ignore-file no-explicit-any
//
// Cria uma cobrança no Asaas para um payment_arrangement, persiste asaas_charge_id
// e asaas_payment_url na linha. Usado pelo proposal-dispatch.
//
// Body: { arrangement_id: uuid }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
      "id, account_id, debt_id, contact_id, valor_negociado, metodo, num_parcelas, primeiro_vencimento, asaas_charge_id",
      )
    .eq("id", body.arrangement_id)
    .maybeSingle();
  if (!arr) return j({ error: "arrangement not found" }, 404);

  if (arr.asaas_charge_id) {
    return j({ ok: true, already_created: true, charge_id: arr.asaas_charge_id });
  }

  const asaasKey = Deno.env.get("ASAAS_API_KEY");
  const asaasUrl = Deno.env.get("ASAAS_API_URL") ?? "https://api.asaas.com/v3";
  if (!asaasKey) return j({ error: "ASAAS_API_KEY not configured" }, 500);

  // Pega dados do devedor
  const { data: contact } = await admin
    .from("contacts")
    .select("name, email, phone_number")
    .eq("id", arr.contact_id)
    .maybeSingle();
  if (!contact) return j({ error: "contact not found" }, 404);

  const { data: profile } = await admin
    .from("debtor_profiles")
    .select("doc_type, doc_number")
    .eq("contact_id", arr.contact_id)
    .maybeSingle();

  // Cria (ou acha) customer no Asaas
  let customerId: string | null = null;
  if (profile?.doc_number) {
    // GET /customers?cpfCnpj=...
    const searchRes = await fetch(
      `${asaasUrl}/customers?cpfCnpj=${encodeURIComponent(profile.doc_number)}&limit=1`,
      { headers: { access_token: asaasKey } },
    );
    const searchData = await searchRes.json().catch(() => ({}));
    if (searchData?.data?.[0]?.id) {
      customerId = searchData.data[0].id;
    }
  }

  if (!customerId) {
    const createRes = await fetch(`${asaasUrl}/customers`, {
      method: "POST",
      headers: { access_token: asaasKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: contact.name ?? "Devedor",
        cpfCnpj: profile?.doc_number,
        email: contact.email,
        phone: contact.phone_number?.replace(/\D/g, "").slice(-11),
      }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createData?.id) {
      return j(
        { error: `Asaas customer create failed: ${JSON.stringify(createData).slice(0, 300)}` },
        502,
      );
    }
    customerId = createData.id;
  }

  // Cria a cobrança. Se parcelada, usa /installments para gerar carnê.
  const billingType = arr.metodo === "boleto"
    ? "BOLETO"
    : arr.metodo === "cartao"
    ? "CREDIT_CARD"
    : "PIX";

  let chargeId: string | null = null;
  let paymentUrl: string | null = null;

  if (arr.num_parcelas > 1) {
    const parcelaValor = Number((arr.valor_negociado / arr.num_parcelas).toFixed(2));
    const instRes = await fetch(`${asaasUrl}/installments`, {
      method: "POST",
      headers: { access_token: asaasKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customerId,
        billingType,
        installmentCount: arr.num_parcelas,
        installmentValue: parcelaValor,
        dueDate: arr.primeiro_vencimento,
        description: `Acordo de pagamento (arr=${arr.id.slice(0, 8)})`,
        externalReference: arr.id,
      }),
    });
    const instData = await instRes.json().catch(() => ({}));
    if (!instRes.ok || !instData?.id) {
      return j(
        { error: `Asaas installment failed: ${JSON.stringify(instData).slice(0, 300)}` },
        502,
      );
    }
    chargeId = instData.id;
    paymentUrl = instData.paymentLink ?? instData.invoiceUrl ?? null;
  } else {
    const payRes = await fetch(`${asaasUrl}/payments`, {
      method: "POST",
      headers: { access_token: asaasKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        customer: customerId,
        billingType,
        value: Number(arr.valor_negociado),
        dueDate: arr.primeiro_vencimento,
        description: `Acordo de pagamento (arr=${arr.id.slice(0, 8)})`,
        externalReference: arr.id,
      }),
    });
    const payData = await payRes.json().catch(() => ({}));
    if (!payRes.ok || !payData?.id) {
      return j(
        { error: `Asaas payment failed: ${JSON.stringify(payData).slice(0, 300)}` },
        502,
      );
    }
    chargeId = payData.id;
    paymentUrl = payData.invoiceUrl ?? null;
  }

  await admin
    .from("payment_arrangements")
    .update({
      asaas_charge_id: chargeId,
      asaas_payment_url: paymentUrl,
    })
    .eq("id", arr.id);

  return j({ ok: true, charge_id: chargeId, payment_url: paymentUrl });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
