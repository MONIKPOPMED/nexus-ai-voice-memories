// Cria devedor (contact + debtor_profile) e opcionalmente uma primeira dívida.
// Valida documento, telefone, DNC e duplicidade por telefone.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  classifyDoc,
  normalizePhoneBR,
  parseBRDate,
  parseBRNumber,
} from "../_shared/debtors/validate.ts";

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
    const accountId = String(body?.account_id ?? "");
    if (!accountId) return json({ error: "missing_account_id" }, 400);

    // Verifica membership
    const { data: au } = await admin
      .from("account_users")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!au) return json({ error: "forbidden" }, 403);

    const debtor = body?.debtor ?? {};
    const debt = body?.debt ?? null;

    const name = String(debtor.name ?? "").trim();
    const email = debtor.email ? String(debtor.email).trim().toLowerCase() : null;
    const phoneRaw = debtor.phone ?? debtor.phone_number ?? "";
    const phone = normalizePhoneBR(String(phoneRaw));
    const docInfo = classifyDoc(debtor.doc_number ?? debtor.cpf_cnpj ?? null);

    const errors: string[] = [];
    if (!name) errors.push("nome_obrigatorio");
    if (!phone) errors.push("telefone_invalido");
    if (debtor.doc_number && !docInfo.valid) errors.push("documento_invalido");
    if (errors.length) return json({ error: "validation_failed", details: errors }, 400);

    // Checa DNC
    const { data: dnc } = await admin
      .from("dnc_list")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_number", phone)
      .maybeSingle();
    if (dnc) return json({ error: "phone_in_dnc" }, 409);

    // Duplicidade por telefone
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .eq("phone_number", phone)
      .maybeSingle();

    let contactId: string;
    if (existing) {
      contactId = existing.id;
      // Atualiza dados básicos
      await admin
        .from("contacts")
        .update({
          name,
          email: email ?? undefined,
          last_activity_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    } else {
      const { data: created, error: insertErr } = await admin
        .from("contacts")
        .insert({
          account_id: accountId,
          name,
          email,
          phone_number: phone,
          last_activity_at: new Date().toISOString(),
          additional_attributes: { source: "manual" },
        })
        .select("id")
        .single();
      if (insertErr || !created) {
        return json({ error: "contact_insert_failed", details: insertErr?.message }, 500);
      }
      contactId = created.id;
    }

    // Upsert debtor_profile (doc é opcional)
    if (docInfo.type && docInfo.clean) {
      await admin.from("debtor_profiles").upsert(
        {
          account_id: accountId,
          contact_id: contactId,
          doc_type: docInfo.type,
          doc_number: docInfo.clean,
          external_ref: debtor.external_ref ?? null,
        },
        { onConflict: "contact_id" },
      );
    }

    // Cria a primeira dívida (opcional)
    let debtId: string | null = null;
    if (debt) {
      const valor = parseBRNumber(debt.valor ?? debt.valor_atual);
      const venc = parseBRDate(debt.vencimento);
      if (valor == null) return json({ error: "valor_invalido" }, 400);
      if (!venc) return json({ error: "vencimento_invalido" }, 400);

      const { data: createdDebt, error: debtErr } = await admin
        .from("debts")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          descricao: debt.descricao ?? null,
          valor_original: valor,
          valor_atual: valor,
          vencimento: venc,
          origem: debt.origem ?? null,
          external_ref: debt.external_ref ?? null,
          status: "aberto",
          source: "manual",
        })
        .select("id")
        .single();
      if (debtErr || !createdDebt) {
        return json({ error: "debt_insert_failed", details: debtErr?.message }, 500);
      }
      debtId = createdDebt.id;
    }

    // Audit log
    await admin.from("audit_log").insert({
      account_id: accountId,
      user_id: userData.user.id,
      action: "debtor_created",
      resource_type: "contact",
      resource_id: contactId,
      metadata: { debt_id: debtId, manual: true },
    });

    return json({ ok: true, contact_id: contactId, debt_id: debtId });
  } catch (e) {
    return json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
