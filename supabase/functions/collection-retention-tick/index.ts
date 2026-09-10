// deno-lint-ignore-file no-explicit-any
//
// Cron-friendly: apaga gravações de chamadas mais antigas que o
// recording_retention_days configurado em company_settings (default 90d).
//
// Também remove o asset do Storage se houver referência em voice_calls.recording_url.
// Para rodar: agendar no pg_cron ou Supabase schedule chamando esta fn diariamente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const isService = (req.headers.get("Authorization") ?? "").includes(serviceKey);
  if (!isService) return j({ error: "service role required" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // Pega configs de retenção por account
  const { data: settings } = await admin
    .from("company_settings")
    .select("account_id, recording_retention_days");

  let totalPurged = 0;
  const perAccount: Record<string, number> = {};

  for (const cfg of (settings ?? []) as Array<{ account_id: string; recording_retention_days: number }>) {
    const days = cfg.recording_retention_days ?? 90;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: toDelete } = await admin
      .from("voice_calls")
      .select("id, recording_url")
      .eq("account_id", cfg.account_id)
      .lt("started_at", cutoff)
      .not("recording_url", "is", null)
      .limit(500);

    if (!toDelete || toDelete.length === 0) continue;

    for (const call of toDelete as any[]) {
      // Remove do Storage se bucket interno
      const url = String(call.recording_url ?? "");
      if (url.includes("/storage/v1/object/")) {
        try {
          const m = url.match(/\/storage\/v1\/object\/(?:public\/)?([^/]+)\/(.+)$/);
          if (m) {
            const [, bucket, path] = m;
            await admin.storage.from(bucket).remove([path]);
          }
        } catch (e) {
          console.warn("[retention] storage remove failed", e);
        }
      }
      await admin
        .from("voice_calls")
        .update({
          recording_url: null,
          metadata: { recording_purged_at: new Date().toISOString() },
        })
        .eq("id", call.id);
    }

    perAccount[cfg.account_id] = toDelete.length;
    totalPurged += toDelete.length;
  }

  return j({ ok: true, totalPurged, perAccount });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
