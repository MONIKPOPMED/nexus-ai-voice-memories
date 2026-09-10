import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Search, Loader2, Handshake, CheckCircle2, XCircle, Clock, Phone, Mail,
  Calendar, CreditCard, AlertTriangle, MessageSquare, FileText,
  Volume2, ExternalLink, X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchArrangements, approveArrangement, rejectArrangement, markArrangementPaid,
  ARRANGEMENT_STATUS_LABEL,
  type ArrangementRow, type ArrangementStatus,
} from "@/lib/arrangements";
import { SourceBadge } from "@/components/arrangements/SourceBadge";
import { fetchCallDetail, normalizeTranscript, formatDuration } from "@/lib/history";
import { formatBRL } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AcordosSearch = { status?: ArrangementStatus | "todos" };

export const Route = createFileRoute("/_authenticated/acordos")({
  validateSearch: (search: Record<string, unknown>): AcordosSearch => {
    const raw = search.status;
    const allowed = ["pendente_aprovacao", "pendente", "pago", "atrasado", "cancelado", "todos"] as const;
    if (typeof raw === "string" && (allowed as readonly string[]).includes(raw)) {
      return { status: raw as ArrangementStatus | "todos" };
    }
    return {};
  },
  head: () => ({
    meta: [
      { title: "Acordos — cobrAI" },
      { name: "description", content: "Aprovar acordos fechados pelo agente, acompanhar pagamentos." },
    ],
  }),
  component: AcordosPage,
});

const TABS: { value: ArrangementStatus | "todos"; label: string }[] = [
  { value: "pendente_aprovacao", label: "Aguardando aprovação" },
  { value: "pendente",           label: "Aguardando pagamento" },
  { value: "pago",               label: "Pagos" },
  { value: "atrasado",           label: "Atrasados" },
  { value: "cancelado",          label: "Cancelados" },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function AcordosPage() {
  const search = Route.useSearch();
  const [tab, setTab] = useState<ArrangementStatus | "todos">(search.status ?? "pendente_aprovacao");
  const [rows, setRows] = useState<ArrangementRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [reviewing, setReviewing] = useState<ArrangementRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchArrangements({ status: tab, q, limit: 100 });
      setRows(r.rows);
      setCounts(r.counts);
    } catch (e) {
      console.warn("[acordos] load fail", e);
      toast.error("Falha ao carregar acordos");
    } finally {
      setLoading(false);
    }
  }, [tab, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const stats = useMemo(() => {
    const valor = rows.reduce((s, r) => s + (r.valor_negociado || 0), 0);
    return { count: rows.length, valor };
  }, [rows]);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Cobrança"
        title="Acordos"
        description="Aprovar acordos fechados pelo agente. Após aprovação, a proposta é enviada via Asaas, WhatsApp e e-mail."
      />

      <div className="px-6 py-4">
        {/* Stats topo */}
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatBlock
            icon={Clock}
            label="Aguardando aprovação"
            value={String(counts.pendente_aprovacao ?? 0)}
            tone="text-amber-300"
            highlight={(counts.pendente_aprovacao ?? 0) > 0}
          />
          <StatBlock
            icon={Handshake}
            label="Visualizados nesta aba"
            value={String(stats.count)}
            tone="text-violet-300"
          />
          <StatBlock
            icon={CreditCard}
            label="Valor"
            value={formatBRL(stats.valor)}
            tone="text-emerald-300"
          />
        </div>

        {/* Tabs */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = tab === t.value;
              const count = counts[t.value] ?? 0;
              return (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "border-violet-500 bg-violet-500 text-white shadow-sm dark:bg-violet-500/20 dark:text-violet-100"
                      : "border-border bg-transparent text-muted-foreground hover:border-violet-500/40 hover:bg-violet-500/5 hover:text-foreground",
                  )}
                >
                  {t.label}
                  {count > 0 && (
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                      active ? "bg-white/25 text-white dark:bg-white/15" : "bg-muted text-foreground",
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Lista */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyTab tab={tab} />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {rows.map((r) => (
                <ArrangementCard
                  key={r.id}
                  row={r}
                  onReview={() => setReviewing(r)}
                  onActioned={load}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <ReviewDialog
        arrangement={reviewing}
        onClose={() => setReviewing(null)}
        onActioned={() => { setReviewing(null); load(); }}
      />
    </div>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  tone,
  highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg border px-4 py-3 transition-colors",
      highlight
        ? "border-amber-500/30 bg-amber-500/10"
        : "border-white/[0.06] bg-white/[0.02]",
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EmptyTab({ tab }: { tab: ArrangementStatus | "todos" }) {
  const messages: Record<string, { title: string; desc: string }> = {
    pendente_aprovacao: { title: "Nenhum acordo aguardando aprovação", desc: "Quando o agente fechar um acordo na chamada, ele aparece aqui pra você revisar." },
    pendente: { title: "Nenhum acordo pendente de pagamento", desc: "Acordos aprovados aparecem aqui até o devedor pagar." },
    pago: { title: "Nenhum acordo pago", desc: "Quando o pagamento for confirmado pelo Asaas, aparece aqui." },
    atrasado: { title: "Sem atrasados", desc: "Acordos aprovados que venceram sem pagamento aparecem aqui." },
    cancelado: { title: "Sem cancelados", desc: "Acordos rejeitados ou cancelados aparecem aqui." },
    todos: { title: "Sem acordos", desc: "Comece criando uma campanha em /campaigns." },
  };
  const msg = messages[tab] ?? messages.todos;
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Handshake className="h-10 w-10 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium">{msg.title}</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{msg.desc}</p>
      </div>
    </div>
  );
}

function ArrangementCard({
  row,
  onReview,
  onActioned,
}: {
  row: ArrangementRow;
  onReview: () => void;
  onActioned: () => void;
}) {
  const statusConf = ARRANGEMENT_STATUS_LABEL[row.status];
  const isPendingApproval = row.status === "pendente_aprovacao";
  const isAwaitingPayment = row.status === "pendente" || row.status === "atrasado";
  const [acting, setActing] = useState<"approve" | "paid" | null>(null);
  const [showPaidForm, setShowPaidForm] = useState(false);
  const [paidMethod, setPaidMethod] = useState("");
  const [paidNote, setPaidNote] = useState("");

  const quickApprove = async () => {
    if (acting) return;
    setActing("approve");
    try {
      await approveArrangement({ arrangement_id: row.id });
      toast.success("Acordo aprovado — proposta sendo enviada");
      onActioned();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    } finally {
      setActing(null);
    }
  };

  const confirmPaid = async () => {
    if (acting) return;
    setActing("paid");
    try {
      await markArrangementPaid({
        arrangement_id: row.id,
        payment_method: paidMethod.trim() || undefined,
        note: paidNote.trim() || undefined,
      });
      toast.success("Pagamento confirmado — recuperação atualizada");
      setShowPaidForm(false);
      setPaidMethod("");
      setPaidNote("");
      onActioned();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    } finally {
      setActing(null);
    }
  };

  return (
    <li className="px-4 py-4 transition-colors hover:bg-white/[0.01]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">
              {row.contact?.name ?? "Devedor sem nome"}
            </h3>
            <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium", statusConf.tone)}>
              {statusConf.label}
            </span>
            <SourceBadge source={row.source} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {row.contact?.phone && (
              <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{row.contact.phone}</span>
            )}
            {row.contact?.email && (
              <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{row.contact.email}</span>
            )}
            {row.debt?.descricao && (
              <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{row.debt.descricao}</span>
            )}
            {row.created_at && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />Fechado há {timeAgo(row.created_at)}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 lg:grid-cols-3 lg:gap-6">
          <DataCol label="Valor" value={formatBRL(row.valor_negociado)} highlight={isPendingApproval} />
          <DataCol
            label="Original"
            value={formatBRL(row.valor_original)}
            sub={row.desconto_pct > 0 ? `−${row.desconto_pct}%` : undefined}
          />
          <DataCol
            label={row.num_parcelas > 1 ? `Em ${row.num_parcelas}x` : "Forma"}
            value={row.metodo.toUpperCase()}
            sub={`venc. ${formatDate(row.primeiro_vencimento)}`}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onReview}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-violet-500/40 hover:bg-violet-500/5"
          >
            Revisar
          </button>
          {isPendingApproval && (
            <Button
              size="sm"
              onClick={quickApprove}
              disabled={Boolean(acting)}
              className="gap-1.5 bg-emerald-500 hover:bg-emerald-600"
            >
              {acting === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Aprovar
            </Button>
          )}
          {isAwaitingPayment && !showPaidForm && (
            <Button
              size="sm"
              onClick={() => setShowPaidForm(true)}
              disabled={Boolean(acting)}
              className="gap-1.5 bg-emerald-500 hover:bg-emerald-600"
            >
              <CreditCard className="h-3.5 w-3.5" />
              Marcar pago
            </Button>
          )}
        </div>
      </div>

      {isAwaitingPayment && showPaidForm && (
        <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            <CreditCard className="h-3.5 w-3.5" />
            Confirmar pagamento manual
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
            <select
              value={paidMethod}
              onChange={(e) => setPaidMethod(e.target.value)}
              className="rounded-md border border-white/[0.1] bg-background px-2 py-2 text-xs"
            >
              <option value="">Forma (opcional)</option>
              <option value="pix">PIX</option>
              <option value="boleto">Boleto</option>
              <option value="cartao">Cartão</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="transferencia">Transferência</option>
              <option value="outro">Outro</option>
            </select>
            <Input
              value={paidNote}
              onChange={(e) => setPaidNote(e.target.value)}
              placeholder="Observação (opcional, ex.: comprovante #123)"
              className="text-xs"
            />
            <div className="flex gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setShowPaidForm(false); setPaidMethod(""); setPaidNote(""); }}
                disabled={Boolean(acting)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={confirmPaid}
                disabled={Boolean(acting)}
                className="gap-1.5 bg-emerald-500 hover:bg-emerald-600"
              >
                {acting === "paid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Confirmar
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Use apenas se o devedor pagou fora do link Asaas. Pagamentos pelo link são confirmados automaticamente.
          </p>
        </div>
      )}

      {row.rejection_reason && (
        <div className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-200">
          <strong>Motivo da rejeição:</strong> {row.rejection_reason}
        </div>
      )}
    </li>
  );
}

function DataCol({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "mt-0.5 font-mono text-sm font-semibold tabular-nums",
        highlight && "text-emerald-300",
      )}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Review dialog (transcrição + aprovação detalhada)
// ──────────────────────────────────────────────────────────────────

function ReviewDialog({
  arrangement,
  onClose,
  onActioned,
}: {
  arrangement: ArrangementRow | null;
  onClose: () => void;
  onActioned: () => void;
}) {
  const [transcript, setTranscript] = useState<ReturnType<typeof normalizeTranscript> | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [editValor, setEditValor] = useState("");
  const [editParcelas, setEditParcelas] = useState("");
  const [editVencimento, setEditVencimento] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [paidMethod, setPaidMethod] = useState("");
  const [paidNote, setPaidNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | "paid" | null>(null);

  useEffect(() => {
    if (!arrangement) {
      setTranscript(null);
      setRecordingUrl(null);
      setDuration(0);
      setEditValor("");
      setEditParcelas("");
      setEditVencimento("");
      setShowRejectForm(false);
      setRejectReason("");
      setPaidMethod("");
      setPaidNote("");
      return;
    }
    setEditValor(String(arrangement.valor_negociado));
    setEditParcelas(String(arrangement.num_parcelas));
    setEditVencimento(arrangement.primeiro_vencimento);

    if (arrangement.call?.id) {
      setLoadingDetail(true);
      fetchCallDetail(arrangement.call.id)
        .then((d) => {
          setTranscript(normalizeTranscript(d.call.transcript));
          setRecordingUrl(d.call.recording_url);
          setDuration(d.call.duration_seconds);
        })
        .catch((e) => console.warn("[acordos] detail", e))
        .finally(() => setLoadingDetail(false));
    } else {
      setTranscript([]);
      setRecordingUrl(null);
      setDuration(0);
    }
  }, [arrangement?.id]);

  if (!arrangement) return null;

  const isPendingApproval = arrangement.status === "pendente_aprovacao";
  const isAwaitingPayment = arrangement.status === "pendente" || arrangement.status === "atrasado";
  const valorChanged = Number(editValor) !== arrangement.valor_negociado;
  const parcelasChanged = Number(editParcelas) !== arrangement.num_parcelas;
  const vencChanged = editVencimento !== arrangement.primeiro_vencimento;
  const hasOverrides = valorChanged || parcelasChanged || vencChanged;

  const handleApprove = async () => {
    if (acting) return;
    setActing("approve");
    try {
      const override = hasOverrides
        ? {
            ...(valorChanged ? { valor_negociado: Number(editValor) } : {}),
            ...(parcelasChanged ? { num_parcelas: Number(editParcelas) } : {}),
            ...(vencChanged ? { primeiro_vencimento: editVencimento } : {}),
          }
        : undefined;
      await approveArrangement({ arrangement_id: arrangement.id, override });
      toast.success("Aprovado — proposta sendo enviada");
      onActioned();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    } finally {
      setActing(null);
    }
  };

  const handleReject = async () => {
    if (acting) return;
    setActing("reject");
    try {
      await rejectArrangement({ arrangement_id: arrangement.id, reason: rejectReason.trim() || undefined });
      toast.success("Acordo rejeitado");
      onActioned();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    } finally {
      setActing(null);
    }
  };

  const handleMarkPaid = async () => {
    if (acting) return;
    setActing("paid");
    try {
      await markArrangementPaid({
        arrangement_id: arrangement.id,
        payment_method: paidMethod.trim() || undefined,
        note: paidNote.trim() || undefined,
      });
      toast.success("Pagamento confirmado — recuperação atualizada");
      onActioned();
    } catch (e) {
      toast.error(`Falha: ${e instanceof Error ? e.message : "erro"}`);
    } finally {
      setActing(null);
    }
  };

  const statusConf = ARRANGEMENT_STATUS_LABEL[arrangement.status];

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-4 w-4 text-violet-400" />
            Revisar acordo
            <span className={cn("ml-2 rounded-md border px-1.5 py-0.5 text-[10px] font-medium", statusConf.tone)}>
              {statusConf.label}
            </span>
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {arrangement.contact?.name ?? "Devedor"}
            {arrangement.contact?.phone ? ` · ${arrangement.contact.phone}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto">
          {/* Resumo da dívida */}
          <Section title="Dívida original">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Info label="Valor" value={formatBRL(arrangement.debt?.valor_atual ?? arrangement.valor_original)} />
              <Info label="Vencimento" value={formatDate(arrangement.debt?.vencimento)} />
              <Info label="Origem" value={arrangement.debt?.origem ?? "—"} />
              <Info label="Descrição" value={arrangement.debt?.descricao ?? "—"} />
            </div>
          </Section>

          {/* Negociação editável (apenas se pendente de aprovação) */}
          <Section title="Acordo proposto pelo agente">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Valor negociado
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={editValor}
                  onChange={(e) => setEditValor(e.target.value)}
                  disabled={!isPendingApproval}
                  className="font-mono"
                />
                {arrangement.desconto_pct > 0 && (
                  <p className="mt-1 text-[10px] text-emerald-300">−{arrangement.desconto_pct}% sobre original</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Parcelas
                </label>
                <Input
                  type="number"
                  min={1}
                  max={24}
                  value={editParcelas}
                  onChange={(e) => setEditParcelas(e.target.value)}
                  disabled={!isPendingApproval}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Primeiro vencimento
                </label>
                <Input
                  type="date"
                  value={editVencimento}
                  onChange={(e) => setEditVencimento(e.target.value)}
                  disabled={!isPendingApproval}
                />
              </div>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Forma: <strong>{arrangement.metodo.toUpperCase()}</strong>
              {hasOverrides && isPendingApproval && (
                <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300">
                  Você fez ajustes — eles serão salvos ao aprovar
                </span>
              )}
            </div>
          </Section>

          {/* Gravação + Transcrição */}
          {arrangement.call?.id && (
            <Section title={`Chamada (${formatDuration(duration)})`}>
              {loadingDetail ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                </div>
              ) : (
                <>
                  {recordingUrl ? (
                    <div className="mb-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <Volume2 className="h-3.5 w-3.5 text-sky-300" />
                        Gravação
                      </div>
                      <audio controls src={recordingUrl} className="w-full" preload="none" />
                    </div>
                  ) : (
                    <div className="mb-3 rounded-md border border-dashed border-white/[0.06] px-3 py-2 text-[10px] text-muted-foreground">
                      Sem gravação disponível
                    </div>
                  )}

                  {transcript && transcript.length > 0 ? (
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5 text-violet-300" />
                        Transcrição ({transcript.length} turnos)
                      </div>
                      <div className="max-h-[35vh] space-y-2 overflow-y-auto">
                        {transcript.map((t, i) => (
                          <TranscriptBubble key={i} role={t.role} content={t.content} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-white/[0.06] px-3 py-2 text-[10px] text-muted-foreground">
                      Transcrição não disponível.
                    </div>
                  )}
                </>
              )}
            </Section>
          )}

          {/* Status pós-decisão */}
          {!isPendingApproval && (
            <Section title="Status">
              <div className="space-y-1 text-[12px]">
                {arrangement.approved_at && (
                  <div className="flex items-center gap-2 text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Aprovado em {new Date(arrangement.approved_at).toLocaleString("pt-BR")}
                  </div>
                )}
                {arrangement.rejected_at && (
                  <div className="flex items-center gap-2 text-rose-300">
                    <XCircle className="h-3.5 w-3.5" />
                    Rejeitado em {new Date(arrangement.rejected_at).toLocaleString("pt-BR")}
                    {arrangement.rejection_reason && ` — ${arrangement.rejection_reason}`}
                  </div>
                )}
                {arrangement.paid_at && (
                  <div className="flex items-center gap-2 text-emerald-300">
                    <CreditCard className="h-3.5 w-3.5" />
                    Pago em {new Date(arrangement.paid_at).toLocaleString("pt-BR")}
                  </div>
                )}
                {arrangement.asaas_payment_url && (
                  <a
                    href={arrangement.asaas_payment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Link de pagamento <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </Section>
          )}
        </div>

        {isPendingApproval && (
          <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {showRejectForm ? (
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Motivo da rejeição (opcional)"
                  className="flex-1"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setShowRejectForm(false); setRejectReason(""); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleReject}
                    disabled={Boolean(acting)}
                    className="gap-1.5"
                  >
                    {acting === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                    Confirmar rejeição
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowRejectForm(true)}
                  className="gap-1.5 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  disabled={Boolean(acting)}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Rejeitar
                </Button>
                <Button
                  onClick={handleApprove}
                  disabled={Boolean(acting)}
                  className="gap-1.5 bg-emerald-500 hover:bg-emerald-600"
                >
                  {acting === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  {hasOverrides ? "Aprovar com ajustes" : "Aprovar e enviar proposta"}
                </Button>
              </>
            )}
          </DialogFooter>
        )}

        {isAwaitingPayment && (
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <select
                value={paidMethod}
                onChange={(e) => setPaidMethod(e.target.value)}
                className="rounded-md border border-white/[0.1] bg-background px-2 py-2 text-xs sm:w-[140px]"
              >
                <option value="">Forma (opcional)</option>
                <option value="pix">PIX</option>
                <option value="boleto">Boleto</option>
                <option value="cartao">Cartão</option>
                <option value="dinheiro">Dinheiro</option>
                <option value="transferencia">Transferência</option>
                <option value="outro">Outro</option>
              </select>
              <Input
                value={paidNote}
                onChange={(e) => setPaidNote(e.target.value)}
                placeholder="Observação (ex.: comprovante #123)"
                className="flex-1 text-xs"
              />
            </div>
            <Button
              onClick={handleMarkPaid}
              disabled={Boolean(acting)}
              className="gap-1.5 bg-emerald-500 hover:bg-emerald-600"
            >
              {acting === "paid" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Marcar como pago
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs">{value}</div>
    </div>
  );
}

function TranscriptBubble({ role, content }: { role: string; content: string }) {
  const isAgent = role === "agent" || role === "assistant" || role === "bot";
  return (
    <div className={cn("flex gap-2", isAgent ? "flex-row" : "flex-row-reverse")}>
      <div className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
        isAgent
          ? "bg-violet-100 text-violet-700 dark:bg-violet-500/30 dark:text-violet-200"
          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/30 dark:text-emerald-200",
      )}>
        {isAgent ? "IA" : "D"}
      </div>
      <div className={cn(
        "max-w-[75%] rounded-lg px-3 py-2 text-xs leading-relaxed",
        isAgent
          ? "rounded-tl-sm bg-violet-100 text-slate-900 dark:bg-violet-500/20 dark:text-slate-100"
          : "rounded-tr-sm bg-emerald-100 text-slate-900 dark:bg-emerald-500/20 dark:text-slate-100",
      )}>
        {content}
      </div>
    </div>
  );
}
