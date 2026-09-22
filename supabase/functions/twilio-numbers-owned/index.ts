// List phone numbers the Twilio account can import: owned numbers
// (IncomingPhoneNumbers) plus verified Caller IDs (OutgoingCallerIds — BYOC
// personal cells verified via a code call/SMS, never bought from Twilio).
// Used by the "Importar existente" dropdown so the operator picks instead
// of typing the E.164 by hand.
//
// Output includes which numbers are already registered in Nexus so the UI
// can mark/disable them, and flags verified-caller-id-only entries so the
// UI can explain they're outbound-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  loadAccountTwilioCreds,
  TwilioConfigError,
} from "../_shared/twilio/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return j({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const uid = userRes?.user?.id;
    if (!uid) return j({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const accountId: string | undefined = body.account_id;
    if (!accountId) return j({ error: "account_id required" }, 400);

    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!role || role.role !== "admin") return j({ error: "admin role required" }, 403);

    const creds = await loadAccountTwilioCreds(admin, accountId);
    const twauth = `Basic ${btoa(`${creds.apiKey ?? creds.accountSid}:${creds.apiSecret ?? creds.authToken}`)}`;

    const [ownedRes, callerIdRes] = await Promise.all([
      fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/IncomingPhoneNumbers.json?PageSize=50`,
        { headers: { Authorization: twauth } },
      ),
      fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/OutgoingCallerIds.json?PageSize=50`,
        { headers: { Authorization: twauth } },
      ),
    ]);
    if (!ownedRes.ok) {
      const t = await ownedRes.text().catch(() => "");
      return j({ error: `Twilio list failed: ${ownedRes.status} ${t.slice(0, 200)}` }, 502);
    }
    const ownedList = (await ownedRes.json()) as any;
    const owned: any[] = ownedList?.incoming_phone_numbers ?? [];

    // Caller IDs are best-effort: if that lookup fails for some reason, we
    // still want to return the owned numbers rather than failing the whole
    // request.
    let callerIds: any[] = [];
    if (callerIdRes.ok) {
      const callerIdList = (await callerIdRes.json()) as any;
      callerIds = callerIdList?.outgoing_caller_ids ?? [];
    }

    // Cross-reference with what's already imported in Nexus so the UI can
    // disable those entries.
    const { data: existing } = await admin
      .from("phone_numbers")
      .select("e164")
      .eq("account_id", accountId);
    const importedSet = new Set((existing ?? []).map((r) => r.e164));

    const ownedPhoneNumbers = new Set(owned.map((n) => n.phone_number));

    return j({
      numbers: [
        ...owned.map((n) => ({
          sid: n.sid,
          phone_number: n.phone_number,
          friendly_name: n.friendly_name,
          capabilities: n.capabilities,
          verified_caller_id_only: false,
          already_imported: importedSet.has(n.phone_number),
        })),
        // Skip caller IDs that are also owned numbers (already listed above).
        ...callerIds
          .filter((c) => !ownedPhoneNumbers.has(c.phone_number))
          .map((c) => ({
            sid: c.sid,
            phone_number: c.phone_number,
            friendly_name: c.friendly_name,
            capabilities: null,
            verified_caller_id_only: true,
            already_imported: importedSet.has(c.phone_number),
          })),
      ],
    });
  } catch (err) {
    if (err instanceof TwilioConfigError) return j({ error: err.message }, err.status);
    console.error("[twilio-numbers-owned] failed", err);
    return j({ error: err instanceof Error ? err.message : "unknown" }, 500);
  }
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
