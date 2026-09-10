// Pull de devedores do HubSpot: deals em pipeline+stage configurados → debts.
// Idempotente via external_ref = "hubspot:deal:<id>".
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { listDealsByStage, getContact } from "../_shared/crm/hubspot-sync.ts";
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

    // Lê config: token via vault, pipeline/stage em accounts.settings
    const { data: tokenData } = await admin.rpc("get_account_secret", {
      p_account_id: accountId,
      p_provider: "hubspot",
      p_key_name: "access_token",
    });
    const accessToken = tokenData as string | null;
    if (!accessToken) return json({ error: "hubspot_not_configured" }, 412);

    const { data: acct } = await admin
      .from("accounts")
      .select("settings")
      .eq("id", accountId)
      .single();
    const cfg = (acct?.settings as any)?.collection_integrations?.hubspot ?? {};
    const pipelineId = cfg.pipeline_id;
    const stageId = cfg.stage_id;
    if (!pipelineId || !stageId) {
      return json({ error: "hubspot_pipeline_not_configured" }, 412);
    }

    const hsCfg = { accessToken };
    const deals = await listDealsByStage(hsCfg, pipelineId, stageId, 100);

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const deal of deals) {
      try {
        if (!deal.contactId) {
          skipped++;
          continue;
        }
        const contact = await getContact(hsCfg, deal.contactId);
        if (!contact || (!contact.email && !contact.phone)) {
          skipped++;
          continue;
        }
        const fullName = [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() || deal.dealname;
        const localContactId = await resolveOrCreateContact(admin as any, {
          accountId,
          email: contact.email,
          phone: contact.phone,
          name: fullName,
          source: "hubspot",
        });
        if (!localContactId) {
          skipped++;
          continue;
        }

        const externalRef = `hubspot:deal:${deal.id}`;
        const valor = deal.amount ?? 0;
        const venc = deal.closedate ? deal.closedate.slice(0, 10) : new Date().toISOString().slice(0, 10);

        // Upsert por (account_id, external_ref)
        const { data: existing } = await admin
          .from("debts")
          .select("id")
          .eq("account_id", accountId)
          .eq("external_ref", externalRef)
          .maybeSingle();

        if (existing) {
          await admin.from("debts").update({
            valor_atual: valor,
            descricao: deal.description ?? deal.dealname,
            vencimento: venc,
            last_synced_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          await admin.from("debts").insert({
            account_id: accountId,
            contact_id: localContactId,
            descricao: deal.description ?? deal.dealname,
            valor_original: valor,
            valor_atual: valor,
            vencimento: venc,
            origem: "hubspot",
            external_ref: externalRef,
            status: "aberto",
            source: "hubspot",
            last_synced_at: new Date().toISOString(),
          });
          imported++;
        }
      } catch (e) {
        errors.push(`deal ${deal.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const newSettings = {
      ...(acct?.settings as any ?? {}),
      collection_integrations: {
        ...((acct?.settings as any)?.collection_integrations ?? {}),
        hubspot: {
          ...cfg,
          last_synced_at: new Date().toISOString(),
        },
      },
    };
    await admin.from("accounts").update({ settings: newSettings }).eq("id", accountId);

    await admin.from("audit_log").insert({
      account_id: accountId,
      user_id: userId,
      action: "debtors_sync_hubspot",
      resource_type: "sync",
      metadata: { imported, skipped, errors: errors.slice(0, 10), total_deals: deals.length },
    });

    return json({ ok: true, imported, skipped, errors, total: deals.length });
  } catch (e) {
    return json({ error: "internal", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
