// Pull de cobranças PENDING/OVERDUE do Asaas → debts.
// Idempotente via external_ref = "asaas:payment:<id>".
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { listPendingPayments, getCustomer } from "../_shared/asaas/client.ts";
import { resolveOrCreateContact } from "../_shared/integrations/contact-match.ts";

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

  try {
    const authHeader = req.headers.get("Authorization");
    const isServiceCall = authHeader === `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let userId: string | null = null;
    if (!isServiceCall) {
      if (!authHeader) return json({ error: "missing_auth" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: userData } = await userClient.auth.getUser();
      if (!userData.user) return json({ error: "unauthorized" }, 401);
      userId = userData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const accountId = String(body?.account_id ?? "");
    if (!accountId) return json({ error: "missing_account_id" }, 400);

    if (userId) {
      const { data: au } = await admin
        .from("account_users")
        .select("account_id")
        .eq("user_id", userId)
        .eq("account_id", accountId)
        .maybeSingle();
      if (!au) return json({ error: "forbidden" }, 403);
    }

    const { data: keyData } = await admin.rpc("get_account_secret", {
      p_account_id: accountId,
      p_provider: "asaas",
      p_key_name: "api_key",
    });
    const apiKey = keyData as string | null;
    if (!apiKey) return json({ error: "asaas_not_configured" }, 412);

    const { data: acct } = await admin
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .single();
    const cfg = (acct?.settings as any)?.collection_integrations?.asaas ?? {};
    const sandbox = cfg.sandbox === true;

    const asaasCfg = { apiKey, sandbox };

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    let offset = 0;
    const limit = 100;
    let totalProcessed = 0;
    const customersCache = new Map<string, any>();

    while (true) {
      const { data: payments, hasMore } = await listPendingPayments(asaasCfg, { limit, offset });
      if (payments.length === 0) break;

      for (const payment of payments) {
        totalProcessed++;
        try {
          let customer = customersCache.get(payment.customer);
          if (!customer) {
            customer = await getCustomer(asaasCfg, payment.customer);
            customersCache.set(payment.customer, customer);
          }
          if (!customer || (!customer.email && !customer.phone)) {
            skipped++;
            continue;
          }

          const localContactId = await resolveOrCreateContact(admin as any, {
            accountId,
            email: customer.email ?? null,
            phone: customer.phone ?? null,
            name: customer.name ?? null,
            source: "asaas",
          });
          if (!localContactId) {
            skipped++;
            continue;
          }

          const externalRef = `asaas:payment:${payment.id}`;
          const venc = payment.dueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);

          const { data: existing } = await admin
            .from("debts")
            .select("id")
            .eq("account_id", accountId)
            .eq("external_ref", externalRef)
            .maybeSingle();

          if (existing) {
            await admin.from("debts").update({
              valor_atual: payment.value,
              descricao: payment.description ?? `Cobrança Asaas ${payment.id}`,
              vencimento: venc,
              last_synced_at: new Date().toISOString(),
            }).eq("id", existing.id);
          } else {
            await admin.from("debts").insert({
              account_id: accountId,
              contact_id: localContactId,
              descricao: payment.description ?? `Cobrança Asaas ${payment.id}`,
              valor_original: payment.value,
              valor_atual: payment.value,
              vencimento: venc,
              origem: "asaas",
              external_ref: externalRef,
              status: "aberto",
              source: "asaas",
              last_synced_at: new Date().toISOString(),
            });
            imported++;
          }
        } catch (e) {
          errors.push(`payment ${payment.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (!hasMore) break;
      offset += limit;
      if (offset > 5000) break; // safety
    }

    const newSettings = {
      ...(acct?.settings as any ?? {}),
      collection_integrations: {
        ...((acct?.settings as any)?.collection_integrations ?? {}),
        asaas: {
          ...cfg,
          last_synced_at: new Date().toISOString(),
        },
      },
    };
    await admin.from("accounts").update({ settings: newSettings }).eq("id", accountId);

    await admin.from("audit_log").insert({
      account_id: accountId,
      user_id: userId,
      action: "debtors_sync_asaas",
      resource_type: "sync",
      metadata: { imported, skipped, errors: errors.slice(0, 10), total: totalProcessed },
    });

    return json({ ok: true, imported, skipped, errors, total: totalProcessed });
  } catch (e) {
    return json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
