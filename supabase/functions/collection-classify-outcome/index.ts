// deno-lint-ignore-file no-explicit-any
//
// LEGACY-COMPAT WRAPPER — agora delega tudo pra collection-extract-arrangement
// que faz heurística + LLM extraction estruturada.
//
// Mantido pra não quebrar quem ainda chama esta URL (UI antiga,
// integrações externas).
//
// Body (compat): { voice_call_id, transcript?, summary? }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const baseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const r = await fetch(`${baseUrl}/functions/v1/collection-extract-arrangement`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return j(data, r.status);
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
