import { supabase } from "@/integrations/supabase/client";

export type TodayMetrics = {
  valor_recuperado: number;
  chamadas: number;
  cpc: number;
  taxa_contato_pct: number;
  acordos: number;
};

export type ActiveCampaign = {
  id: string;
  name: string;
  status: string;
  total: number;
  placed: number;
  connected: number;
  failed: number;
  escalated: number;
  started_at: string | null;
};

export type PendingArrangement = {
  id: string;
  contact_name: string;
  valor: number;
  primeiro_vencimento: string;
  num_parcelas: number;
  status: "pendente" | "pendente_aprovacao";
  source: string | null;
};

export type PendingApproval = {
  id: string;
  contact_name: string;
  valor: number;
  primeiro_vencimento: string;
  num_parcelas: number;
  source: string | null;
  created_at: string;
  voice_call_id: string | null;
};

export type ActivityItem = {
  kind: "call" | "payment" | "arrangement";
  at: string;
  label: string;
  subtitle: string;
  value?: number;
  outcome?: string;
};

export type DashboardData = {
  today: TodayMetrics;
  yesterday: TodayMetrics;
  month: { valor_recuperado: number; acordos: number; ticket_medio: number };
  carteira: { valor_aberto: number; dividas_abertas: number; em_negociacao: number };
  active_campaigns: ActiveCampaign[];
  pending_arrangements: PendingArrangement[];
  pending_approval: PendingApproval[];
  recent_activity: ActivityItem[];
  outcomes_7d: { date: string; counts: Record<string, number> }[];
  top_motivos_nao_contato: { outcome: string; count: number }[];
  integrations_status: {
    company_settings: boolean;
    whatsapp: boolean;
    asaas: boolean;
  };
};

export async function fetchDashboard(): Promise<DashboardData> {
  const { data, error } = await supabase.functions.invoke("collection-dashboard-summary", {
    body: {},
  });
  if (error) throw error;
  return data as DashboardData;
}

export const OUTCOME_LABEL: Record<string, string> = {
  cpc: "Contato c/ devedor",
  cpct: "Contato c/ terceiro",
  nao_atende: "Não atende",
  caixa_postal: "Caixa postal",
  numero_errado: "Número errado",
  recusa: "Recusa",
  dnc_solicitado: "Pediu não ligar",
  acordo: "Acordo fechado",
  pago: "Já pago",
  sem_resultado: "Sem resultado",
};

export const OUTCOME_TONE: Record<string, string> = {
  acordo: "text-emerald-700 bg-emerald-100 border border-emerald-300 dark:text-emerald-200 dark:bg-emerald-500/20 dark:border-emerald-500/40",
  pago: "text-emerald-700 bg-emerald-100 border border-emerald-300 dark:text-emerald-200 dark:bg-emerald-500/20 dark:border-emerald-500/40",
  cpc: "text-violet-700 bg-violet-100 border border-violet-300 dark:text-violet-200 dark:bg-violet-500/20 dark:border-violet-500/40",
  cpct: "text-amber-800 bg-amber-100 border border-amber-300 dark:text-amber-200 dark:bg-amber-500/20 dark:border-amber-500/40",
  nao_atende: "text-slate-700 bg-slate-100 border border-slate-300 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30",
  caixa_postal: "text-slate-700 bg-slate-100 border border-slate-300 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30",
  numero_errado: "text-rose-700 bg-rose-100 border border-rose-300 dark:text-rose-200 dark:bg-rose-500/20 dark:border-rose-500/40",
  recusa: "text-rose-700 bg-rose-100 border border-rose-300 dark:text-rose-200 dark:bg-rose-500/20 dark:border-rose-500/40",
  dnc_solicitado: "text-rose-700 bg-rose-100 border border-rose-300 dark:text-rose-200 dark:bg-rose-500/20 dark:border-rose-500/40",
  sem_resultado: "text-slate-700 bg-slate-100 border border-slate-300 dark:text-slate-300 dark:bg-slate-500/15 dark:border-slate-500/30",
};

export const CAMPAIGN_STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  running:    { label: "Rodando",    tone: "text-emerald-300 bg-emerald-500/15 border-emerald-500/20" },
  scheduled:  { label: "Agendada",   tone: "text-sky-300 bg-sky-500/15 border-sky-500/20" },
  paused:     { label: "Pausada",    tone: "text-amber-300 bg-amber-500/15 border-amber-500/20" },
  completed:  { label: "Concluída",  tone: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  failed:     { label: "Falhou",     tone: "text-rose-300 bg-rose-500/15 border-rose-500/20" },
  canceled:   { label: "Cancelada",  tone: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
  draft:      { label: "Rascunho",   tone: "text-slate-400 bg-slate-500/10 border-slate-500/20" },
};

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatBRLCompact(value: number | null | undefined): string {
  if (value == null) return "R$ 0";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `R$ ${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return formatBRL(value);
}

export function deltaPercent(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return Math.round(((current - prior) / prior) * 100);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
