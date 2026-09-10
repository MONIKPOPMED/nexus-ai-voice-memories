// HubSpot CRM helpers.
// Docs: https://developers.hubspot.com/docs/api/crm
//
// Auth: private app access_token (Bearer). We do NOT implement the full
// OAuth dance here — customers create a Private App in their HubSpot
// portal and paste the access token into our integration config.

export interface HubSpotConfig {
  accessToken: string;
}

export class HubSpotError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = "HubSpotError";
    this.status = status;
    this.details = details;
  }
}

async function req<T = any>(
  cfg: HubSpotConfig,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: any,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
  const qs = q.toString();
  const url = `https://api.hubapi.com${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }
  if (!r.ok) {
    throw new HubSpotError(r.status, parsed?.message ?? `HubSpot ${r.status}`, parsed);
  }
  return parsed as T;
}

// ─── Pipelines + Stages ──────────────────────────────────────
export async function listDealPipelines(cfg: HubSpotConfig) {
  const r = await req<any>(cfg, "GET", "/crm/v3/pipelines/deals");
  return r.results ?? [];
}

// ─── Contacts ────────────────────────────────────────────────
export async function searchContactByEmail(cfg: HubSpotConfig, email: string) {
  const r = await req<any>(cfg, "POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [
      { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
    ],
    properties: ["email", "firstname", "lastname", "phone"],
    limit: 1,
  });
  return r.results?.[0] ?? null;
}

export async function upsertContact(
  cfg: HubSpotConfig,
  input: { email?: string | null; phone?: string | null; firstname?: string; lastname?: string },
) {
  const properties: Record<string, string> = {};
  if (input.email) properties.email = input.email;
  if (input.phone) properties.phone = input.phone;
  if (input.firstname) properties.firstname = input.firstname;
  if (input.lastname) properties.lastname = input.lastname;

  if (input.email) {
    const existing = await searchContactByEmail(cfg, input.email);
    if (existing) {
      await req(cfg, "PATCH", `/crm/v3/objects/contacts/${existing.id}`, { properties });
      return { id: existing.id, existed: true };
    }
  }
  const created = await req<any>(cfg, "POST", "/crm/v3/objects/contacts", { properties });
  return { id: created.id, existed: false };
}

// ─── Deals ───────────────────────────────────────────────────
export async function getDeal(cfg: HubSpotConfig, id: string) {
  return req<any>(cfg, "GET", `/crm/v3/objects/deals/${id}`, undefined, {
    properties: "dealname,amount,dealstage,pipeline,closedate,hs_deal_stage_probability,dealtype,description",
  });
}

export async function createDeal(
  cfg: HubSpotConfig,
  input: {
    dealname: string;
    amount?: number;
    pipeline?: string;
    dealstage?: string;
    closedate?: string;
    hubspot_owner_id?: string;
    contact_id?: string;
  },
) {
  const properties: Record<string, any> = {
    dealname: input.dealname,
  };
  if (input.amount !== undefined) properties.amount = input.amount;
  if (input.pipeline) properties.pipeline = input.pipeline;
  if (input.dealstage) properties.dealstage = input.dealstage;
  if (input.closedate) properties.closedate = input.closedate;
  if (input.hubspot_owner_id) properties.hubspot_owner_id = input.hubspot_owner_id;

  const body: Record<string, any> = { properties };
  if (input.contact_id) {
    body.associations = [
      {
        to: { id: input.contact_id },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }],
      },
    ];
  }
  return req<any>(cfg, "POST", "/crm/v3/objects/deals", body);
}

export async function updateDeal(cfg: HubSpotConfig, id: string, properties: Record<string, any>) {
  return req<any>(cfg, "PATCH", `/crm/v3/objects/deals/${id}`, { properties });
}

// ─── Engagements / Activities ────────────────────────────────
// HubSpot calls these "engagements" (legacy v1). For notes we use the new
// /crm/v3/objects/notes. Simpler: we log as notes attached to a contact or deal.
export async function createNote(
  cfg: HubSpotConfig,
  input: {
    body: string;
    contact_id?: string;
    deal_id?: string;
    timestamp?: number;     // ms
  },
) {
  const body: Record<string, any> = {
    properties: {
      hs_note_body: input.body,
      hs_timestamp: input.timestamp ?? Date.now(),
    },
  };
  const associations: any[] = [];
  if (input.contact_id) {
    associations.push({
      to: { id: input.contact_id },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
    });
  }
  if (input.deal_id) {
    associations.push({
      to: { id: input.deal_id },
      types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }],
    });
  }
  if (associations.length) body.associations = associations;
  return req<any>(cfg, "POST", "/crm/v3/objects/notes", body);
}
