// deno-lint-ignore-file no-explicit-any
//
// Marca manualmente um payment_arrangement como pago. Usado quando o pagamento
// ocorreu fora do fluxo Asaas (Pix manual, dinheiro, transferência, ou quando
// o webhook do Asaas falhou). Espelha o efeito do asaas-webhook (status='pago',
// paid_at, debt status='pago') via RPC mark_arrangement_paid.
//
// Body: { arrangement_id: uuid, payment_method?: string, note?: string }

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

  let body: { arrangement_id: string; payment_method?: string; note?: string };
  try { body = await req.json(); } catch { return j({ error: "bad json" }, 400); }
  if (!body.arrangement_id) return j({ error: "arrangement_id required" }, 400);

  const { data, error } = await userClient.rpc("mark_arrangement_paid", {
    p_arrangement_id: body.arrangement_id,
    p_payment_method: body.payment_method ?? null,
    p_note: body.note ?? null,
  });

  if (error) {
    console.warn("[arrangement-mark-paid] rpc error", error);
    return j({ error: error.message }, 400);
  }

  return j({ ok: true, arrangement_id: body.arrangement_id, result: data });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
