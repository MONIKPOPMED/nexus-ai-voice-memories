import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { controlCampaign, createCampaign } from "./whatsapp-campaigns.server";

const createSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  audienceMode: z.enum(["selected", "all_open"]),
  contactIds: z.array(z.string().uuid()).max(5000),
  scheduledFor: z.string().datetime().nullable(),
});

export const createWhatsAppCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createCampaign(supabaseAdmin, context.userId, data);
  });

export const controlWhatsAppCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid(), action: z.enum(["pause", "resume", "cancel"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return controlCampaign(supabaseAdmin, context.userId, data.campaignId, data.action);
  });