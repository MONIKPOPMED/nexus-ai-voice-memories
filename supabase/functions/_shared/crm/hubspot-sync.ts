// Helpers de leitura usados pelo sync de devedores.
// Aproveita o cliente em hubspot.ts e adiciona busca de deals por estágio
// + leitura do contato associado.
import type { HubSpotConfig } from "./hubspot.ts";

// deno-lint-ignore no-explicit-any
async function hs<T = any>(
  cfg: HubSpotConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const r = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  // deno-lint-ignore no-explicit-any
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { _raw: text };
  }
  if (!r.ok) {
    throw new Error(`HubSpot ${r.status}: ${parsed?.message ?? text}`);
  }
  return parsed as T;
}

export interface HubSpotDealLite {
  id: string;
  dealname: string;
  amount: number | null;
  closedate: string | null;
  description: string | null;
  contactId: string | null;
}

// Busca todos deals em um stage específico (com paginação).
export async function listDealsByStage(
  cfg: HubSpotConfig,
  pipelineId: string,
  stageId: string,
  limit = 100,
): Promise<HubSpotDealLite[]> {
  // deno-lint-ignore no-explicit-any
  const r = await hs<any>(cfg, "POST", "/crm/v3/objects/deals/search", {
    filterGroups: [
      {
        filters: [
          { propertyName: "pipeline", operator: "EQ", value: pipelineId },
          { propertyName: "dealstage", operator: "EQ", value: stageId },
        ],
      },
    ],
    properties: ["dealname", "amount", "closedate", "description"],
    limit,
  });

  const deals: HubSpotDealLite[] = [];
  for (const d of r.results ?? []) {
    // Busca contato associado (1ª associação)
    let contactId: string | null = null;
    try {
      // deno-lint-ignore no-explicit-any
      const assoc = await hs<any>(
        cfg,
        "GET",
        `/crm/v3/objects/deals/${d.id}/associations/contacts`,
      );
      contactId = assoc.results?.[0]?.id ?? null;
    } catch {
      // ignora — deal sem contato
    }

    deals.push({
      id: String(d.id),
      dealname: String(d.properties?.dealname ?? "Deal sem nome"),
      amount: d.properties?.amount ? Number(d.properties.amount) : null,
      closedate: d.properties?.closedate ?? null,
      description: d.properties?.description ?? null,
      contactId,
    });
  }
  return deals;
}

export interface HubSpotContactLite {
  id: string;
  email: string | null;
  phone: string | null;
  firstname: string | null;
  lastname: string | null;
}

export async function getContact(
  cfg: HubSpotConfig,
  id: string,
): Promise<HubSpotContactLite | null> {
  try {
    // deno-lint-ignore no-explicit-any
    const r = await hs<any>(
      cfg,
      "GET",
      `/crm/v3/objects/contacts/${id}?properties=email,phone,mobilephone,firstname,lastname`,
    );
    return {
      id: String(r.id),
      email: r.properties?.email ?? null,
      phone: r.properties?.mobilephone ?? r.properties?.phone ?? null,
      firstname: r.properties?.firstname ?? null,
      lastname: r.properties?.lastname ?? null,
    };
  } catch {
    return null;
  }
}
