import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/whatsapp-campaign-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
        const lovableApiKey = process.env["LOVABLE_API_KEY"];
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        if (!serviceKey || bearer !== serviceKey) return Response.json({ error: "Não autorizado" }, { status: 403 });
        if (!lovableApiKey) return Response.json({ error: "Lovable AI não está configurada" }, { status: 401 });
        const [{ supabaseAdmin }, { dispatchCampaignBatch }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/whatsapp-campaigns.server"),
        ]);
        try {
          return Response.json({ ok: true, ...(await dispatchCampaignBatch(supabaseAdmin, lovableApiKey)) });
        } catch (error) {
          console.error("[whatsapp-campaign-dispatch]", error);
          return Response.json({ error: error instanceof Error ? error.message : "Falha ao processar campanhas" }, { status: 500 });
        }
      },
    },
  },
});