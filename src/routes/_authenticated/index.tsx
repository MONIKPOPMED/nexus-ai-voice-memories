import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  PhoneCall,
  TrendingUp,
  TrendingDown,
  Handshake,
  Wallet,
  Upload,
  PlayCircle,
  PauseCircle,
  Bot,
  Target,
  ArrowUpRight,
  ArrowRight,
  Loader2,
  Settings,
  Phone as PhoneIcon,
  Mail,
  MessageCircle,
  CreditCard,
  Volume2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Clock,
  Megaphone,
  Users,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { useAccount } from "@/lib/account-context";
import {
  fetchDashboard,
  formatBRL,
  formatBRLCompact,
  deltaPercent,
  timeAgo,
  greeting,
  OUTCOME_LABEL,
  CAMPAIGN_STATUS_LABEL,
  type DashboardData,
} from "@/lib/dashboard";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Painel — cobrAI" },
      {
        name: "description",
        content: "Resumo operacional: chamadas, acordos, recuperação e saúde do sistema.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { accountId } = useAccount();
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const [fetchError, setFetchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current || document.visibilityState === "hidden") return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    inFlight.current = true;
    try {
      const s = await fetchDashboard();
      setData(s);
      setLastSyncAt(new Date());
      setFetchError(null);
    } catch (e) {
      console.warn("[dashboard] refresh failed", e);
      setFetchError(e instanceof Error ? e.message : "Falha ao carregar");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const firstName = useMemo(() => {
    const name = (user?.user_metadata?.name as string | undefined) ?? user?.email?.split("@")[0];
    return (name ?? "").split(/[\s.]+/)[0] || "";
  }, [user]);

  const isFirstUse =
    !loading &&
    (!data ||
      (data.carteira.dividas_abertas === 0 &&
        data.today.chamadas === 0 &&
        data.active_campaigns.length === 0));

  return (
    <div className="flex flex-col">
      {/* Hero contextual */}
      <ContextualHero
        loading={loading}
        data={data}
        firstName={firstName}
        isFirstUse={isFirstUse}
        lastSyncAt={lastSyncAt}
      />

      <div className="flex flex-col gap-5 px-6 py-6">
        {loading && !data ? (
          <DashboardSkeleton />
        ) : fetchError && !data ? (
          <DashboardError message={fetchError} onRetry={refresh} />
        ) : isFirstUse || !data ? (
          <FirstUseState />
        ) : (
          <>
            {/* KPIs */}
            <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <BigKPI
                label="Recuperado hoje"
                value={formatBRL(data.today.valor_recuperado)}
                delta={deltaPercent(data.today.valor_recuperado, data.yesterday.valor_recuperado)}
                showDelta={data.yesterday.valor_recuperado > 0 || data.today.valor_recuperado > 0}
                icon={Wallet}
                accent="success"
                hint="vs ontem"
              />
              <BigKPI
                label="Chamadas hoje"
                value={String(data.today.chamadas)}
                delta={deltaPercent(data.today.chamadas, data.yesterday.chamadas)}
                showDelta={data.yesterday.chamadas > 0}
                icon={PhoneCall}
                accent="primary"
                hint={`${data.today.cpc} contatos efetivos`}
              />
              <BigKPI
                label="Acordos hoje"
                value={String(data.today.acordos)}
                delta={deltaPercent(data.today.acordos, data.yesterday.acordos)}
                showDelta={data.yesterday.acordos > 0}
                icon={Handshake}
                accent="accent"
                hint={`${data.month.acordos} no mês`}
              />
              <BigKPI
                label="Taxa de contato"
                value={`${data.today.taxa_contato_pct}%`}
                delta={data.today.taxa_contato_pct - data.yesterday.taxa_contato_pct}
                showDelta={data.yesterday.taxa_contato_pct > 0}
                deltaUnit="pp"
                icon={Target}
                accent="warning"
                hint="CPC / total"
              />
            </section>

            {/* Ações urgentes + Carteira */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel
                title="Ações da semana"
                subtitle="Acordos pendentes e próximos vencimentos"
                className="lg:col-span-2"
                action={
                  <Link
                    to="/acordos"
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Ver acordos <ArrowUpRight className="h-3 w-3" />
                  </Link>
                }
              >
                <UrgentActions
                  pending={data.pending_approval}
                  arrangements={data.pending_arrangements}
                />
              </Panel>

              <div className="flex flex-col gap-4">
                <Panel title="Sua carteira">
                  <CarteiraCard data={data} />
                </Panel>
              </div>
            </section>

            {/* Atividade + Saúde + Campanhas */}
            <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Panel
                title="Atividade recente"
                className="lg:col-span-2"
                action={
                  <Link
                    to="/recuperacao"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Análise completa <ArrowUpRight className="h-3 w-3" />
                  </Link>
                }
              >
                <ActivityFeed data={data.recent_activity} />
              </Panel>

              <div className="flex flex-col gap-4">
                <Panel
                  title="Campanhas"
                  action={
                    <Link
                      to="/voice-campaigns"
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Todas <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  }
                >
                  <CampaignsCompact data={data.active_campaigns} />
                </Panel>
                <Panel title="Saúde do sistema">
                  <IntegrationsHealth data={data.integrations_status} />
                </Panel>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Hero contextual — adapta o CTA conforme o estado
// ──────────────────────────────────────────────────────────────

function ContextualHero({
  loading,
  data,
  firstName,
  isFirstUse,
  lastSyncAt,
}: {
  loading: boolean;
  data: DashboardData | null;
  firstName: string;
  isFirstUse: boolean;
  lastSyncAt: Date | null;
}) {
  const pendingCount = data?.pending_approval.length ?? 0;
  const pendingTotal = data?.pending_approval.reduce((s, r) => s + r.valor, 0) ?? 0;
  const runningCampaigns = data?.active_campaigns.filter((c) => c.status === "running") ?? [];

  // Estado primário do hero
  const heroState: "pending" | "running" | "idle" | "first" =
    isFirstUse ? "first" :
    pendingCount > 0 ? "pending" :
    runningCampaigns.length > 0 ? "running" :
    "idle";

  const subtitle = (() => {
    if (loading && !data) return "Carregando seus números…";
    if (heroState === "first") return "Vamos configurar sua primeira campanha de cobrança.";
    if (heroState === "pending") return `${pendingCount} acordo${pendingCount > 1 ? "s" : ""} aguardando sua aprovação · ${formatBRL(pendingTotal)}`;
    if (heroState === "running") return `${runningCampaigns.length} campanha${runningCampaigns.length > 1 ? "s" : ""} rodando agora.`;
    return "Tudo tranquilo por aqui. Que tal disparar uma nova campanha?";
  })();

  return (
    <div className="border-b border-border/60 bg-gradient-to-br from-accent/[0.06] via-background to-background">
      <div className="px-6 py-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              <span>Painel</span>
              {lastSyncAt && (
                <span className="font-normal tracking-normal text-muted-foreground/60 normal-case">
                  · atualizado {timeAgo(lastSyncAt.toISOString())}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
              {greeting()}{firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          {/* CTA contextual */}
          <div className="flex flex-wrap items-center gap-2">
            {heroState === "pending" && (
              <Link
                to="/acordos"
                search={{ status: "pendente_aprovacao" }}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-lg bg-[hsl(var(--warning))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--warning-foreground))] shadow-[0_4px_14px_-4px_hsl(var(--warning)/0.5)] transition-all hover:shadow-[0_6px_20px_-4px_hsl(var(--warning)/0.6)]"
              >
                <span className="absolute -left-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 animate-ping rounded-full bg-[hsl(var(--warning-foreground))]/60" />
                <AlertCircle className="h-4 w-4" />
                Revisar {pendingCount} acordo{pendingCount > 1 ? "s" : ""}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
            {(heroState === "idle" || heroState === "first") && (
              <Link
                to="/contacts"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2.5 text-xs font-medium text-foreground/80 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
              >
                <Upload className="h-3.5 w-3.5" />
                Importar carteira
              </Link>
            )}
            <Link
              to="/voice-campaigns"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs font-semibold transition-all",
                heroState === "pending"
                  ? "border border-border bg-card text-foreground/80 hover:bg-muted"
                  : "bg-gradient-to-r from-accent to-[hsl(var(--accent-primary-hover))] text-accent-foreground shadow-[0_4px_14px_-4px_hsl(var(--accent)/0.45)] hover:shadow-[0_6px_20px_-4px_hsl(var(--accent)/0.55)]"
              )}
            >
              <Megaphone className="h-3.5 w-3.5" />
              Nova campanha
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// KPI
// ──────────────────────────────────────────────────────────────

const ACCENT_STYLES = {
  success: {
    icon: "text-[hsl(var(--success))]",
    iconBg: "bg-[hsl(var(--success)/0.12)]",
    glow: "from-[hsl(var(--success)/0.08)]",
  },
  primary: {
    icon: "text-primary",
    iconBg: "bg-primary/10",
    glow: "from-primary/[0.06]",
  },
  accent: {
    icon: "text-accent",
    iconBg: "bg-accent/10",
    glow: "from-accent/[0.08]",
  },
  warning: {
    icon: "text-[hsl(var(--warning))]",
    iconBg: "bg-[hsl(var(--warning)/0.12)]",
    glow: "from-[hsl(var(--warning)/0.06)]",
  },
} as const;

function BigKPI({
  label,
  value,
  delta,
  showDelta,
  icon: Icon,
  accent,
  hint,
  deltaUnit = "%",
}: {
  label: string;
  value: string;
  delta: number | null;
  showDelta: boolean;
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENT_STYLES;
  hint?: string;
  deltaUnit?: "%" | "pp";
}) {
  const style = ACCENT_STYLES[accent];
  const renderDelta = showDelta && delta !== null && Number.isFinite(delta);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-border/80 hover:shadow-md">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70", style.glow)} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
          <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", style.iconBg)}>
            <Icon className={cn("h-3.5 w-3.5", style.icon)} />
          </div>
        </div>
        <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight text-foreground tabular-nums">
          {value}
        </div>
        <div className="mt-2.5 flex items-center gap-2 text-[11px]">
          {renderDelta ? (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium tabular-nums",
                delta! > 0
                  ? "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))]"
                  : delta! < 0
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {delta! > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : delta! < 0 ? <TrendingDown className="h-2.5 w-2.5" /> : null}
              {delta! > 0 ? "+" : ""}{delta}{deltaUnit}
            </span>
          ) : (
            <span className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              novo
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Panel
// ──────────────────────────────────────────────────────────────

function Panel({
  children,
  title,
  subtitle,
  action,
  className,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5 shadow-sm", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// Ações urgentes (aprovação + vencimentos unificados)
// ──────────────────────────────────────────────────────────────

function UrgentActions({
  pending,
  arrangements,
}: {
  pending: DashboardData["pending_approval"];
  arrangements: DashboardData["pending_arrangements"];
}) {
  const pendingTotal = pending.reduce((s, r) => s + r.valor, 0);
  const weekTotal = arrangements.reduce((s, r) => s + r.valor, 0);
  const today = new Date().toISOString().slice(0, 10);

  // Agrupa vencimentos por data
  const byDate = arrangements.reduce<Record<string, typeof arrangements>>((acc, r) => {
    (acc[r.primeiro_vencimento] ??= []).push(r);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  if (pending.length === 0 && arrangements.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
          <Calendar className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Nada pendente esta semana.</p>
        <p className="text-[11px] text-muted-foreground">
          Acordos novos aparecem aqui automaticamente.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo da semana */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className={cn(
          "rounded-lg border p-3",
          pending.length > 0
            ? "border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.08)]"
            : "border-border bg-muted/30"
        )}>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Pra revisar
          </div>
          <div className={cn(
            "mt-1 text-lg font-semibold tabular-nums",
            pending.length > 0 ? "text-[hsl(var(--warning-foreground))]" : "text-foreground"
          )}>
            {formatBRL(pendingTotal)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {pending.length} acordo{pending.length !== 1 ? "s" : ""}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-[hsl(var(--success)/0.06)] p-3">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            A receber (7 dias)
          </div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-[hsl(var(--success))]">
            {formatBRL(weekTotal)}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {arrangements.length} acordo{arrangements.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Lista urgente: pendentes primeiro */}
      {pending.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--warning-foreground))]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--warning))] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[hsl(var(--warning))]" />
            </span>
            Aguardando aprovação
          </div>
          {pending.slice(0, 3).map((r) => (
            <Link
              key={r.id}
              to="/acordos"
              search={{ status: "pendente_aprovacao" }}
              className="group flex items-center gap-3 rounded-lg border border-[hsl(var(--warning)/0.25)] bg-[hsl(var(--warning)/0.04)] px-3 py-2.5 transition-all hover:border-[hsl(var(--warning)/0.5)] hover:bg-[hsl(var(--warning)/0.08)]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--warning)/0.15)]">
                {r.source === "whatsapp_extraction" ? (
                  <MessageCircle className="h-3.5 w-3.5 text-[hsl(var(--warning-foreground))]" />
                ) : r.source === "transcript_extraction" ? (
                  <PhoneIcon className="h-3.5 w-3.5 text-[hsl(var(--warning-foreground))]" />
                ) : (
                  <Handshake className="h-3.5 w-3.5 text-[hsl(var(--warning-foreground))]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{r.contact_name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {r.num_parcelas}x · 1º vence {new Date(r.primeiro_vencimento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {formatBRLCompact(r.valor)}
                </div>
                <div className="flex items-center justify-end gap-0.5 text-[10px] font-medium text-[hsl(var(--warning-foreground))]/70 group-hover:text-[hsl(var(--warning-foreground))]">
                  Revisar <ChevronRight className="h-2.5 w-2.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          ))}
          {pending.length > 3 && (
            <Link
              to="/acordos"
              search={{ status: "pendente_aprovacao" }}
              className="block py-1 text-center text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              + {pending.length - 3} acordo{pending.length - 3 !== 1 ? "s" : ""} aguardando
            </Link>
          )}
        </div>
      )}

      {/* Timeline de vencimentos */}
      {arrangements.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Próximos vencimentos
          </div>
          {dates.slice(0, 5).map((date) => {
            const rows = byDate[date];
            const dayTotal = rows.reduce((s, r) => s + r.valor, 0);
            const isToday = date === today;
            const d = new Date(date + "T12:00:00");
            const dayLabel = isToday
              ? "Hoje"
              : d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
            return (
              <div
                key={date}
                className="flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2"
              >
                <div className="flex items-center gap-2.5">
                  <div className={cn(
                    "flex h-8 w-8 shrink-0 flex-col items-center justify-center rounded-md border text-[10px] font-medium leading-none",
                    isToday
                      ? "border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.1)] text-[hsl(var(--warning-foreground))]"
                      : "border-border bg-muted/40 text-muted-foreground"
                  )}>
                    <span className="text-[9px] uppercase">{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</span>
                    <span className="text-xs font-semibold tabular-nums">{d.getDate()}</span>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-foreground">{dayLabel}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {rows.length} acordo{rows.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold tabular-nums text-foreground">
                  {formatBRLCompact(dayTotal)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Atividade recente — agrupada por dia
// ──────────────────────────────────────────────────────────────

function ActivityFeed({ data }: { data: DashboardData["recent_activity"] }) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/60">
          <PhoneCall className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">Sem atividade recente.</p>
        <p className="text-[11px] text-muted-foreground">
          Eventos aparecem aqui em tempo real.
        </p>
      </div>
    );
  }

  // Agrupa por dia (Hoje, Ontem, data)
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const groups = data.reduce<Record<string, typeof data>>((acc, a) => {
    const day = a.at.slice(0, 10);
    (acc[day] ??= []).push(a);
    return acc;
  }, {});
  const orderedDays = Object.keys(groups).sort().reverse();

  return (
    <div className="space-y-4">
      {orderedDays.map((day) => {
        const items = groups[day];
        const label = day === today ? "Hoje" : day === yesterday ? "Ontem" : new Date(day + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
        return (
          <div key={day}>
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[10px] tabular-nums text-muted-foreground">{items.length}</span>
            </div>
            <div className="space-y-0.5">
              {items.map((a, i) => {
                const isPayment = a.kind === "payment";
                const isArrangement = a.kind === "arrangement";
                const isPending = isArrangement && a.outcome === "pendente_aprovacao";
                const Icon = isPayment ? CreditCard : (isArrangement || a.outcome === "acordo") ? Handshake : PhoneCall;
                const tone = isPayment
                  ? "text-[hsl(var(--success))] bg-[hsl(var(--success)/0.12)]"
                  : isPending
                  ? "text-[hsl(var(--warning-foreground))] bg-[hsl(var(--warning)/0.15)]"
                  : isArrangement
                  ? "text-accent bg-accent/12"
                  : "text-primary bg-primary/10";
                return (
                  <div key={`${a.at}-${i}`} className="flex items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-muted/40">
                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", tone)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{a.label}</div>
                        <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {timeAgo(a.at)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">{a.subtitle}</span>
                        {a.value != null && (
                          <span className={cn(
                            "shrink-0 font-semibold tabular-nums",
                            isPending ? "text-[hsl(var(--warning-foreground))]" : "text-[hsl(var(--success))]"
                          )}>
                            {formatBRL(a.value)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Carteira com mini-barra segmentada
// ──────────────────────────────────────────────────────────────

function CarteiraCard({ data }: { data: DashboardData }) {
  const aberto = data.carteira.dividas_abertas;
  const negoc = data.carteira.em_negociacao;
  const total = aberto + negoc;
  const abertoPct = total > 0 ? (aberto / total) * 100 : 100;
  const negocPct = total > 0 ? (negoc / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Em aberto
        </div>
        <div className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-foreground">
          {formatBRL(data.carteira.valor_aberto)}
        </div>
      </div>

      {/* Barra segmentada */}
      {total > 0 && (
        <div className="space-y-2">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted/60">
            <div
              className="bg-primary transition-all"
              style={{ width: `${abertoPct}%` }}
              title={`${aberto} em aberto`}
            />
            <div
              className="bg-accent transition-all"
              style={{ width: `${negocPct}%` }}
              title={`${negoc} em negociação`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Aberto</div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{aberto}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" />
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Negociação</div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{negoc}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <Link
        to="/contacts"
        className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-background/60 py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Wallet className="h-3.5 w-3.5" />
        Abrir carteira
      </Link>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Campanhas (versão compacta)
// ──────────────────────────────────────────────────────────────

function CampaignsCompact({ data }: { data: DashboardData["active_campaigns"] }) {
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Megaphone className="h-6 w-6 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground">Nenhuma campanha ativa.</p>
        <Link
          to="/voice-campaigns"
          className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/15"
        >
          Criar campanha
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {data.slice(0, 3).map((c) => {
        const statusConf = CAMPAIGN_STATUS_LABEL[c.status] ?? { label: c.status, tone: "bg-muted text-muted-foreground" };
        const done = c.placed + c.failed;
        const pct = c.total > 0 ? Math.min(100, Math.round((done / c.total) * 100)) : 0;
        const StatusIcon = c.status === "running" ? PlayCircle : c.status === "paused" ? PauseCircle : Clock;
        return (
          <Link
            key={c.id}
            to="/voice-campaigns"
            className="block rounded-md border border-border/60 bg-background/40 p-2.5 transition-colors hover:border-border hover:bg-muted/40"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", c.status === "running" ? "text-[hsl(var(--success))]" : "text-muted-foreground")} />
                <span className="truncate text-xs font-medium text-foreground">{c.name}</span>
              </div>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted/60">
              <div
                className="h-full bg-gradient-to-r from-accent to-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Saúde do sistema com CTAs
// ──────────────────────────────────────────────────────────────

function IntegrationsHealth({ data }: { data: DashboardData["integrations_status"] }) {
  const items: { label: string; ok: boolean; icon: React.ComponentType<{ className?: string }>; cta: string; to: string }[] = [
    { label: "Empresa", ok: data.company_settings, icon: Settings, cta: "Completar", to: "/settings" },
    { label: "WhatsApp", ok: data.whatsapp, icon: MessageCircle, cta: "Conectar", to: "/settings" },
    { label: "Asaas", ok: data.asaas, icon: CreditCard, cta: "Conectar", to: "/settings" },
  ];
  return (
    <div className="space-y-1.5">
      {items.map((i) => (
        i.ok ? (
          <div key={i.label} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))]" />
              <span className="truncate text-xs text-foreground">{i.label}</span>
            </div>
            <span className="text-[10px] text-muted-foreground">Conectado</span>
          </div>
        ) : (
          <Link
            key={i.label}
            to={i.to}
            className="flex items-center justify-between gap-2 rounded-md border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.06)] px-2 py-1.5 transition-colors hover:bg-[hsl(var(--warning)/0.1)]"
          >
            <div className="flex min-w-0 items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning-foreground))]" />
              <span className="truncate text-xs font-medium text-foreground">{i.label}</span>
            </div>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[hsl(var(--warning-foreground))]">
              {i.cta} <ChevronRight className="h-2.5 w-2.5" />
            </span>
          </Link>
        )
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Loading skeleton
// ──────────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[120px] animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-[320px] animate-pulse rounded-xl border border-border bg-card lg:col-span-2" />
        <div className="h-[320px] animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </>
  );
}

function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15">
        <AlertCircle className="h-5 w-5 text-destructive" />
      </div>
      <h2 className="mt-3 text-sm font-semibold text-foreground">Falha ao carregar o painel</h2>
      <p className="mt-1 text-[12px] text-muted-foreground">
        {message.length > 200 ? message.slice(0, 200) + "…" : message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        Tentar de novo
      </button>
    </div>
  );
}

// First-use / empty state

function FirstUseState() {
  const steps = [
    {
      icon: Settings,
      label: "Configure sua empresa",
      desc: "Nome, CNPJ, janela de contato e e-mail de suporte.",
      to: "/settings",
      cta: "Configurar",
    },
    {
      icon: Volume2,
      label: "Crie o agente de voz",
      desc: "Use o template de cobrança e sincronize com ElevenLabs.",
      to: "/agents",
      cta: "Criar agente",
    },
    {
      icon: PhoneIcon,
      label: "Ative um número Twilio",
      desc: "Conecte o número com ElevenLabs para começar a ligar.",
      to: "/phone-numbers",
      cta: "Configurar número",
    },
    {
      icon: Upload,
      label: "Importe sua carteira",
      desc: "CSV com nome, telefone, valor e vencimento.",
      to: "/contacts",
      cta: "Importar CSV",
    },
    {
      icon: Megaphone,
      label: "Dispare a primeira campanha",
      desc: "Selecione agente, número e os devedores. Clique iniciar.",
      to: "/voice-campaigns",
      cta: "Nova campanha",
    },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 rounded-xl border border-accent/20 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15">
            <Sparkles className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Vamos configurar sua primeira cobrança</h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Siga os 5 passos abaixo. Leva ~10 minutos no total.
            </p>
          </div>
        </div>
      </div>

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className="flex items-center gap-4 rounded-lg border border-border bg-card p-4 transition-all hover:border-accent/40 hover:shadow-sm"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
                {i + 1}
              </div>
              <s.icon className="h-5 w-5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{s.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</div>
              </div>
              <span className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground/80">
                {s.cta}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <p className="text-xs font-medium text-foreground">Dica</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              O agente já vem com prompt de cobrança pronto (compliance BR, DNC automático, aviso de gravação). Só precisa escolher a voz e sincronizar.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
