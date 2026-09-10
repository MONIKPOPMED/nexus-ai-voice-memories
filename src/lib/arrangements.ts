import { supabase } from "@/integrations/supabase/client";

export type ArrangementStatus =
  | "pendente_aprovacao"
  | "pendente"
  | "pago"
  | "atrasado"
  | "cancelado";

export type ArrangementRow = {
  id: string;
  status: ArrangementStatus;
  valor_negociado: number;
  valor_original: number;
  desconto_pct: number;
  metodo: string;
  num_parcelas: number;
  primeiro_vencimento: string;
  asaas_payment_url: string | null;
  asaas_charge_id: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  paid_at: string | null;
  canceled_at: string | null;
  created_at: string;
  source: string | null;
  conversation_id: string | null;
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
  } | null;
  debt: {
    id: string;
    descricao: string | null;
    valor_atual: number;
    valor_original: number;
    vencimento: string;
    origem: string | null;
  } | null;
  call: {
    id: string;
    started_at: string | null;
    duration_seconds: number;
    has_transcript: boolean;
    has_recording: boolean;
  } | null;
};

export type ArrangementsCounts = Record<string, number>;

export async function fetchArrangements(filters: {
  status?: ArrangementStatus | "todos";
  q?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ rows: ArrangementRow[]; total: number; counts: ArrangementsCounts }> {
  const { data, error } = await supabase.functions.invoke("arrangements-list", {
    body: filters,
  });
  if (error) throw error;
  return data as { rows: ArrangementRow[]; total: number; counts: ArrangementsCounts };
}

export async function approveArrangement(args: {
  arrangement_id: string;
  override?: {
    valor_negociado?: number;
    num_parcelas?: number;
    metodo?: string;
    primeiro_vencimento?: string;
  };
}) {
  const { data, error } = await supabase.functions.invoke("arrangement-approve", {
    body: args,
  });
  if (error) throw error;
  return data as { ok: true; arrangement_id: string };
}

export async function rejectArrangement(args: {
  arrangement_id: string;
  reason?: string;
}) {
  const { data, error } = await supabase.functions.invoke("arrangement-reject", {
    body: args,
  });
  if (error) throw error;
  return data as { ok: true; arrangement_id: string };
}

export async function markArrangementPaid(args: {
  arrangement_id: string;
  payment_method?: string;
  note?: string;
}) {
  const { data, error } = await supabase.functions.invoke("arrangement-mark-paid", {
    body: args,
  });
  if (error) throw error;
  return data as { ok: true; arrangement_id: string };
}

export const ARRANGEMENT_STATUS_LABEL: Record<ArrangementStatus, { label: string; tone: string }> = {
  pendente_aprovacao: { label: "Aguarda aprovação", tone: "bg-amber-500/15 text-amber-300 border-amber-500/20" },
  pendente:           { label: "Pendente pagamento", tone: "bg-sky-500/15 text-sky-300 border-sky-500/20" },
  pago:               { label: "Pago",               tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20" },
  atrasado:           { label: "Atrasado",           tone: "bg-rose-500/15 text-rose-300 border-rose-500/20" },
  cancelado:          { label: "Cancelado",          tone: "bg-slate-500/15 text-slate-400 border-slate-500/20" },
};
