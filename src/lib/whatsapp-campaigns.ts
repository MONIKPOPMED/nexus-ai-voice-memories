import { supabase } from "@/integrations/supabase/client";

export type WhatsAppCampaign = {
  id: string;
  name: string;
  status: string;
  audience_mode: string;
  daily_limit: number;
  contact_count: number;
  sent_count: number;
  replied_count: number;
  skipped_count: number;
  failed_count: number;
  scheduled_for: string | null;
  last_error: string | null;
  created_at: string;
};

export async function listWhatsAppCampaigns(accountId: string) {
  const { data, error } = await supabase.from("whatsapp_campaigns").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return (data ?? []) as WhatsAppCampaign[];
}