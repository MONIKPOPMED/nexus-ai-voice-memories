// pg_cron chama essa rota a cada 6h. Pra cada conta com integração de
// carteira marcada como auto_sync=true em accounts.settings.collection_integrations,
// invoca a edge function debtors-sync-<provider> com service-role.
//
// Segurança: rota pública (/api/public/*) bypassa auth da plataforma na
// publicação, então validamos manualmente o Bearer (anon key) E usamos
// service-role key apenas server-side pra invocar as syncs.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

interface AccountRow {
  id: string;
  settings: {
    collection_integrations?: Record<
      string,
      { auto_sync?: boolean; last_synced_at?: string }
    >;
  } | null;
}

const PROVIDERS = ["hubspot", "pipedrive", "asaas"] as const;
type Provider = (typeof PROVIDERS)[number];

export const Route = createFileRoute("/api/public/hooks/debtors-auto-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // 1. Auth: aceita Bearer com anon key (cron passa esse header)
        const expectedToken =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        const authHeader = request.headers.get("authorization") ?? "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!expectedToken || token !== expectedToken) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const supabaseUrl = process.env.SUPABASE_URL!;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        // 2. Lista contas com pelo menos uma integração de auto_sync=true
        const { data: accounts, error } = await admin
          .from("accounts")
          .select("id, settings")
          .returns<AccountRow[]>();

        if (error) {
          console.error("[debtors-auto-sync] failed to list accounts", error);
          return new Response(JSON.stringify({ error: "db_error", detail: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const tasks: Array<{ accountId: string; provider: Provider }> = [];
        for (const acc of accounts ?? []) {
          const cfg = acc.settings?.collection_integrations ?? {};
          for (const provider of PROVIDERS) {
            if (cfg[provider]?.auto_sync === true) {
              tasks.push({ accountId: acc.id, provider });
            }
          }
        }

        if (tasks.length === 0) {
          return Response.json({ ok: true, processed: 0, message: "no auto-sync accounts" });
        }

        // 3. Invoca cada sync edge function em paralelo (com cap)
        const results = await Promise.allSettled(
          tasks.map(async (t) => {
            const res = await fetch(
              `${supabaseUrl}/functions/v1/debtors-sync-${t.provider}`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${serviceKey}`,
                  apikey: serviceKey,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ account_id: t.accountId }),
              },
            );
            const body = await res.json().catch(() => ({}));
            return { ...t, status: res.status, body };
          }),
        );

        const summary = results.map((r, i) => {
          if (r.status === "fulfilled") {
            return {
              account_id: r.value.accountId,
              provider: r.value.provider,
              http: r.value.status,
              imported: r.value.body?.imported ?? 0,
              total: r.value.body?.total ?? 0,
              ok: r.value.status >= 200 && r.value.status < 300,
            };
          }
          return {
            account_id: tasks[i].accountId,
            provider: tasks[i].provider,
            ok: false,
            error: String(r.reason),
          };
        });

        const okCount = summary.filter((s) => s.ok).length;
        console.log(
          `[debtors-auto-sync] processed=${tasks.length} ok=${okCount} fail=${tasks.length - okCount}`,
        );

        return Response.json({
          ok: true,
          processed: tasks.length,
          succeeded: okCount,
          failed: tasks.length - okCount,
          results: summary,
        });
      },
    },
  },
});
