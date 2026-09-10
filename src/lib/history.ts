import { supabase } from "@/integrations/supabase/client";

export type CallOutcome =
  | "cpc" | "cpct" | "nao_atende" | "caixa_postal" | "numero_errado"
  | "recusa" | "dnc_solicitado" | "acordo" | "pago" | "sem_resultado";

export type CallRow = {
  id: string;
  started_at: string | null;
  ended_at: string | null;
  direction: "inbound" | "outbound";
  status: string;
  collection_outcome: CallOutcome | null;
  from_number: string;
  to_number: string;
  duration_seconds: number;
  total_cost_cents: number;
  has_recording: boolean;
  has_transcript: boolean;
  transcription_status: string | null;
  debtor_name: string | null;
  contact_id: string | null;
  arrangement: {
    id: string;
    valor: number;
    status: string;
    num_parcelas: number;
  } | null;
  campaign_id: string | null;
  debt_id: string | null;
};

export type TranscriptTurn = {
  role?: string;
  speaker?: string;
  content?: string;
  message?: string;
  text?: string;
  timestamp?: string;
  time_in_call_secs?: number;
};

export type CallDetail = {
  call: {
    id: string;
    direction: string;
    status: string;
    collection_outcome: CallOutcome | null;
    from_number: string;
    to_number: string;
    duration_seconds: number;
    total_cost_cents: number;
    recording_url: string | null;
    transcript: TranscriptTurn[] | string;
    started_at: string | null;
    ended_at: string | null;
    provider: string;
    provider_call_sid: string | null;
    campaign_id: string | null;
    metadata: Record<string, unknown>;
  };
  contact: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  arrangement: {
    id: string;
    valor_negociado: number;
    metodo: string;
    num_parcelas: number;
    primeiro_vencimento: string;
    status: string;
    asaas_payment_url: string | null;
  } | null;
  debt: {
    id: string;
    descricao: string | null;
    valor_atual: number;
    vencimento: string;
    origem: string | null;
  } | null;
  persona: { id: string; name: string } | null;
};

export type ListFilters = {
  q?: string;
  outcome?: CallOutcome;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export async function fetchCalls(filters: ListFilters = {}): Promise<{ rows: CallRow[]; total: number }> {
  const { data, error } = await supabase.functions.invoke("collection-calls-list", {
    body: filters,
  });
  if (error) throw error;
  return data as { rows: CallRow[]; total: number };
}

export async function fetchCallDetail(callId: string): Promise<CallDetail> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error("sem sessão");

  const res = await fetch(
    `${supabaseUrl}/functions/v1/collection-calls-list?call_id=${encodeURIComponent(callId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CallDetail;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCostBRL(cents: number | null | undefined): string {
  if (!cents) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

export function normalizeTranscript(
  transcript: TranscriptTurn[] | string | null | undefined,
): { role: string; content: string; timestamp?: number }[] {
  if (!transcript) return [];
  if (typeof transcript === "string") {
    // Formato simples: "role: content\nrole: content"
    return transcript
      .split("\n")
      .map((line) => {
        const m = line.match(/^([^:]+):\s*(.*)$/);
        if (!m) return { role: "?", content: line.trim() };
        return { role: m[1].trim().toLowerCase(), content: m[2].trim() };
      })
      .filter((t) => t.content.length > 0);
  }
  return transcript.map((t) => ({
    role: (t.role ?? t.speaker ?? "?").toLowerCase(),
    content: String(t.content ?? t.message ?? t.text ?? ""),
    timestamp: t.time_in_call_secs,
  }));
}
