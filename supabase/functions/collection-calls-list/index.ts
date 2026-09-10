// deno-lint-ignore-file no-explicit-any
//
// Lista chamadas de cobrança com filtros + paginação para a página /historico.
// Também suporta GET ?call_id=... pra retornar o detalhe completo (transcript
// + recording_url + arrangement linkado).
//
// Body POST: { q?, outcome?, status?, from?, to?, page?, limit? }
// Body GET:  ?call_id=uuid  →  { call + contact + arrangement }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

  const url = new URL(req.url);
  const callIdParam = url.searchParams.get("call_id");

  // ── GET detail ─────────────────────────────────────────────
  if (req.method === "GET" || callIdParam) {
    const callId = callIdParam ?? url.searchParams.get("call_id");
    if (!callId) return j({ error: "call_id required" }, 400);
    return detail(admin, accountId, callId);
  }

  // ── POST list ──────────────────────────────────────────────
  let body: any = {};
  try { body = await req.json(); } catch { /* vazio = defaults */ }

  const page = Math.max(1, Number(body.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(body.limit ?? 50)));
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = admin
    .from("voice_calls")
    .select(
      `id, account_id, direction, status, collection_outcome,
       from_number, to_number, duration_seconds, total_cost_cents,
       recording_url, recording_storage_path, transcript, transcription_status,
       started_at, ended_at, metadata, debt_id`,
      { count: "exact" },
    )
    .eq("account_id", accountId)
    .order("started_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (body.outcome) query = query.eq("collection_outcome", body.outcome);
  if (body.status) query = query.eq("status", body.status);
  if (body.from) query = query.gte("started_at", body.from);
  if (body.to) query = query.lte("started_at", body.to);

  if (typeof body.q === "string" && body.q.trim()) {
    const term = `%${body.q.trim()}%`;
    // Busca por telefone destino — nome do devedor não está em voice_calls.
    query = query.or(`to_number.ilike.${term},from_number.ilike.${term}`);
  }

  const { data: calls, count, error } = await query;
  if (error) return j({ error: error.message }, 500);

  // Enriquece com nome do contact (via phone_number match) + arrangement
  const toNumbers = Array.from(new Set((calls ?? []).map((c: any) => c.to_number).filter(Boolean)));
  const callIds = (calls ?? []).map((c: any) => c.id);

  const [contacts, arrangements] = await Promise.all([
    toNumbers.length > 0
      ? admin.from("contacts")
          .select("id, name, phone_number")
          .eq("account_id", accountId)
          .in("phone_number", toNumbers)
      : Promise.resolve({ data: [] }),
    callIds.length > 0
      ? admin.from("payment_arrangements")
          .select("id, voice_call_id, valor_negociado, status, num_parcelas")
          .eq("account_id", accountId)
          .in("voice_call_id", callIds)
      : Promise.resolve({ data: [] }),
  ]);

  const contactByPhone = new Map<string, { id: string; name: string | null }>();
  for (const c of (contacts.data ?? []) as any[]) {
    if (c.phone_number) contactByPhone.set(c.phone_number, { id: c.id, name: c.name });
  }
  const arrByCallId = new Map<string, any>();
  for (const a of (arrangements.data ?? []) as any[]) {
    if (a.voice_call_id) arrByCallId.set(a.voice_call_id, a);
  }

  const rows = (calls ?? []).map((c: any) => {
    const meta = (c.metadata as any) ?? {};
    const contact = c.to_number ? contactByPhone.get(c.to_number) : null;
    const arr = arrByCallId.get(c.id) ?? null;
    const transcriptVal = c.transcript;
    const hasTranscript = Array.isArray(transcriptVal)
      ? transcriptVal.length > 0
      : typeof transcriptVal === "string"
        ? transcriptVal.trim().length > 0
        : false;
    return {
      id: c.id,
      started_at: c.started_at,
      ended_at: c.ended_at,
      direction: c.direction,
      status: c.status,
      collection_outcome: c.collection_outcome,
      from_number: c.from_number,
      to_number: c.to_number,
      duration_seconds: c.duration_seconds ?? 0,
      total_cost_cents: c.total_cost_cents ?? 0,
      has_recording: Boolean(c.recording_url || c.recording_storage_path),
      has_transcript: hasTranscript,
      transcription_status: c.transcription_status ?? null,
      debtor_name:
        contact?.name ??
        (meta?.variables?.debtor_name ? String(meta.variables.debtor_name) : null),
      contact_id: contact?.id ?? null,
      arrangement: arr
        ? { id: arr.id, valor: Number(arr.valor_negociado), status: arr.status, num_parcelas: arr.num_parcelas }
        : null,
      campaign_id: meta?.campaign_id ?? meta?.variables?.campaign_id ?? null,
      debt_id: c.debt_id ?? meta?.debt_id ?? meta?.variables?.debt_id ?? null,
    };
  });

  return j({ rows, total: count ?? 0, page, limit });
});

async function detail(admin: any, accountId: string, callId: string) {
  const { data: call, error } = await admin
    .from("voice_calls")
    .select(
      `id, account_id, direction, status, collection_outcome,
       from_number, to_number, duration_seconds, total_cost_cents,
       recording_url, transcript, started_at, ended_at, metadata,
       debt_id, conversation_id, persona_id, provider, provider_call_sid`,
    )
    .eq("id", callId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) return j({ error: error.message }, 500);
  if (!call) return j({ error: "call not found" }, 404);

  // Enriquece: contact, arrangement, debt, persona, campaign
  const meta = (call.metadata as any) ?? {};
  const [contact, arrangement, debt, persona] = await Promise.all([
    call.to_number
      ? admin.from("contacts").select("id, name, email, phone_number")
          .eq("account_id", accountId).eq("phone_number", call.to_number)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("payment_arrangements")
      .select("id, valor_negociado, metodo, num_parcelas, primeiro_vencimento, status, asaas_payment_url")
      .eq("voice_call_id", callId).maybeSingle(),
    call.debt_id
      ? admin.from("debts").select("id, descricao, valor_atual, vencimento, origem")
          .eq("id", call.debt_id).maybeSingle()
      : Promise.resolve({ data: null }),
    call.persona_id
      ? admin.from("agent_personas").select("id, name").eq("id", call.persona_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return j({
    call: {
      id: call.id,
      direction: call.direction,
      status: call.status,
      collection_outcome: call.collection_outcome,
      from_number: call.from_number,
      to_number: call.to_number,
      duration_seconds: call.duration_seconds ?? 0,
      total_cost_cents: call.total_cost_cents ?? 0,
      recording_url: call.recording_url,
      transcript: call.transcript ?? [],
      started_at: call.started_at,
      ended_at: call.ended_at,
      provider: call.provider,
      provider_call_sid: call.provider_call_sid,
      campaign_id: meta?.campaign_id ?? null,
      metadata: meta,
    },
    contact: contact.data
      ? {
          id: contact.data.id,
          name: contact.data.name,
          email: contact.data.email,
          phone: contact.data.phone_number,
        }
      : null,
    arrangement: arrangement.data ?? null,
    debt: debt.data ?? null,
    persona: persona.data ?? null,
  });
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
