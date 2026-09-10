// deno-lint-ignore-file no-explicit-any
//
// Lista payment_arrangements com filtros + enrichment (contact, debt, call).
//
// Body: { status?, q?, page?, limit? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

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

  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const page = Math.max(1, Number(body.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = admin
    .from("payment_arrangements")
    .select(
      `id, status, valor_negociado, metodo, num_parcelas, primeiro_vencimento,
       asaas_payment_url, asaas_charge_id, voice_call_id, conversation_id, debt_id, contact_id,
       approved_at, approved_by, rejected_at, rejected_by, rejection_reason,
       paid_at, canceled_at, created_at, updated_at, source, metadata`,
      { count: "exact" },
    )
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (body.status && body.status !== "todos") query = query.eq("status", body.status);

  const { data: arrs, count, error } = await query;
  if (error) return j({ error: error.message }, 500);

  // Enrichment
  const ids = (arrs ?? []) as any[];
  const contactIds = Array.from(new Set(ids.map((r) => r.contact_id).filter(Boolean)));
  const debtIds = Array.from(new Set(ids.map((r) => r.debt_id).filter(Boolean)));
  const callIds = Array.from(new Set(ids.map((r) => r.voice_call_id).filter(Boolean)));

  const [contacts, debts, calls] = await Promise.all([
    contactIds.length
      ? admin.from("contacts").select("id, name, phone_number, email").in("id", contactIds)
      : Promise.resolve({ data: [] }),
    debtIds.length
      ? admin.from("debts").select("id, descricao, valor_atual, valor_original, vencimento, origem").in("id", debtIds)
      : Promise.resolve({ data: [] }),
    callIds.length
      ? admin.from("voice_calls").select("id, started_at, duration_seconds, transcript, recording_url").in("id", callIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactMap = new Map((contacts.data ?? []).map((c: any) => [c.id, c]));
  const debtMap = new Map((debts.data ?? []).map((d: any) => [d.id, d]));
  const callMap = new Map((calls.data ?? []).map((c: any) => [c.id, c]));

  const rows = (arrs ?? []).map((a: any) => {
    const contact = a.contact_id ? contactMap.get(a.contact_id) : null;
    const debt = a.debt_id ? debtMap.get(a.debt_id) : null;
    const call = a.voice_call_id ? callMap.get(a.voice_call_id) : null;
    const meta = (a.metadata as any) ?? {};
    const valorOriginal = Number(meta.valor_original ?? debt?.valor_atual ?? 0);
    const desconto = valorOriginal > 0
      ? Math.round((1 - Number(a.valor_negociado) / valorOriginal) * 100)
      : 0;
    return {
      id: a.id,
      status: a.status,
      valor_negociado: Number(a.valor_negociado),
      valor_original: valorOriginal,
      desconto_pct: desconto,
      metodo: a.metodo,
      num_parcelas: a.num_parcelas,
      primeiro_vencimento: a.primeiro_vencimento,
      asaas_payment_url: a.asaas_payment_url,
      asaas_charge_id: a.asaas_charge_id,
      approved_at: a.approved_at,
      rejected_at: a.rejected_at,
      rejection_reason: a.rejection_reason,
      paid_at: a.paid_at,
      canceled_at: a.canceled_at,
      created_at: a.created_at,
      source: a.source ?? null,
      conversation_id: a.conversation_id ?? null,
      contact: contact
        ? { id: contact.id, name: contact.name, phone: contact.phone_number, email: contact.email }
        : null,
      debt: debt
        ? {
            id: debt.id,
            descricao: debt.descricao,
            valor_atual: Number(debt.valor_atual),
            valor_original: Number(debt.valor_original),
            vencimento: debt.vencimento,
            origem: debt.origem,
          }
        : null,
      call: call
        ? {
            id: call.id,
            started_at: call.started_at,
            duration_seconds: call.duration_seconds,
            has_transcript: Array.isArray(call.transcript) && call.transcript.length > 0,
            has_recording: Boolean(call.recording_url),
          }
        : null,
    };
  });

  // Filtragem por q (após enrichment, busca em nome/fone/email)
  const filtered = body.q && body.q.trim()
    ? rows.filter((r: any) => {
        const term = String(body.q).trim().toLowerCase();
        return (
          (r.contact?.name ?? "").toLowerCase().includes(term) ||
          (r.contact?.phone ?? "").includes(term) ||
          (r.contact?.email ?? "").toLowerCase().includes(term)
        );
      })
    : rows;

  // Counts por status (pra badges)
  const { data: statusCounts } = await admin
    .from("payment_arrangements")
    .select("status")
    .eq("account_id", accountId);

  const counts: Record<string, number> = { todos: 0 };
  for (const r of (statusCounts ?? []) as any[]) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    counts.todos += 1;
  }

  return j({ rows: filtered, total: count ?? 0, counts });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
