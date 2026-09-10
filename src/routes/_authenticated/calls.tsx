import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Phone, PhoneOutgoing, Search, Loader2, User, Wallet, Calendar,
  AlertCircle, CheckCircle2, X, Clock, FileText, Sparkles, History, UserPlus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccount } from "@/lib/account-context";
import {
  fetchDebtors, fetchDebtsForContact, formatBRL, formatDoc,
  DEBT_STATUS_LABEL, type DebtorRow,
} from "@/lib/debtors";
import { fetchPhoneNumbers, placeCall, finalizeVoiceCall, type PhoneNumber } from "@/lib/voice";
import { fetchPersonas, type Persona } from "@/lib/personas";
import { DebtorFormDialog } from "@/components/contacts/DebtorFormDialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calls")({
  component: IndividualCallsPage,
});

interface DebtRow {
  id: string;
  descricao: string | null;
  valor_atual: number;
  vencimento: string | null;
  status: string;
  attempts_count: number;
  last_call_at: string | null;
}

interface CallHistoryRow {
  id: string;
  status: string;
  duration_seconds: number;
  collection_outcome: string | null;
  started_at: string | null;
  to_number: string;
  transcription_status: string | null;
  recording_storage_path: string | null;
}

const STUCK_AFTER_MS = 5 * 60 * 1000; // 5 minutos
function isStuckCall(c: CallHistoryRow): boolean {
  const inFlight = ["queued", "ringing", "in_progress"].includes(c.status);
  const completedNoTranscript =
    c.status === "completed" && (c.transcription_status !== "done" || !c.recording_storage_path);
  if (!inFlight && !completedNoTranscript) return false;
  if (!c.started_at) return false;
  return Date.now() - new Date(c.started_at).getTime() > STUCK_AFTER_MS;
}

function initials(name: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function IndividualCallsPage() {
  const { accountId } = useAccount();
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DebtorRow | null>(null);

  // Side panel data
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [history, setHistory] = useState<CallHistoryRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Call config
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [fromPhoneId, setFromPhoneId] = useState<string>("");
  const [personaId, setPersonaId] = useState<string>("");
  const [debtId, setDebtId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [dialing, setDialing] = useState(false);
  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [newDebtorOpen, setNewDebtorOpen] = useState(false);

  async function refreshHistory() {
    if (!selected?.phone_number || !accountId) return;
    const { data: h } = await supabase
      .from("voice_calls")
      .select("id, status, duration_seconds, collection_outcome, started_at, to_number, transcription_status, recording_storage_path")
      .eq("account_id", accountId)
      .eq("to_number", selected.phone_number)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(20);
    setHistory(((h ?? []) as unknown) as CallHistoryRow[]);
  }

  async function handleFinalize(callId: string) {
    setFinalizingId(callId);
    try {
      const result = await finalizeVoiceCall(callId);
      if (result.skipped) {
        toast.info("Ligação já estava finalizada");
      } else {
        const arr = result.extract?.arrangement_id;
        toast.success("Ligação finalizada", {
          description: `${result.transcript_messages ?? 0} mensagens transcritas${arr ? " · acordo extraído" : ""}`,
        });
      }
      await refreshHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao finalizar a ligação");
    } finally {
      setFinalizingId(null);
    }
  }

  async function handleDebtorCreated(result?: { contact_id: string; debt_id: string | null }) {
    if (!accountId || !result?.contact_id) return;
    setSearch("");
    try {
      const { rows } = await fetchDebtors(accountId, { limit: 100 });
      setDebtors(rows);
      const created = rows.find((r) => r.contact_id === result.contact_id);
      if (created) {
        setSelected(created);
        toast.success("Pronto para discar", {
          description: `${created.name ?? "Devedor"} selecionado`,
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Load debtors
  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetchDebtors(accountId, { q: search || undefined, limit: 100 })
      .then(({ rows }) => setDebtors(rows))
      .catch((e) => toast.error(e?.message ?? "Falha ao carregar carteira"))
      .finally(() => setLoading(false));
  }, [accountId, search]);

  // Load phone numbers + personas once
  useEffect(() => {
    if (!accountId) return;
    fetchPhoneNumbers(accountId).then((pns) => {
      const enabled = pns.filter((p) => p.enabled && p.outbound_enabled);
      setPhoneNumbers(enabled);
      if (enabled.length && !fromPhoneId) setFromPhoneId(enabled[0].id);
    }).catch(() => {});
    fetchPersonas(accountId).then((ps) => {
      setPersonas(ps.filter((p) => p.status === "active" || p.enabled));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  // Load debts + history when selecting debtor
  useEffect(() => {
    if (!selected) {
      setDebts([]); setHistory([]); setDebtId("");
      return;
    }
    setLoadingDetail(true);
    Promise.all([
      fetchDebtsForContact(selected.contact_id),
      supabase
        .from("voice_calls")
        .select("id, status, duration_seconds, collection_outcome, started_at, to_number, transcription_status, recording_storage_path")
        .eq("account_id", accountId!)
        .eq("to_number", selected.phone_number ?? "__none__")
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(20),
    ])
      .then(([d, h]) => {
        const ds = (d as DebtRow[]) ?? [];
        setDebts(ds);
        const open = ds.find((x) => x.status === "aberto" || x.status === "em_negociacao");
        setDebtId(open?.id ?? ds[0]?.id ?? "");
        setHistory(((h.data ?? []) as unknown) as CallHistoryRow[]);
      })
      .catch((e) => toast.error(e?.message ?? "Falha ao carregar dívidas"))
      .finally(() => setLoadingDetail(false));
  }, [selected, accountId]);

  // Auto-suggest persona when phone changes
  useEffect(() => {
    if (!fromPhoneId) return;
    const pn = phoneNumbers.find((p) => p.id === fromPhoneId);
    if (pn?.pinned_persona_id && !personaId) {
      setPersonaId(pn.pinned_persona_id);
    }
  }, [fromPhoneId, phoneNumbers, personaId]);

  const selectedDebt = useMemo(
    () => debts.find((d) => d.id === debtId),
    [debts, debtId],
  );

  const canDial = !!selected?.phone_number && !!fromPhoneId && !!personaId && !dialing;

  async function handleDial() {
    if (!selected?.phone_number) {
      toast.error("Devedor sem telefone cadastrado");
      return;
    }
    setDialing(true);
    try {
      const result = await placeCall({
        fromNumberId: fromPhoneId,
        toNumber: selected.phone_number,
        personaId: personaId || undefined,
        debtId: debtId || undefined,
        contactId: selected.contact_id,
        notes: notes || undefined,
      });
      if (!result.ok) {
        toast.error(result.message ?? "Falha ao iniciar a ligação", {
          description: result.reason ? `Motivo: ${result.reason}` : undefined,
        });
        return;
      }
      toast.success("Ligação iniciada", {
        description: `via ${result.via === "elevenlabs" ? "ElevenLabs" : "Twilio"} • call_id ${result.callId.slice(0, 8)}`,
      });
      setNotes("");
      // refresh history
      const { data: h } = await supabase
        .from("voice_calls")
        .select("id, status, duration_seconds, collection_outcome, started_at, to_number, transcription_status, recording_storage_path")
        .eq("account_id", accountId!)
        .eq("to_number", selected.phone_number)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(20);
      setHistory(((h ?? []) as unknown) as CallHistoryRow[]);
    } finally {
      setDialing(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title="Ligações individuais"
        description="Disque manualmente para um devedor com IA assistida"
        actions={
          <Button
            onClick={() => setNewDebtorOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Nova ligação
          </Button>
        }
      />

      <DebtorFormDialog
        open={newDebtorOpen}
        onOpenChange={setNewDebtorOpen}
        onCreated={handleDebtorCreated}
      />

      <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[360px_1fr]">
        {/* Left: debtor list */}
        <div className="flex min-h-0 flex-col border-r border-border/40">
          <div className="border-b border-border/40 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar devedor por nome, doc, telefone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : debtors.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhum devedor encontrado.
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {debtors.map((d) => (
                  <li key={d.contact_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(d)}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                        selected?.contact_id === d.contact_id && "bg-muted/60",
                      )}
                    >
                      <Avatar className="h-9 w-9">
                        <AvatarFallback className="text-xs">{initials(d.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{d.name ?? "Sem nome"}</span>
                          {d.valor_aberto > 0 && (
                            <span className="shrink-0 text-xs font-semibold text-amber-300">
                              {formatBRL(d.valor_aberto)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{d.phone_number ?? "Sem telefone"}</span>
                          {d.status && (
                            <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", DEBT_STATUS_LABEL[d.status]?.tone)}>
                              {DEBT_STATUS_LABEL[d.status]?.label}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </div>

        {/* Right: call composer */}
        <div className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center p-12 text-center">
              <div className="max-w-sm space-y-2">
                <PhoneOutgoing className="mx-auto h-12 w-12 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  Selecione um devedor à esquerda para configurar e disparar a ligação.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 p-6">
              {/* Devedor header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{initials(selected.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <h2 className="text-lg font-semibold">{selected.name ?? "Sem nome"}</h2>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {selected.phone_number ?? "Sem telefone"}
                      </span>
                      {selected.doc_number && (
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {formatDoc(selected.doc_type, selected.doc_number)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  size="lg"
                  onClick={handleDial}
                  disabled={!canDial}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {dialing ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Discando…</>
                  ) : (
                    <><PhoneOutgoing className="mr-2 h-4 w-4" /> Discar agora</>
                  )}
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Configuração da ligação */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Configuração da ligação
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="from-phone">Número de origem</Label>
                      <Select value={fromPhoneId} onValueChange={setFromPhoneId}>
                        <SelectTrigger id="from-phone">
                          <SelectValue placeholder="Selecione um número" />
                        </SelectTrigger>
                        <SelectContent>
                          {phoneNumbers.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Nenhum número outbound habilitado
                            </div>
                          ) : (
                            phoneNumbers.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.friendly_name ?? p.e164} • {p.e164}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="persona">Agente de voz (persona)</Label>
                      <Select value={personaId} onValueChange={setPersonaId}>
                        <SelectTrigger id="persona">
                          <SelectValue placeholder="Selecione uma persona" />
                        </SelectTrigger>
                        <SelectContent>
                          {personas.length === 0 ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              Nenhuma persona ativa
                            </div>
                          ) : (
                            personas.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="notes">Notas para o agente (opcional)</Label>
                      <Textarea
                        id="notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Ex.: oferecer parcelamento em até 6x, valor mínimo de entrada R$ 200…"
                        rows={3}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Dívidas do devedor */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-amber-400" />
                      Dívidas
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {loadingDetail ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : debts.length === 0 ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        Nenhuma dívida ativa para este devedor.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">
                          Vincular ligação à dívida
                        </Label>
                        <div className="space-y-1.5">
                          {debts.map((d) => {
                            const isOpen = d.status === "aberto" || d.status === "em_negociacao";
                            const tone = DEBT_STATUS_LABEL[d.status as keyof typeof DEBT_STATUS_LABEL];
                            return (
                              <button
                                key={d.id}
                                type="button"
                                onClick={() => setDebtId(d.id)}
                                className={cn(
                                  "w-full rounded-md border px-3 py-2 text-left transition-colors",
                                  debtId === d.id
                                    ? "border-primary bg-primary/5"
                                    : "border-border/40 hover:bg-muted/40",
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium">
                                    {d.descricao ?? "Dívida sem descrição"}
                                  </span>
                                  <span className={cn(
                                    "text-sm font-semibold",
                                    isOpen ? "text-amber-300" : "text-muted-foreground",
                                  )}>
                                    {formatBRL(d.valor_atual)}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-3 w-3" />
                                    Venc.: {d.vencimento ? formatDate(d.vencimento).split(",")[0] : "—"}
                                  </span>
                                  {tone && (
                                    <Badge variant="outline" className={cn("h-5 px-1.5 text-[10px]", tone.tone)}>
                                      {tone.label}
                                    </Badge>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Resumo + Histórico */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <History className="h-4 w-4 text-sky-400" />
                    Histórico de ligações ({history.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {history.length === 0 ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      Nenhuma ligação registrada ainda para este número.
                    </div>
                  ) : (
                    <ul className="divide-y divide-border/30">
                      {history.map((c) => {
                        const stuck = isStuckCall(c);
                        return (
                          <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                            <div className="flex items-center gap-3 min-w-0">
                              {c.status === "completed" && !stuck ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                              ) : c.status === "failed" || c.status === "no_answer" || c.status === "busy" ? (
                                <X className="h-4 w-4 shrink-0 text-rose-400" />
                              ) : (
                                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <div className="min-w-0">
                                <p className="text-sm">
                                  {formatDate(c.started_at)}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {c.status} • {c.duration_seconds}s
                                  {c.collection_outcome && ` • ${c.collection_outcome}`}
                                </p>
                              </div>
                            </div>
                            {stuck && (
                              <div className="flex items-center gap-2 shrink-0">
                                <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/20">
                                  Pendente de finalização
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => handleFinalize(c.id)}
                                  disabled={finalizingId === c.id}
                                >
                                  {finalizingId === c.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <><RefreshCw className="mr-1 h-3 w-3" /> Finalizar</>
                                  )}
                                </Button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>

              {selectedDebt && (
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <User className="h-3.5 w-3.5" />
                  Esta ligação será registrada na dívida{" "}
                  <span className="font-semibold">
                    {selectedDebt.descricao ?? selectedDebt.id.slice(0, 8)}
                  </span>{" "}
                  ({formatBRL(selectedDebt.valor_atual)}).
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
