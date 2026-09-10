import { supabase } from "@/integrations/supabase/client";

export type DebtStatus = "aberto" | "em_negociacao" | "acordado" | "pago" | "baixado" | "cancelado";

export type DebtorRow = {
  contact_id: string;
  name: string | null;
  phone_number: string | null;
  email: string | null;
  doc_type: "cpf" | "cnpj" | null;
  doc_number: string | null;
  debts_count: number;
  valor_aberto: number;
  proximo_vencimento: string | null;
  ultimo_contato: string | null;
  status: DebtStatus | null;
};

export type DebtorFilter = {
  q?: string;
  status?: DebtStatus | "todos";
  page?: number;
  limit?: number;
};

export async function fetchDebtors(
  accountId: string,
  filter: DebtorFilter = {},
): Promise<{ rows: DebtorRow[]; total: number }> {
  const { q, status = "todos", page = 1, limit = 50 } = filter;
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  // Tables debts + debtor_profiles só existem após a migration 20260424180000.
  // Até os tipos serem regenerados, usamos client relaxado.
  const db = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string, opts?: { count?: string }) => {
        eq: (col: string, v: unknown) => any;
      };
    };
  };

  let query = db
    .from("contacts")
    .select(
      "id, name, phone_number, email, last_activity_at, debtor_profiles(doc_type, doc_number), debts(id, valor_atual, vencimento, status)",
      { count: "exact" },
    )
    .eq("account_id", accountId)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    query = query.or(`name.ilike.${term},email.ilike.${term},phone_number.ilike.${term}`);
  }

  const { data, count, error } = await query;
  if (error) throw error;

  const rows: DebtorRow[] = ((data ?? []) as any[]).map((c: any) => {
    const debts = (c.debts ?? []) as Array<{
      id: string;
      valor_atual: number;
      vencimento: string;
      status: DebtStatus;
    }>;
    const abertos = debts.filter((d) => d.status === "aberto" || d.status === "em_negociacao" || d.status === "acordado");
    const valor = abertos.reduce((sum, d) => sum + Number(d.valor_atual || 0), 0);
    const proxVenc = abertos
      .map((d) => d.vencimento)
      .sort()
      .shift() ?? null;

    const profile = Array.isArray(c.debtor_profiles) ? c.debtor_profiles[0] : c.debtor_profiles;
    const overallStatus: DebtStatus | null = abertos.some((d) => d.status === "em_negociacao")
      ? "em_negociacao"
      : abertos.some((d) => d.status === "acordado")
      ? "acordado"
      : abertos.length > 0
      ? "aberto"
      : debts.length > 0
      ? (debts[0].status)
      : null;

    return {
      contact_id: c.id,
      name: c.name,
      phone_number: c.phone_number,
      email: c.email,
      doc_type: profile?.doc_type ?? null,
      doc_number: profile?.doc_number ?? null,
      debts_count: debts.length,
      valor_aberto: valor,
      proximo_vencimento: proxVenc,
      ultimo_contato: c.last_activity_at ?? null,
      status: overallStatus,
    };
  });

  const filtered =
    status === "todos" ? rows : rows.filter((r) => r.status === status);

  return { rows: filtered, total: count ?? 0 };
}

export type CreateDebtorInput = {
  debtor: {
    name: string;
    phone: string;
    email?: string | null;
    doc_number?: string | null;
    external_ref?: string | null;
  };
  debt?: {
    descricao?: string | null;
    valor: string | number;
    vencimento: string;
    origem?: string | null;
    external_ref?: string | null;
  } | null;
};

export async function createDebtor(accountId: string, input: CreateDebtorInput) {
  const { data, error } = await supabase.functions.invoke("debt-create", {
    body: { account_id: accountId, ...input },
  });
  if (error) throw error;
  return data as { ok: boolean; contact_id: string; debt_id: string | null };
}

export async function updateDebt(debtId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("debt-update", {
    body: { debt_id: debtId, patch },
  });
  if (error) throw error;
  return data;
}

export async function syncDebtorsFromProvider(
  accountId: string,
  provider: "hubspot" | "pipedrive" | "asaas",
) {
  const { data, error } = await supabase.functions.invoke(`debtors-sync-${provider}`, {
    body: { account_id: accountId },
  });
  if (error) throw error;
  return data as { ok: boolean; imported: number; skipped: number; total: number; errors: string[] };
}

export async function importDebtorsCsv(csv: string, dryRun = false) {
  const { data, error } = await supabase.functions.invoke("debtors-import-csv", {
    body: { csv, dry_run: dryRun },
  });
  if (error) throw error;
  return data as {
    totalRows: number;
    imported: number;
    skipped_dnc: number;
    skipped_duplicate: number;
    invalid: number;
    errors: { row: number; message: string }[];
    dry_run: boolean;
  };
}

export async function fetchDebtsForContact(contactId: string) {
  const { data, error } = await (supabase as any)
    .from("debts")
    .select("id, descricao, valor_original, valor_atual, vencimento, status, origem, attempts_count, last_call_at, created_at")
    .eq("contact_id", contactId)
    .order("vencimento", { ascending: true });
  if (error) throw error;
  return (data ?? []) as any[];
}

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDoc(type: "cpf" | "cnpj" | null | undefined, num: string | null | undefined): string {
  if (!type || !num) return "—";
  if (type === "cpf" && num.length === 11) {
    return `${num.slice(0, 3)}.${num.slice(3, 6)}.${num.slice(6, 9)}-${num.slice(9)}`;
  }
  if (type === "cnpj" && num.length === 14) {
    return `${num.slice(0, 2)}.${num.slice(2, 5)}.${num.slice(5, 8)}/${num.slice(8, 12)}-${num.slice(12)}`;
  }
  return num;
}

export const DEBT_STATUS_LABEL: Record<DebtStatus, { label: string; tone: string }> = {
  aberto:         { label: "Aberto",         tone: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
  em_negociacao:  { label: "Em negociação",  tone: "bg-violet-500/15 text-violet-300 border-violet-500/20" },
  acordado:       { label: "Acordado",       tone: "bg-sky-500/15 text-sky-300 border-sky-500/20" },
  pago:           { label: "Pago",           tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
  baixado:        { label: "Baixado",        tone: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
  cancelado:      { label: "Cancelado",      tone: "bg-slate-500/15 text-slate-400 border-slate-500/20" },
};
