import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Search, Loader2, PhoneCall, Mic, Download, X, Clock, Bot,
  Handshake, Ban, ArrowDownRight, ArrowUpRight, FileText, Volume2,
  User as UserIcon, Calendar, CreditCard, ExternalLink, Eye,
  RefreshCw, AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  fetchCalls, fetchCallDetail, formatDuration, formatCostBRL,
  normalizeTranscript,
  type CallRow, type CallDetail, type CallOutcome,
} from "@/lib/history";
import { finalizeVoiceCall } from "@/lib/voice";
import { formatBRL, OUTCOME_LABEL, OUTCOME_TONE } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/historico")({
  head: () => ({
    meta: [
      { title: "Histórico — cobrAI" },
      { name: "description", content: "Histórico completo de chamadas com transcrição e gravação." },
    ],
  }),
  component: HistoryPage,
});

const OUTCOME_FILTERS: { value: CallOutcome | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "acordo", label: "Acordo" },
  { value: "cpc", label: "Contato" },
  { value: "nao_atende", label: "Não atende" },
  { value: "caixa_postal", label: "Caixa postal" },
  { value: "recusa", label: "Recusa" },
  { value: "dnc_solicitado", label: "DNC" },
  { value: "numero_errado", label: "Número errado" },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function HistoryPage() {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | "todos">("todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetchCalls({
        q,
        outcome: outcome === "todos" ? undefined : outcome,
        limit: 100,
      });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e) {
      console.warn("[historico] load failed", e);
      toast.error("Não foi possível carregar o histórico");
    } finally {
      setLoading(false);
    }
  }, [q, outcome]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const totalDuration = useMemo(
    () => rows.reduce((s, r) => s + r.duration_seconds, 0),
    [rows],
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Cobrança"
        title="Histórico de chamadas"
        description="Todas as chamadas com transcrição, gravação e outcome classificado."
      />

      <div className="px-6 py-4">
        {/* Stats */}
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatBlock icon={PhoneCall} label="Chamadas exibidas" value={String(rows.length)} tone="text-violet-300" />
          <StatBlock icon={Clock} label="Tempo total" value={formatDuration(totalDuration)} tone="text-sky-300" />
          <StatBlock icon={FileText} label="Total geral" value={String(total)} tone="text-emerald-300" />
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por telefone…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {OUTCOME_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setOutcome(f.value)}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  outcome === f.value
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <PhoneCall className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">Nenhuma chamada registrada</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Assim que uma campanha rodar, as ligações aparecem aqui com transcrição e gravação.
                </p>
              </div>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent">
                  <TableHead>Quando</TableHead>
                  <TableHead>Devedor</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Dur.</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead>Mídia</TableHead>
                  <TableHead className="text-right">Acordo</TableHead>
                  <TableHead className="w-[120px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const outcomeConf = r.collection_outcome
                    ? { label: OUTCOME_LABEL[r.collection_outcome] ?? r.collection_outcome, tone: OUTCOME_TONE[r.collection_outcome] ?? "text-slate-400 bg-slate-500/10" }
                    : null;
                  const needsSync = !r.has_recording || !r.has_transcript;
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer border-white/[0.04] hover:bg-white/[0.02]"
                      onClick={() => setSelectedId(r.id)}
                    >
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2 text-xs">
                          {r.direction === "outbound"
                            ? <ArrowUpRight className="h-3 w-3 text-fuchsia-400" />
                            : <ArrowDownRight className="h-3 w-3 text-sky-400" />}
                          {formatDateTime(r.started_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="truncate text-sm">{r.debtor_name ?? "—"}</span>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {r.to_number}
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {formatDuration(r.duration_seconds)}
                      </TableCell>
                      <TableCell>
                        {outcomeConf ? (
                          <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium", outcomeConf.tone)}>
                            {outcomeConf.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">sem classificação</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {needsSync ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                            <AlertCircle className="h-3 w-3" /> Pendente sync
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            {r.has_recording && <Volume2 className="h-3 w-3 text-sky-400" />}
                            {r.has_transcript && <FileText className="h-3 w-3 text-violet-400" />}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.arrangement ? (
                          <div>
                            <div className="font-mono text-xs font-semibold tabular-nums text-emerald-300">
                              {formatBRL(r.arrangement.valor)}
                            </div>
                            <div className="text-[9px] text-muted-foreground">
                              {r.arrangement.status}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); setSelectedId(r.id); }}
                        >
                          <Eye className="mr-1 h-3 w-3" /> Detalhes
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <CallDetailDialog
        callId={selectedId}
        onClose={() => setSelectedId(null)}
        onSynced={load}
      />
    </div>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function CallDetailDialog({
  callId,
  onClose,
  onSynced,
}: {
  callId: string | null;
  onClose: () => void;
  onSynced?: () => void | Promise<void>;
}) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    if (!callId) return;
    setLoading(true);
    try {
      const d = await fetchCallDetail(callId);
      setDetail(d);
    } catch (e) {
      console.warn("[historico] detail failed", e);
      toast.error("Não foi possível carregar o detalhe");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    if (!callId) {
      setDetail(null);
      return;
    }
    reload();
  }, [callId, reload]);

  const turns = useMemo(
    () => detail ? normalizeTranscript(detail.call.transcript) : [],
    [detail],
  );

  const outcomeConf = detail?.call.collection_outcome
    ? { label: OUTCOME_LABEL[detail.call.collection_outcome] ?? detail.call.collection_outcome, tone: OUTCOME_TONE[detail.call.collection_outcome] ?? "text-slate-400 bg-slate-500/10" }
    : null;

  const needsSync = Boolean(
    detail && (
      !detail.call.recording_url ||
      turns.length === 0 ||
      ["queued", "ringing", "in_progress"].includes(detail.call.status)
    ),
  );

  async function handleSync() {
    if (!detail) return;
    setSyncing(true);
    try {
      const result = await finalizeVoiceCall(detail.call.id);
      if (result.skipped) {
        toast.info("Provedor ainda processando esta chamada", {
          description: "Aguarde ~30s e tente novamente.",
        });
      } else {
        const arr = result.extract?.arrangement_id;
        toast.success("Sincronizado", {
          description: `${result.transcript_messages ?? 0} mensagens recuperadas${arr ? " · acordo extraído" : ""}`,
        });
      }
      await reload();
      await onSynced?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Dialog open={Boolean(callId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-8 text-base">
            <span className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-violet-300" />
              Detalhes da chamada
            </span>
            {detail && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={handleSync}
                disabled={syncing}
                title="Forçar nova sincronização com o provedor"
              >
                {syncing ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                Sincronizar
              </Button>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : !detail ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sem dados.</p>
        ) : (
          <div className="flex max-h-[80vh] flex-col gap-4 overflow-y-auto pr-1">
            {needsSync && (
              <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="flex-1 text-xs">
                  <div className="font-medium text-amber-200">Gravação ou transcrição faltando</div>
                  <div className="mt-0.5 text-amber-200/70">
                    Esta chamada está sem áudio ou transcrição. Tente sincronizar agora com o provedor para recuperar os dados.
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleSync}
                  disabled={syncing}
                  className="shrink-0 bg-amber-500 text-amber-950 hover:bg-amber-400"
                >
                  {syncing ? (
                    <><Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Sincronizando…</>
                  ) : (
                    <><RefreshCw className="mr-1.5 h-3 w-3" /> Sincronizar agora</>
                  )}
                </Button>
              </div>
            )}

            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <InfoPill icon={UserIcon} label="Devedor" value={detail.contact?.name ?? "—"} />
              <InfoPill icon={Calendar} label="Quando" value={formatDateTime(detail.call.started_at)} />
              <InfoPill icon={Clock} label="Duração" value={formatDuration(detail.call.duration_seconds)} />
              <InfoPill icon={Bot} label="Agente" value={detail.persona?.name ?? "—"} />
            </div>

            {/* Outcome + arrangement + cost */}
            <div className="flex flex-wrap items-center gap-2">
              {outcomeConf && (
                <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium", outcomeConf.tone)}>
                  <Handshake className="h-3 w-3" />
                  {outcomeConf.label}
                </span>
              )}
              {detail.arrangement && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                  <CreditCard className="h-3 w-3" />
                  Acordo {formatBRL(detail.arrangement.valor_negociado)} • {detail.arrangement.num_parcelas}x
                </span>
              )}
              {detail.call.total_cost_cents > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  Custo: {formatCostBRL(detail.call.total_cost_cents)}
                </span>
              )}
              {detail.call.provider_call_sid && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  SID: {detail.call.provider_call_sid.slice(0, 10)}…
                </span>
              )}
            </div>

            {/* Debt linked */}
            {detail.debt && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Dívida relacionada</div>
                <div className="mt-1 flex items-center justify-between">
                  <div>
                    <div className="text-sm">{detail.debt.descricao ?? "Sem descrição"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Venc. {new Date(detail.debt.vencimento).toLocaleDateString("pt-BR")}
                      {detail.debt.origem && ` · ${detail.debt.origem}`}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-amber-300">
                    {formatBRL(detail.debt.valor_atual)}
                  </div>
                </div>
              </div>
            )}

            {/* Audio player */}
            {detail.call.recording_url ? (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <Volume2 className="h-3.5 w-3.5 text-sky-300" />
                    Gravação
                  </div>
                  <a
                    href={detail.call.recording_url}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                  >
                    <Download className="h-3 w-3" /> Baixar
                  </a>
                </div>
                <audio controls src={detail.call.recording_url} className="w-full" preload="none">
                  Seu navegador não suporta áudio.
                </audio>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/[0.06] bg-white/[0.01] px-3 py-4 text-center text-[11px] text-muted-foreground">
                Sem gravação disponível para esta chamada.
              </div>
            )}

            {/* Transcript */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-violet-300" />
                  Transcrição ({turns.length} turnos)
                </div>
                {detail.arrangement?.asaas_payment_url && (
                  <a
                    href={detail.arrangement.asaas_payment_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Link de pagamento <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {turns.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/[0.06] bg-white/[0.01] px-3 py-6 text-center text-[11px] text-muted-foreground">
                  Transcrição não disponível (ainda processando ou chamada curta demais).
                </div>
              ) : (
                <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  {turns.map((t, i) => (
                    <TranscriptTurn key={i} role={t.role} content={t.content} timestamp={t.timestamp} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoPill({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-xs">{value}</div>
    </div>
  );
}

function TranscriptTurn({
  role,
  content,
  timestamp,
}: {
  role: string;
  content: string;
  timestamp?: number;
}) {
  const isAgent = role === "agent" || role === "assistant" || role === "bot";
  return (
    <div className={cn("flex gap-2", isAgent ? "flex-row" : "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
          isAgent
            ? "bg-violet-100 text-violet-700 dark:bg-violet-500/30 dark:text-violet-200"
            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/30 dark:text-emerald-200",
        )}
      >
        {isAgent ? "IA" : "D"}
      </div>
      <div
        className={cn(
          "max-w-[75%] rounded-lg px-3 py-2 text-xs leading-relaxed",
          isAgent
            ? "rounded-tl-sm bg-violet-100 text-slate-900 dark:bg-violet-500/20 dark:text-slate-100"
            : "rounded-tr-sm bg-emerald-100 text-slate-900 dark:bg-emerald-500/20 dark:text-slate-100",
        )}
      >
        {content}
        {timestamp !== undefined && (
          <span className="ml-2 text-[9px] opacity-60">{formatDuration(Math.round(timestamp))}</span>
        )}
      </div>
    </div>
  );
}
