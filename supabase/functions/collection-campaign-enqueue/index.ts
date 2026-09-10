// deno-lint-ignore-file no-explicit-any
//
// Enfileira dívidas em uma voice_campaign já existente (status draft/running),
// gerando voice_campaign_contacts com as variáveis de cobrança preenchidas.
//
// Body: { campaign_id: uuid, filter?: { status?, min_valor?, max_dias_atraso? },
//         debt_ids?: uuid[], priority?: 'valor_desc'|'atraso_desc'|'vencimento_asc' }
//
// Retorno: { enqueued: number, skipped: { dnc, duplicate, missing_phone } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: {
    campaign_id: string;
    filter?: { status?: string; min_valor?: number; max_dias_atraso?: number };
    debt_ids?: string[];
    priority?: "valor_desc" | "atraso_desc" | "vencimento_asc";
  };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  if (!body.campaign_id) return j({ error: "campaign_id required" }, 400);

  // Valida campanha e pega config
  const { data: campaign } = await admin
    .from("voice_campaigns")
    .select("id, account_id, status, collection_config, name")
    .eq("id", body.campaign_id)
    .maybeSingle();
  if (!campaign) return j({ error: "campaign not found" }, 404);

  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", campaign.account_id)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  if (!["draft", "running", "paused"].includes(campaign.status)) {
    return j(
      { error: `campaign status inválido para enfileiramento: ${campaign.status}` },
      409,
    );
  }

  // Pega settings da empresa (janela, descontos, agente default)
  const { data: settings } = await admin
    .from("company_settings")
    .select(
      "company_name, default_discount_pct, default_max_installments, default_agent_id, support_phone",
    )
    .eq("account_id", campaign.account_id)
    .maybeSingle();

  const collConf = (campaign.collection_config as any) ?? {};
  const discountPct =
    collConf.discount_pct ?? settings?.default_discount_pct ?? 10;
  const maxInstallments =
    collConf.max_installments ?? settings?.default_max_installments ?? 6;
  const minInstallmentValue = Number(collConf.min_installment_value ?? 50);
  const firstDueMinDays = Number(collConf.first_due_min_days ?? 3);
  const firstDueMaxDays = Number(collConf.first_due_max_days ?? 10);
  const minParcelaFormatado = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(minInstallmentValue);

  // Monta query de dívidas
  let query = admin
    .from("debts")
    .select(
      `id, account_id, contact_id, valor_atual, vencimento, origem, descricao,
       status, attempts_count,
       contact:contacts(id, name, phone_number, email),
       debtor_profile:debtor_profiles(doc_number)`,
    )
    .eq("account_id", campaign.account_id);

  if (body.debt_ids && body.debt_ids.length > 0) {
    query = query.in("id", body.debt_ids);
  } else {
    const filter = body.filter ?? {};
    query = query.in("status", ["aberto", "em_negociacao"]);
    if (filter.status) query = query.eq("status", filter.status);
    if (filter.min_valor != null) query = query.gte("valor_atual", filter.min_valor);
    if (filter.max_dias_atraso != null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - filter.max_dias_atraso);
      query = query.gte("vencimento", cutoff.toISOString().slice(0, 10));
    }
  }

  const priority = body.priority ?? collConf.priority_by ?? "valor_desc";
  if (priority === "valor_desc") query = query.order("valor_atual", { ascending: false });
  else if (priority === "atraso_desc") query = query.order("vencimento", { ascending: true });
  else query = query.order("vencimento", { ascending: true });

  query = query.limit(5000);

  const { data: debts, error } = await query;
  if (error) return j({ error: error.message }, 500);
  if (!debts || debts.length === 0) return j({ enqueued: 0, skipped: {}, reason: "sem dívidas" });

  // Pré-carrega DNC e contatos já enfileirados nesta campanha
  const { data: dncRows } = await admin
    .from("dnc_list")
    .select("phone_e164")
    .eq("account_id", campaign.account_id);
  const dncSet = new Set<string>((dncRows ?? []).map((r: any) => r.phone_e164));

  const { data: existing } = await admin
    .from("voice_campaign_contacts")
    .select("contact_id")
    .eq("campaign_id", campaign.id);
  const alreadyEnqueued = new Set<string>(
    (existing ?? []).map((r: any) => r.contact_id),
  );

  const today = new Date();
  let enqueued = 0;
  let skipDnc = 0;
  let skipDup = 0;
  let skipNoPhone = 0;

  const rowsToInsert: any[] = [];

  for (const d of debts as any[]) {
    const contact = d.contact;
    if (!contact?.phone_number) { skipNoPhone++; continue; }
    if (dncSet.has(contact.phone_number)) { skipDnc++; continue; }
    if (alreadyEnqueued.has(contact.id)) { skipDup++; continue; }

    const profile = Array.isArray(d.debtor_profile) ? d.debtor_profile[0] : d.debtor_profile;
    const docLast4 = profile?.doc_number ? profile.doc_number.slice(-4) : "----";

    const vencimento = new Date(d.vencimento);
    const diasAtraso = Math.max(
      0,
      Math.floor((today.getTime() - vencimento.getTime()) / (1000 * 60 * 60 * 24)),
    );

    const valor = Number(d.valor_atual);
    const valorFormatado = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(valor);
    const vencimentoBr = vencimento.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });

    const firstName = (contact.name ?? "").split(" ")[0] || "cliente";

    const variables = {
      company_name: settings?.company_name ?? "sua empresa",
      agent_name: "Nina", // pode ser sobrescrito pela persona
      debtor_name: firstName,
      debtor_doc_last4: docLast4,
      valor_formatado: valorFormatado,
      vencimento_br: vencimentoBr,
      dias_atraso: String(diasAtraso),
      origem_debito: d.origem ?? "débito",
      descricao: d.descricao ?? "",
      desconto_pct: String(discountPct),
      max_parcelas: String(maxInstallments),
      valor_min_parcela_formatado: minParcelaFormatado,
      first_due_min_days: String(firstDueMinDays),
      first_due_max_days: String(firstDueMaxDays),
      support_phone: settings?.support_phone ?? "",
      debt_id: d.id,
    };

    rowsToInsert.push({
      campaign_id: campaign.id,
      account_id: campaign.account_id,
      contact_id: contact.id,
      phone_number: contact.phone_number,
      variables,
      status: "queued",
      dispatch_after: new Date().toISOString(),
    });

    alreadyEnqueued.add(contact.id);
  }

  if (rowsToInsert.length === 0) {
    return j({
      enqueued: 0,
      skipped: { dnc: skipDnc, duplicate: skipDup, missing_phone: skipNoPhone },
    });
  }

  // Insert em lotes de 500 pra não estourar payload
  const BATCH = 500;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const slice = rowsToInsert.slice(i, i + BATCH);
    const { error: insErr } = await admin
      .from("voice_campaign_contacts")
      .insert(slice);
    if (insErr) return j({ error: insErr.message, enqueued }, 500);
    enqueued += slice.length;
  }

  // Atualiza contact_count da campanha
  await admin
    .from("voice_campaigns")
    .update({ contact_count: enqueued })
    .eq("id", campaign.id);

  return j({
    enqueued,
    skipped: { dnc: skipDnc, duplicate: skipDup, missing_phone: skipNoPhone },
    total_debts: debts.length,
  });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
