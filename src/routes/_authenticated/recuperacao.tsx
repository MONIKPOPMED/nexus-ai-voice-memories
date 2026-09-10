import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  PhoneCall,
  TrendingUp,
  Handshake,
  Wallet,
  Users,
  Target,
  Loader2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  fetchDashboard,
  formatBRL,
  OUTCOME_LABEL,
  type DashboardData,
} from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/PageHeader";
import { WalletSyncCard } from "@/components/wallet/WalletSyncCard";

export const Route = createFileRoute("/_authenticated/recuperacao")({
  head: () => ({
    meta: [
      { title: "Recuperação — cobrAI" },
      { name: "description", content: "Análise detalhada de recuperação: 7 dias, top motivos, ticket médio." },
    ],
  }),
  component: RecuperacaoPage,
});

function RecuperacaoPage() {
  const { accountId } = useAccount();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    if (inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;
    try {
      const s = await fetchDashboard();
      setData(s);
    } catch (e) {
      console.warn("[recuperacao] refresh failed", e);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Cobrança"
        title="Recuperação"
        description="Análise de 7 dias: taxa de contato, acordos fechados, motivos de não-contato e ticket médio."
      />

      <div className="px-6 py-6">
        {loading || !data ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Faixa de sync com integrações de carteira (HubSpot/Pipedrive/Asaas) */}
            {accountId && (
              <div className="mb-4">
                <WalletSyncCard accountId={accountId} variant="compact" />
              </div>
            )}

            {/* Faixa "Acordos aguardando aprovação" */}
            {data.pending_approval.length > 0 && (
              <Link
                to="/acordos"
                search={{ status: "pendente_aprovacao" }}
                className="mb-4 flex items-center justify-between rounded-lg border border-amber-500/50 bg-amber-500/[0.12] px-4 py-3 transition-colors hover:bg-amber-500/[0.18]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15 text-amber-700">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-amber-900">
                      {data.pending_approval.length} acordo{data.pending_approval.length !== 1 ? "s" : ""} aguardando sua aprovação
                    </div>
                    <div className="text-[11px] text-amber-700/80">
                      Total: {formatBRL(data.pending_approval.reduce((s, r) => s + r.valor, 0))} · extraídos das transcrições
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-800">
                  Revisar <ArrowRight className="h-3.5 w-3.5" />
                </div>
              </Link>
            )}

            {/* Top KPIs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KPI
                label="Chamadas hoje"
                value={String(data.today.chamadas)}
                icon={PhoneCall}
                tone="text-violet-700"
                footnote={`${data.today.cpc} com o devedor`}
              />
              <KPI
                label="Taxa de contato"
                value={`${data.today.taxa_contato_pct}%`}
                icon={Target}
                tone="text-sky-700"
                footnote="CPC / total do dia"
              />
              <KPI
                label="Acordos hoje"
                value={String(data.today.acordos)}
                icon={Handshake}
                tone="text-emerald-700"
                footnote={`${data.month.acordos} no mês`}
              />
              <KPI
                label="Recuperado no mês"
                value={formatBRL(data.month.valor_recuperado)}
                icon={TrendingUp}
                tone="text-fuchsia-700"
                footnote={
                  data.month.ticket_medio > 0
                    ? `Ticket médio ${formatBRL(data.month.ticket_medio)}`
                    : "sem acordos no mês"
                }
              />
            </div>

            {/* Carteira */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <KPI
                label="Dívidas abertas"
                value={String(data.carteira.dividas_abertas)}
                icon={Wallet}
                tone="text-amber-700"
              />
              <KPI
                label="Valor total da carteira"
                value={formatBRL(data.carteira.valor_aberto)}
                icon={Users}
                tone="text-indigo-700"
              />
            </div>

            {/* 7d outcomes + top motivos */}
            <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Resultados dos últimos 7 dias">
                <Outcomes7d data={data.outcomes_7d} />
              </Panel>
              <Panel title="Por que não conseguimos contato">
                <TopMotivos data={data.top_motivos_nao_contato} />
              </Panel>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  icon: Icon,
  tone,
  footnote,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  footnote?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {footnote && <div className="mt-1 text-[11px] text-muted-foreground">{footnote}</div>}
    </div>
  );
}

function Panel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
      <h3 className="mb-4 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Outcomes7d({ data }: { data: DashboardData["outcomes_7d"] }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sem chamadas registradas.</p>;
  }
  const maxCount = Math.max(1, ...data.map((d) => Object.values(d.counts).reduce((a, b) => a + b, 0)));

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
        const acordo = d.counts.acordo ?? 0;
        const cpc = d.counts.cpc ?? 0;
        const acordoPct = total > 0 ? (acordo / total) * 100 : 0;
        const cpcPct = total > 0 ? (cpc / total) * 100 : 0;
        const outrosPct = 100 - acordoPct - cpcPct;

        return (
          <div key={d.date} className="text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-muted-foreground">
                {new Date(d.date).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })}
              </span>
              <span className="tabular-nums text-muted-foreground">{total}</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded bg-white/[0.03]">
              <div className="bg-emerald-500/70" style={{ width: `${(total / maxCount) * acordoPct}%` }} title={`Acordos: ${acordo}`} />
              <div className="bg-violet-500/70" style={{ width: `${(total / maxCount) * cpcPct}%` }} title={`CPC: ${cpc}`} />
              <div className="bg-slate-600/40" style={{ width: `${(total / maxCount) * outrosPct}%` }} title="Outros" />
            </div>
          </div>
        );
      })}
      <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
        <Legend color="bg-emerald-500/70" label="Acordos" />
        <Legend color="bg-violet-500/70" label="CPC" />
        <Legend color="bg-slate-600/40" label="Outros" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("h-2 w-2 rounded-sm", color)} />
      {label}
    </span>
  );
}

function TopMotivos({ data }: { data: DashboardData["top_motivos_nao_contato"] }) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sem eventos nos últimos 7 dias.</p>;
  }
  const total = data.reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-2">
      {data.slice(0, 6).map((r) => {
        const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
        return (
          <div key={r.outcome} className="text-xs">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-slate-700">{OUTCOME_LABEL[r.outcome] ?? r.outcome}</span>
              <span className="tabular-nums text-muted-foreground">
                {r.count} <span className="text-[10px] opacity-60">({pct}%)</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-white/[0.03]">
              <div className="h-full bg-gradient-to-r from-rose-500/60 to-amber-500/60" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
