// Pipedrive REST helpers.
// Docs: https://developers.pipedrive.com/docs/api/v1
//
// Auth: api_token query param (simpler than OAuth for our use case).
// Each helper returns parsed JSON or throws on non-2xx.

export interface PipedriveConfig {
  apiToken: string;
  companyDomain: string;       // e.g. "yourcompany" → yourcompany.pipedrive.com
}

export class PipedriveError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = "PipedriveError";
    this.status = status;
    this.details = details;
  }
}

async function req<T = any>(
  cfg: PipedriveConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: any,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const q = new URLSearchParams({ api_token: cfg.apiToken });
  if (query) {
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, String(v));
  }
  const url = `https://${cfg.companyDomain}.pipedrive.com/api/v1${path}?${q.toString()}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { _raw: text }; }
  if (!r.ok) {
    throw new PipedriveError(r.status, parsed?.error ?? `Pipedrive ${r.status}`, parsed);
  }
  return parsed as T;
}

// ─── Pipelines + Stages ──────────────────────────────────────
export async function listPipelines(cfg: PipedriveConfig) {
  const r = await req<any>(cfg, "GET", "/pipelines");
  return (r.data ?? []) as Array<{ id: number; name: string; active: boolean; order_nr: number }>;
}

export async function listStages(cfg: PipedriveConfig, pipelineId?: number) {
  const r = await req<any>(cfg, "GET", "/stages", undefined, { pipeline_id: pipelineId });
  return (r.data ?? []) as Array<{
    id: number;
    name: string;
    pipeline_id: number;
    order_nr: number;
    active_flag: boolean;
  }>;
}

// ─── Deals ──────────────────────────────────────────────────
export async function getDeal(cfg: PipedriveConfig, id: number | string) {
  const r = await req<any>(cfg, "GET", `/deals/${id}`);
  return r.data;
}

export async function createDeal(
  cfg: PipedriveConfig,
  input: {
    title: string;
    value?: number;
    currency?: string;
    pipeline_id?: number;
    stage_id?: number;
    person_id?: number;
    org_id?: number;
    user_id?: number;
    expected_close_date?: string;
    visible_to?: number;
  },
) {
  const r = await req<any>(cfg, "POST", "/deals", input);
  return r.data;
}

export async function updateDeal(
  cfg: PipedriveConfig,
  id: number | string,
  patch: Record<string, any>,
) {
  const r = await req<any>(cfg, "PUT", `/deals/${id}`, patch);
  return r.data;
}

// ─── Persons (CRM contacts) ─────────────────────────────────
export async function upsertPerson(
  cfg: PipedriveConfig,
  input: {
    name: string;
    email?: string | null;
    phone?: string | null;
    owner_id?: number;
  },
) {
  if (input.email) {
    const search = await req<any>(cfg, "GET", "/persons/search", undefined, {
      term: input.email,
      fields: "email",
      exact_match: 1,
    });
    const hit = search.data?.items?.[0]?.item;
    if (hit?.id) return { id: hit.id, existed: true, data: hit };
  }
  const body: any = { name: input.name };
  if (input.email) body.email = [{ value: input.email, primary: true }];
  if (input.phone) body.phone = [{ value: input.phone, primary: true }];
  if (input.owner_id) body.owner_id = input.owner_id;
  const r = await req<any>(cfg, "POST", "/persons", body);
  return { id: r.data.id, existed: false, data: r.data };
}

// ─── Activities (tasks/calls logged against a deal) ─────────
export async function createActivity(
  cfg: PipedriveConfig,
  input: {
    subject: string;
    type?: string;        // default 'task'
    due_date?: string;    // YYYY-MM-DD
    due_time?: string;    // HH:MM
    duration?: string;    // HH:MM
    note?: string;
    deal_id?: number;
    person_id?: number;
    user_id?: number;
    done?: boolean;
  },
) {
  const body = { ...input, type: input.type ?? "task" };
  const r = await req<any>(cfg, "POST", "/activities", body);
  return r.data;
}

// ─── List deals by stage (used pelo debtors-sync-pipedrive) ─────
export interface PipedriveDealLite {
  id: number;
  title: string;
  value: number | null;
  currency: string | null;
  add_time: string | null;
  expected_close_date: string | null;
  status: string;
  person_id: { value: number; name?: string; email?: Array<{ value: string }>; phone?: Array<{ value: string }> } | null;
}

export async function listDealsByStage(
  cfg: PipedriveConfig,
  stageId: number,
  limit = 100,
  start = 0,
): Promise<PipedriveDealLite[]> {
  const r = await req<any>(cfg, "GET", "/deals", undefined, {
    stage_id: stageId,
    status: "open",
    limit,
    start,
  });
  return (r.data ?? []) as PipedriveDealLite[];
}

export async function getPerson(cfg: PipedriveConfig, id: number) {
  const r = await req<any>(cfg, "GET", `/persons/${id}`);
  return r.data as {
    id: number;
    name: string;
    email?: Array<{ value: string; primary?: boolean }>;
    phone?: Array<{ value: string; primary?: boolean }>;
  } | null;
}
