import { useState } from "react";
import { Loader2, Pause, Play, X, PhoneCall, Voicemail, AlertCircle, PhoneForwarded, Sparkles, RefreshCw, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  cancelSingleCall,
  cancelVoiceCampaign,
  deleteVoiceCampaign,
  exportVoiceCampaignCsv,
  pauseVoiceCampaign,
  reclassifyCall,
  resumeVoiceCampaign,
  useCampaignLiveStats,
  OUTCOME_CATEGORY_LABELS,
  OUTCOME_CATEGORY_TONE,
  type VoiceCampaign,
  type OutcomeCategory,
  type VoiceCallLite,
} from "@/lib/voice-campaigns";

export function VoiceCampaignDetailDrawer({
  campaign,
  open,
  onOpenChange,
  onChanged,
}: {
  campaign: VoiceCampaign | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
}) {
  const stats = useCampaignLiveStats(open && campaign ? campaign.id : null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!campaign) return null;

  const isActive = campaign.status === "running" || campaign.status === "scheduled";
  const progressPct = stats.totalContacts > 0
    ? Math.round((stats.placed / stats.totalContacts) * 100)
    : 0;

  const handlePause = async () => {
    setBusy("pause");
    try { await pauseVoiceCampaign(campaign.id); toast.success("Pausada"); onChanged(); }
    catch { toast.error("Falha ao pausar"); }
    finally { setBusy(null); }
  };
  const handleResume = async () => {
    setBusy("resume");
    try { await resumeVoiceCampaign(campaign.id); toast.success("Retomada"); onChanged(); }
    catch { toast.error("Falha ao retomar"); }
    finally { setBusy(null); }
  };
  const handleCancelAll = async () => {
    if (!confirm("Cancelar campanha e abortar TODAS as chamadas em curso? Esta ação é definitiva.")) return;
    setBusy("cancel");
    try {
      await cancelVoiceCampaign(campaign.id);
      toast.success("Campanha cancelada — chamadas em curso abortadas");
      onChanged();
    } catch { toast.error("Falha ao cancelar"); }
    finally { setBusy(null); }
  };
  const handleExport = async () => {
    setBusy("export");
    try {
      const { blob, filename } = await exportVoiceCampaignCsv(campaign.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("CSV exportado");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao exportar");
    } finally {
      setBusy(null);
    }
  };
  const handleDelete = async () => {
    setBusy("delete");
    try {
      await deleteVoiceCampaign(campaign.id);
      toast.success("Campanha excluída");
      onOpenChange(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir a campanha");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate">{campaign.name}</SheetTitle>
              <SheetDescription className="truncate">
                {campaign.description ?? `${campaign.script_mode} · ${stats.totalContacts} contatos`}
              </SheetDescription>
            </div>
            <div className="flex shrink-0 gap-1">
              {campaign.status === "running" && (
                <Button size="sm" variant="outline" onClick={handlePause} disabled={busy !== null}>
                  {busy === "pause" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                  <span className="ml-1">Pausar</span>
                </Button>
              )}
              {campaign.status === "paused" && (
                <Button size="sm" variant="outline" onClick={handleResume} disabled={busy !== null}>
                  {busy === "resume" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                  <span className="ml-1">Retomar</span>
                </Button>
              )}
              {isActive && (
                <Button size="sm" variant="outline" className="text-red-400 hover:text-red-300" onClick={handleCancelAll} disabled={busy !== null}>
                  {busy === "cancel" ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                  <span className="ml-1">Cancelar tudo</span>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleExport} disabled={busy !== null} title="Exportar CSV">
                {busy === "export" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                <span className="ml-1">CSV</span>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy !== null}>
                    {busy === "delete" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    <span className="ml-1">Excluir</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir campanha “{campaign.name}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {campaign.placed_count > 0
                        ? "Esta campanha possui histórico de ligações e não pode ser excluída. Cancele-a para mantê-la apenas como histórico."
                        : isActive
                          ? "Pause ou cancele esta campanha antes de excluí-la."
                          : "A campanha e sua lista de contatos serão removidas. Essa ação não pode ser desfeita."}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{campaign.placed_count > 0 || isActive ? "Entendi" : "Cancelar"}</AlertDialogCancel>
                    {campaign.placed_count === 0 && !isActive && (
                      <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
                        Excluir
                      </AlertDialogAction>
                    )}
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Progress */}
          <div className="glass rounded-lg p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Progresso</span>
              <span className="font-mono font-medium">
                {stats.placed}/{stats.totalContacts} ({progressPct}%)
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-violet-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span>
                {stats.etaMinutes !== null ? `ETA ~${stats.etaMinutes}min` : "ETA —"}
              </span>
              <span>·</span>
              <span>{stats.velocityPerMin.toFixed(1)} chamadas/min</span>
              {campaign.status === "running" && (
                <span className="ml-auto flex items-center gap-1 text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  AO VIVO
                </span>
              )}
            </div>
          </div>

          {/* Outcome breakdown */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <OutcomeBox label="Atendidas" value={(stats.byOutcome.interested ?? 0) + (stats.byOutcome.not_interested ?? 0) + (stats.byOutcome.callback_requested ?? 0) + (stats.byOutcome.do_not_call ?? 0) + (stats.byOutcome.escalated ?? 0)} icon={PhoneCall} accent="sky" />
            <OutcomeBox label="Voicemail" value={stats.byOutcome.voicemail ?? 0} icon={Voicemail} accent="violet" />
            <OutcomeBox label="Falha" value={(stats.byOutcome.failed ?? 0) + (stats.byStatus.failed ?? 0)} icon={AlertCircle} accent="red" />
            <OutcomeBox label="Escaladas" value={stats.byOutcome.escalated ?? 0} icon={PhoneForwarded} accent="fuchsia" />
            <OutcomeBox label="Interessados" value={stats.byOutcome.interested ?? 0} icon={Sparkles} accent="emerald" />
            <OutcomeBox label="Conversão" value={`${Math.round(stats.conversionRate * 100)}%`} accent="emerald" />
          </div>

          {/* Active calls */}
          {stats.active.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Em andamento ({stats.active.length})
              </p>
              <div className="space-y-1">
                {stats.active.map((c) => (
                  <ActiveCallRow key={c.id} call={c} onCanceled={stats.reload} />
                ))}
              </div>
            </div>
          )}

          {/* Finished calls */}
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Últimas finalizadas ({stats.finished.length})
            </p>
            {stats.loading ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando…
              </div>
            ) : stats.finished.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">nenhuma ainda</p>
            ) : (
              <div className="space-y-1">
                {stats.finished.slice(0, 25).map((c) => (
                  <FinishedCallRow key={c.id} call={c} onReclassified={stats.reload} />
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OutcomeBox({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon?: any;
  accent?: "emerald" | "sky" | "violet" | "red" | "fuchsia";
}) {
  const color = accent
    ? {
        emerald: "text-emerald-400",
        sky: "text-sky-400",
        violet: "text-violet-400",
        red: "text-red-400",
        fuchsia: "text-fuchsia-400",
      }[accent]
    : "text-muted-foreground";
  return (
    <div className="glass rounded-md px-3 py-2">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className={cn("h-3 w-3", color)} />}
        <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={cn("mt-0.5 text-base font-semibold tabular-nums", color)}>{value}</p>
    </div>
  );
}

function ActiveCallRow({ call, onCanceled }: { call: VoiceCallLite; onCanceled: () => void }) {
  const [busy, setBusy] = useState(false);
  const elapsed = call.started_at
    ? Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000)
    : 0;

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelSingleCall(call.id);
      toast.success("Chamada cancelada");
      onCanceled();
    } catch { toast.error("Falha ao cancelar"); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-white/[0.06] px-2.5 py-1.5 text-xs">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">{call.to_number}</span>
      <span className="ml-auto text-[10px] text-muted-foreground">
        {call.status === "ringing" ? "chamando" : elapsed > 0 ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}` : call.status}
      </span>
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={handleCancel} disabled={busy}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
      </Button>
    </div>
  );
}

function FinishedCallRow({ call, onReclassified }: { call: VoiceCallLite; onReclassified: () => void }) {
  const [busy, setBusy] = useState(false);
  const cat = call.outcome_category as OutcomeCategory | null;

  const handleReclassify = async () => {
    setBusy(true);
    try {
      await reclassifyCall(call.id);
      toast.success("Reclassificando…");
      setTimeout(onReclassified, 1500);
    } catch (e: any) { toast.error(e?.message ?? "Falha"); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-white/[0.04] px-2.5 py-1.5 text-xs">
      <span className="font-mono text-[10px] text-muted-foreground">{call.to_number}</span>
      {cat ? (
        <Badge variant="outline" className={cn("text-[9px]", OUTCOME_CATEGORY_TONE[cat])}>
          {OUTCOME_CATEGORY_LABELS[cat]}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[9px] text-muted-foreground">{call.status}</Badge>
      )}
      {call.duration_seconds ? (
        <span className="text-[10px] text-muted-foreground">
          {Math.floor(call.duration_seconds / 60)}:{String(call.duration_seconds % 60).padStart(2, "0")}
        </span>
      ) : null}
      <span className="ml-auto truncate text-[10px] text-muted-foreground" title={call.outcome_summary ?? undefined}>
        {call.outcome_summary?.slice(0, 60) ?? ""}
      </span>
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleReclassify} disabled={busy} title="Reclassificar">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      </Button>
    </div>
  );
}
