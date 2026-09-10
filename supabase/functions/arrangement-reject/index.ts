// deno-lint-ignore-file no-explicit-any
//
// Rejeita um payment_arrangement (pendente_aprovacao OU pendente).
// Side-effects: status → cancelado, registra rejected_at/by + reason,
// volta debt pra "aberto" se estava em em_negociacao.
//
// Body: { arrangement_id: uuid, reason?: string }

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  let body: { arrangement_id: string; reason?: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.arrangement_id) return j({ error: "arrangement_id required" }, 400);

  const { error } = await userClient.rpc("reject_arrangement", {
    p_arrangement_id: body.arrangement_id,
    p_reason: body.reason ?? null,
  });
  if (error) return j({ error: error.message }, 400);

  return j({ ok: true, arrangement_id: body.arrangement_id });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
