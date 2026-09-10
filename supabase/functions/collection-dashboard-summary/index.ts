// deno-lint-ignore-file no-explicit-any
//
// KPIs consolidados pro dashboard de cobrança. (touch: redeploy)
//
// Retorno:
//   { today, yesterday, trends, carteira,
//     outcomes_7d, top_motivos_nao_contato,
//     active_campaigns, pending_arrangements, recent_activity,
//     integrations_status }

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return j({ error: "method not allowed" }, 405);

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

  const { data: au } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .limit(1)
    .maybeSingle();
  if (!au?.account_id) return j({ error: "no account" }, 403);

  const accountId = au.account_id;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const yesterdayStart = new Date(now.getTime() - 86400_000);
  yesterdayStart.setHours(0, 0, 0, 0);
  const yesterdayStartIso = yesterdayStart.toISOString();
  const yesterdayEndIso = new Date(yesterdayStart.getTime() + 86400_000).toISOString();
  const sevenAgo = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const todayYMD = now.toISOString().slice(0, 10);
  const sevenDaysYMD = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);

  // Status que representam um acordo "fechado" (não cancelado)
  const ACORDO_STATUS = ["pendente_aprovacao", "pendente", "pago", "atrasado"];

  const [
    callsToday, cpcToday, acordosToday, paidToday,
    callsYesterday, cpcYesterday, acordosYesterday, paidYesterday,
    acordosMonth, paidMonth,
    outcomes7d, motivos, carteira, carteiraEmNeg,
    activeCampaigns, pendingArr, pendingApproval, recentCalls, recentPaid, recentArrangements,
    integrations,
  ] = await Promise.all([
    // TODAY
    admin.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).gte("started_at", todayStart),
    admin.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("collection_outcome", "cpc").gte("started_at", todayStart),
    // Acordos do dia agora vêm de payment_arrangements (qualquer status != cancelado)
    admin.from("payment_arrangements").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("status", ACORDO_STATUS).gte("created_at", todayStart),
    admin.from("payment_arrangements").select("valor_negociado")
      .eq("account_id", accountId).eq("status", "pago").gte("paid_at", todayStart),

    // YESTERDAY (same hour window)
    admin.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).gte("started_at", yesterdayStartIso).lt("started_at", yesterdayEndIso),
    admin.from("voice_calls").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("collection_outcome", "cpc").gte("started_at", yesterdayStartIso).lt("started_at", yesterdayEndIso),
    admin.from("payment_arrangements").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).in("status", ACORDO_STATUS).gte("created_at", yesterdayStartIso).lt("created_at", yesterdayEndIso),
    admin.from("payment_arrangements").select("valor_negociado")
      .eq("account_id", accountId).eq("status", "pago").gte("paid_at", yesterdayStartIso).lt("paid_at", yesterdayEndIso),

    // MONTH (acordos = todos com status != cancelado, criados no mês)
    admin.from("payment_arrangements").select("id, valor_negociado", { count: "exact" })
      .eq("account_id", accountId).in("status", ACORDO_STATUS).gte("created_at", monthStart),
    admin.from("payment_arrangements").select("valor_negociado")
      .eq("account_id", accountId).eq("status", "pago").gte("paid_at", monthStart),

    // 7D outcomes + top motivos
    admin.from("voice_calls").select("started_at, collection_outcome")
      .eq("account_id", accountId).not("collection_outcome", "is", null).gte("started_at", sevenAgo),
    admin.from("voice_calls").select("collection_outcome")
      .eq("account_id", accountId)
      .in("collection_outcome", ["nao_atende","caixa_postal","numero_errado","recusa","dnc_solicitado"])
      .gte("started_at", sevenAgo),

    // CARTEIRA
    admin.from("debts").select("valor_atual")
      .eq("account_id", accountId).eq("status", "aberto"),
    admin.from("debts").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("status", "em_negociacao"),

    // ACTIVE CAMPAIGNS
    admin.from("voice_campaigns")
      .select("id, name, status, contact_count, placed_count, connected_count, escalated_count, failed_count, started_at")
      .eq("account_id", accountId).in("status", ["running", "scheduled", "paused"])
      .order("started_at", { ascending: false, nullsFirst: false }).limit(5),

    // PENDING ARRANGEMENTS (próximos 7 dias) — pendente OU pendente_aprovacao
    admin.from("payment_arrangements")
      .select("id, status, valor_negociado, primeiro_vencimento, num_parcelas, contact_id, source")
      .eq("account_id", accountId).in("status", ["pendente", "pendente_aprovacao"])
      .gte("primeiro_vencimento", todayYMD).lte("primeiro_vencimento", sevenDaysYMD)
      .order("primeiro_vencimento", { ascending: true }).limit(20),

    // PENDING APPROVAL (todos esperando aprovação humana)
    admin.from("payment_arrangements")
      .select("id, valor_negociado, primeiro_vencimento, num_parcelas, contact_id, source, created_at, voice_call_id")
      .eq("account_id", accountId).eq("status", "pendente_aprovacao")
      .order("created_at", { ascending: false }).limit(20),

    // RECENT CALLS (com contact)
    admin.from("voice_calls")
      .select("id, started_at, collection_outcome, to_number, metadata")
      .eq("account_id", accountId).not("collection_outcome", "is", null)
      .order("started_at", { ascending: false }).limit(12),

    // RECENT PAID
    admin.from("payment_arrangements")
      .select("id, valor_negociado, paid_at, contact_id")
      .eq("account_id", accountId).eq("status", "pago")
      .order("paid_at", { ascending: false }).limit(6),

    // RECENT ARRANGEMENTS (qualquer acordo recém-criado, pra activity feed)
    admin.from("payment_arrangements")
      .select("id, status, valor_negociado, num_parcelas, created_at, contact_id, source")
      .eq("account_id", accountId).in("status", ACORDO_STATUS)
      .order("created_at", { ascending: false }).limit(8),

    // INTEGRATIONS STATUS (check keys/channels)
    checkIntegrations(admin, accountId),
  ]);

  const valorRecuperadoHoje = sumNegociado(paidToday.data);
  const valorRecuperadoOntem = sumNegociado(paidYesterday.data);
  const valorRecuperadoMes = sumNegociado(paidMonth.data);
  const valorCarteira = sumNum((carteira.data ?? []).map((r: any) => r.valor_atual));

  const totalCallsToday = callsToday.count ?? 0;
  const cpcCountToday = cpcToday.count ?? 0;
  const taxaContatoToday = totalCallsToday > 0
    ? Math.round((cpcCountToday / totalCallsToday) * 100) : 0;

  const totalCallsYesterday = callsYesterday.count ?? 0;
  const cpcCountYesterday = cpcYesterday.count ?? 0;
  const taxaContatoYesterday = totalCallsYesterday > 0
    ? Math.round((cpcCountYesterday / totalCallsYesterday) * 100) : 0;

  const acordosMonthCount = acordosMonth.count ?? 0;
  const ticketMedio = acordosMonthCount > 0
    ? (acordosMonth.data ?? []).reduce((s: number, r: any) => s + Number(r.valor_negociado || 0), 0) / acordosMonthCount
    : 0;

  // Resolve contact names for recent activity & pending arrangements
  const contactIds = new Set<string>();
  for (const r of (pendingArr.data ?? []) as any[]) if (r.contact_id) contactIds.add(r.contact_id);
  for (const r of (pendingApproval.data ?? []) as any[]) if (r.contact_id) contactIds.add(r.contact_id);
  for (const r of (recentPaid.data ?? []) as any[]) if (r.contact_id) contactIds.add(r.contact_id);
  for (const r of (recentArrangements.data ?? []) as any[]) if (r.contact_id) contactIds.add(r.contact_id);

  let contactsMap = new Map<string, { name: string | null; phone: string | null }>();
  if (contactIds.size > 0) {
    const { data: cs } = await admin
      .from("contacts")
      .select("id, name, phone_number")
      .in("id", Array.from(contactIds));
    contactsMap = new Map(
      (cs ?? []).map((c: any) => [c.id, { name: c.name, phone: c.phone_number }]),
    );
  }

  // Recent activity — mistura chamadas, pagamentos e acordos novos, ordena por timestamp
  type ActivityItem = {
    kind: "call" | "payment" | "arrangement";
    at: string;
    label: string;
    subtitle: string;
    value?: number;
    outcome?: string;
  };
  const activity: ActivityItem[] = [];
  for (const c of (recentCalls.data ?? []) as any[]) {
    const meta = (c.metadata as any) ?? {};
    const name = meta?.variables?.debtor_name ?? c.to_number ?? "—";
    activity.push({
      kind: "call",
      at: c.started_at,
      label: outcomeLabel(c.collection_outcome),
      subtitle: String(name),
      outcome: c.collection_outcome,
    });
  }
  for (const p of (recentPaid.data ?? []) as any[]) {
    const contact = contactsMap.get(p.contact_id);
    activity.push({
      kind: "payment",
      at: p.paid_at ?? "",
      label: "Pagamento recebido",
      subtitle: contact?.name ?? contact?.phone ?? "—",
      value: Number(p.valor_negociado ?? 0),
    });
  }
  for (const a of (recentArrangements.data ?? []) as any[]) {
    const contact = contactsMap.get(a.contact_id);
    const isPending = a.status === "pendente_aprovacao";
    activity.push({
      kind: "arrangement",
      at: a.created_at ?? "",
      label: isPending ? "Acordo registrado · aguardando aprovação" : "Acordo registrado",
      subtitle: contact?.name ?? contact?.phone ?? "—",
      value: Number(a.valor_negociado ?? 0),
      outcome: a.status,
    });
  }
  activity.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const recent_activity = activity.slice(0, 12);

  // Pending arrangements enriched (próximos 7 dias)
  const pending_arrangements = ((pendingArr.data ?? []) as any[]).map((r) => {
    const c = contactsMap.get(r.contact_id);
    return {
      id: r.id,
      contact_name: c?.name ?? "—",
      valor: Number(r.valor_negociado),
      primeiro_vencimento: r.primeiro_vencimento,
      num_parcelas: r.num_parcelas,
      status: r.status as "pendente" | "pendente_aprovacao",
      source: r.source ?? null,
    };
  });

  // Pending approval (todos esperando humano)
  const pending_approval = ((pendingApproval.data ?? []) as any[]).map((r) => {
    const c = contactsMap.get(r.contact_id);
    return {
      id: r.id,
      contact_name: c?.name ?? "—",
      valor: Number(r.valor_negociado),
      primeiro_vencimento: r.primeiro_vencimento,
      num_parcelas: r.num_parcelas,
      source: r.source ?? null,
      created_at: r.created_at,
      voice_call_id: r.voice_call_id ?? null,
    };
  });

  // Aggregate 7d + motivos
  const byDay: Record<string, Record<string, number>> = {};
  for (const r of (outcomes7d.data ?? []) as any[]) {
    const date = (r.started_at as string).slice(0, 10);
    const outcome = r.collection_outcome as string;
    byDay[date] ??= {};
    byDay[date][outcome] = (byDay[date][outcome] ?? 0) + 1;
  }
  const outcomes_7d = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, counts }));

  const motivosCount: Record<string, number> = {};
  for (const r of (motivos.data ?? []) as any[]) {
    const k = r.collection_outcome as string;
    motivosCount[k] = (motivosCount[k] ?? 0) + 1;
  }
  const top_motivos_nao_contato = Object.entries(motivosCount)
    .sort(([, a], [, b]) => b - a)
    .map(([outcome, count]) => ({ outcome, count }));

  return j({
    today: {
      valor_recuperado: valorRecuperadoHoje,
      chamadas: totalCallsToday,
      cpc: cpcCountToday,
      taxa_contato_pct: taxaContatoToday,
      acordos: acordosToday.count ?? 0,
    },
    yesterday: {
      valor_recuperado: valorRecuperadoOntem,
      chamadas: totalCallsYesterday,
      cpc: cpcCountYesterday,
      taxa_contato_pct: taxaContatoYesterday,
      acordos: acordosYesterday.count ?? 0,
    },
    month: {
      valor_recuperado: valorRecuperadoMes,
      acordos: acordosMonthCount,
      ticket_medio: Math.round(ticketMedio * 100) / 100,
    },
    carteira: {
      valor_aberto: valorCarteira,
      dividas_abertas: carteira.data?.length ?? 0,
      em_negociacao: carteiraEmNeg.count ?? 0,
    },
    active_campaigns: (activeCampaigns.data ?? []).map((c: any) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      total: c.contact_count ?? 0,
      placed: c.placed_count ?? 0,
      connected: c.connected_count ?? 0,
      failed: c.failed_count ?? 0,
      escalated: c.escalated_count ?? 0,
      started_at: c.started_at,
    })),
    pending_arrangements,
    pending_approval,
    recent_activity,
    outcomes_7d,
    top_motivos_nao_contato,
    integrations_status: integrations,
  });
});

function sumNum(arr: any[] | null | undefined): number {
  return (arr ?? []).reduce((s: number, v: any) => s + Number(v ?? 0), 0);
}
function sumNegociado(arr: any[] | null | undefined): number {
  return (arr ?? []).reduce((s: number, r: any) => s + Number(r?.valor_negociado ?? 0), 0);
}

function outcomeLabel(o: string | null): string {
  const map: Record<string, string> = {
    cpc: "Contato c/ devedor",
    cpct: "Contato c/ terceiro",
    nao_atende: "Não atende",
    caixa_postal: "Caixa postal",
    numero_errado: "Número errado",
    recusa: "Recusa",
    dnc_solicitado: "Pediu não ligar",
    acordo: "Acordo fechado",
    pago: "Já pago",
    sem_resultado: "Sem resultado",
  };
  return o ? map[o] ?? o : "—";
}

async function checkIntegrations(admin: SupabaseClient, accountId: string) {
  // Presence-only checks. Real ping pode ser feito depois em /settings.
  const [hasWhatsapp, hasAsaas, hasCompanySettings] = await Promise.all([
    admin.from("channels").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("channel_type", "whatsapp").eq("enabled", true),
    Promise.resolve(
      admin.from("billing_integrations").select("id", { count: "exact", head: true })
        .eq("account_id", accountId).eq("provider", "asaas").eq("enabled", true)
        .maybeSingle()
    ).then((r) => ({ count: r.data ? 1 : 0 })).catch(() => ({ count: 0 })),
    admin.from("company_settings").select("account_id").eq("account_id", accountId).maybeSingle(),
  ]);

  return {
    company_settings: Boolean(hasCompanySettings.data),
    whatsapp: (hasWhatsapp.count ?? 0) > 0,
    asaas: (hasAsaas.count ?? 0) > 0,
    // elevenlabs / twilio / resend são checadas por presença de secret — nós não temos
    // acesso ao Vault aqui, então exibimos "configurável" no UI.
  };
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
