// Cliente Asaas mínimo para listar cobranças e atualizar status.
// Docs: https://docs.asaas.com/reference
// Auth: header `access_token: <api_key>`.

export interface AsaasConfig {
  apiKey: string;
  sandbox?: boolean;
}

export class AsaasError extends Error {
  readonly status: number;
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "AsaasError";
    this.status = status;
    this.details = details;
  }
}

function baseUrl(cfg: AsaasConfig): string {
  return cfg.sandbox
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";
}

// deno-lint-ignore no-explicit-any
async function req<T = any>(
  cfg: AsaasConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  query?: Record<string, string | number | undefined>,
): Promise<T> {
  const q = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) q.set(k, String(v));
    }
  }
  const qs = q.toString();
  const url = `${baseUrl(cfg)}${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: {
      access_token: cfg.apiKey,
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
    throw new AsaasError(r.status, parsed?.errors?.[0]?.description ?? `Asaas ${r.status}`, parsed);
  }
  return parsed as T;
}

export interface AsaasPayment {
  id: string;
  customer: string;
  value: number;
  netValue: number;
  description?: string;
  status: string; // PENDING | RECEIVED | OVERDUE | CONFIRMED | CANCELED | REFUNDED ...
  dueDate: string; // YYYY-MM-DD
  externalReference?: string;
}

export interface AsaasCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  cpfCnpj?: string;
}

// Lista cobranças PENDING + OVERDUE (default). Pagina via `offset`.
export async function listPendingPayments(
  cfg: AsaasConfig,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ data: AsaasPayment[]; hasMore: boolean }> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  // Asaas aceita múltiplos status separados por vírgula
  const r = await req<{ data: AsaasPayment[]; hasMore: boolean }>(
    cfg,
    "GET",
    "/payments",
    undefined,
    { status: "PENDING,OVERDUE", limit, offset },
  );
  return { data: r.data ?? [], hasMore: Boolean(r.hasMore) };
}

export async function getCustomer(cfg: AsaasConfig, id: string): Promise<AsaasCustomer> {
  return req<AsaasCustomer>(cfg, "GET", `/customers/${id}`);
}

export async function deletePayment(cfg: AsaasConfig, id: string): Promise<void> {
  await req(cfg, "DELETE", `/payments/${id}`);
}

// Marca cobrança como recebida em dinheiro (não cria nova fatura).
export async function receiveInCash(
  cfg: AsaasConfig,
  id: string,
  value: number,
  paymentDate: string, // YYYY-MM-DD
): Promise<void> {
  await req(cfg, "POST", `/payments/${id}/receiveInCash`, {
    paymentDate,
    value,
    notifyCustomer: false,
  });
}
