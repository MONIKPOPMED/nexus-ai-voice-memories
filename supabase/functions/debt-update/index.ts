// Atualiza dívida existente. O trigger tg_debt_status_push enfileira mudanças
// de status para sync de volta ao CRM/Asaas.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { parseBRDate, parseBRNumber } from "../_shared/debtors/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_STATUS = new Set([
  "aberto",
  "em_negociacao",
  "acordado",
  "pago",
  "baixado",
  "cancelado",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing_auth" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return json({ error: "unauthorized" }, 401);

    const body = await req.json();
    const debtId = String(body?.debt_id ?? "");
    if (!debtId) return json({ error: "missing_debt_id" }, 400);

    const { data: debtRow } = await admin
      .from("debts")
      .select("id, account_id")
      .eq("id", debtId)
      .maybeSingle();
    if (!debtRow) return json({ error: "not_found" }, 404);

    const { data: au } = await admin
      .from("account_users")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .eq("account_id", debtRow.account_id)
      .maybeSingle();
    if (!au) return json({ error: "forbidden" }, 403);

    const updates: Record<string, any> = {};
    const patch = body?.patch ?? {};

    if (patch.descricao !== undefined) updates.descricao = patch.descricao || null;
    if (patch.origem !== undefined) updates.origem = patch.origem || null;
    if (patch.valor_atual !== undefined) {
      const v = parseBRNumber(patch.valor_atual);
      if (v == null) return json({ error: "valor_atual_invalido" }, 400);
      updates.valor_atual = v;
    }
    if (patch.vencimento !== undefined) {
      const v = parseBRDate(patch.vencimento);
      if (!v) return json({ error: "vencimento_invalido" }, 400);
      updates.vencimento = v;
    }
    if (patch.status !== undefined) {
      if (!ALLOWED_STATUS.has(patch.status)) {
        return json({ error: "status_invalido" }, 400);
      }
      updates.status = patch.status;
    }

    if (Object.keys(updates).length === 0) {
      return json({ error: "no_changes" }, 400);
    }

    updates.updated_at = new Date().toISOString();

    const { error: updErr } = await admin
      .from("debts")
      .update(updates)
      .eq("id", debtId);
    if (updErr) return json({ error: "update_failed", details: updErr.message }, 500);

    await admin.from("audit_log").insert({
      account_id: debtRow.account_id,
      user_id: userData.user.id,
      action: "debt_updated",
      resource_type: "debt",
      resource_id: debtId,
      metadata: { patch: updates },
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
