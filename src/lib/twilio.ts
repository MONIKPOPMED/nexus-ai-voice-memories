import { supabase } from "@/integrations/supabase/client";

export interface OwnedTwilioNumber {
  sid: string;
  phone_number: string;
  friendly_name?: string;
  // null for verified Caller IDs — Twilio doesn't host them, so there are
  // no capabilities to report.
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean } | null;
  // Verified Caller ID (/OutgoingCallerIds), not a number bought on Twilio.
  // Can only be used as an outbound "From" — never receives calls/SMS.
  verified_caller_id_only?: boolean;
  already_imported: boolean;
}

/**
 * Lists numbers importable from the connected Twilio account: purchased
 * numbers plus verified Caller IDs (flagged with verified_caller_id_only).
 */
export async function fetchOwnedTwilioNumbers(accountId: string): Promise<OwnedTwilioNumber[]> {
  const { data, error } = await supabase.functions.invoke("twilio-numbers-owned", {
    body: { account_id: accountId },
  });
  if (error) throw error;
  return ((data as any)?.numbers ?? []) as OwnedTwilioNumber[];
}

/**
 * Import an EXISTING Twilio number into cobrAI (e.g. trial account's free
 * number, or a pre-existing one on the account). Skips the purchase call —
 * only re-points the voice/sms webhooks and registers the phone_numbers row.
 */
export async function importTwilioNumber(args: {
  accountId: string;
  phoneNumber: string;
  pinnedPersonaId?: string | null;
  inboxId?: string | null;
  inboundBehavior?: "ai_answer" | "forward_to_agent" | "voicemail" | "suggest";
}) {
  const { data, error } = await supabase.functions.invoke("twilio-numbers-import", {
    body: {
      account_id: args.accountId,
      phone_number: args.phoneNumber,
      pinned_persona_id: args.pinnedPersonaId ?? null,
      inbox_id: args.inboxId ?? null,
      inbound_behavior: args.inboundBehavior ?? "ai_answer",
    },
  });
  if (error) throw error;
  return data as {
    phone_number: { id: string; e164: string; provider_config: Record<string, unknown> };
    twilio: { sid: string; phone_number: string; friendly_name: string };
  };
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName?: string;
  locality?: string;
  region?: string;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

export async function searchAvailableNumbers(params: {
  countryCode: string;
  type?: "Local" | "TollFree" | "Mobile";
  areaCode?: string;
  contains?: string;
  voice?: boolean;
  sms?: boolean;
  mms?: boolean;
  accountId?: string;
}): Promise<AvailableNumber[]> {
  const { data, error } = await supabase.functions.invoke("twilio-numbers-search", {
    body: {
      country_code: params.countryCode,
      type: params.type ?? "Local",
      area_code: params.areaCode,
      contains: params.contains,
      voice: params.voice ?? true,
      sms: params.sms ?? true,
      mms: params.mms,
      account_id: params.accountId,
    },
  });
  if (error) throw error;
  return ((data as any)?.results ?? []) as AvailableNumber[];
}

export async function buyNumber(params: {
  accountId: string;
  phoneNumber: string;
  friendlyName?: string;
  inboxId?: string | null;
  pinnedPersonaId?: string | null;
  inboundBehavior?: string;
  bundleSid?: string;
  addressSid?: string;
}): Promise<{ phone_number: any; twilio: any }> {
  const { data, error } = await supabase.functions.invoke("twilio-numbers-buy", {
    body: {
      account_id: params.accountId,
      phone_number: params.phoneNumber,
      friendly_name: params.friendlyName,
      inbox_id: params.inboxId,
      pinned_persona_id: params.pinnedPersonaId,
      inbound_behavior: params.inboundBehavior,
      bundle_sid: params.bundleSid,
      address_sid: params.addressSid,
    },
  });
  if (error) throw error;
  return data as { phone_number: any; twilio: any };
}

