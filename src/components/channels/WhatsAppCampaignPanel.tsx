import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, CheckCircle2, ChevronDown, Loader2, Megaphone, Pause, Play, Search, Users, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { fetchDebtors, formatBRL, type DebtorRow } from "@/lib/debtors";
import { controlWhatsAppCampaign, createWhatsAppCampaign } from "@/lib/whatsapp-campaigns.functions";
import { listWhatsAppCampaigns, type WhatsAppCampaign } from "@/lib/whatsapp-campaigns";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "Agendada", variant: "outline" },
  running: { label: "Em andamento", variant: "default" },
  paused: { label: "Pausada", variant: "secondary" },
  completed: { label: "Concluída", variant: "outline" },
  failed: { label: "Com problema", variant: "destructive" },
  canceled: { label: "Cancelada", variant: "secondary" },
};

export function WhatsAppCampaignPanel({ accountId, enabled, isAdmin }: { accountId: string; enabled: boolean; isAdmin: boolean }) {
  const createCampaign = useServerFn(createWhatsAppCampaign);
  const controlCampaign = useServerFn(controlWhatsAppCampaign);
  const [campaigns, setCampaigns] = useState<WhatsAppCampaign[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<"selected" | "all_open">("selected");
  const [timing, setTiming] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState("");
  const [query, setQuery] = useState("");
  const [debtors, setDebtors] = useState<DebtorRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try { setCampaigns(await listWhatsAppCampaigns(accountId)); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível carregar as campanhas"); }
    finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { void loadCampaigns(); }, [loadCampaigns]);
  useEffect(() => {
    if (!open || audience !== "selected") return;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const result = await fetchDebtors(accountId, { q: query, limit: 50, status: "aberto" });
        setDebtors(result.rows.filter((debtor) => debtor.phone_number && debtor.valor_aberto > 0));
      } catch { setDebtors([]); }
      finally { setSearching(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [accountId, audience, open, query]);

  async function submit() {
    setSaving(true);
    try {
      const result = await createCampaign({ data: {
        accountId,
        name,
        audienceMode: audience,
        contactIds: selected,
        scheduledFor: timing === "scheduled" && scheduledFor ? new Date(scheduledFor).toISOString() : null,
      } });
      toast.success(`${result.queued} devedor${result.queued === 1 ? "" : "es"} adicionado${result.queued === 1 ? "" : "s"} à campanha`);
      setOpen(false); setName(""); setSelected([]); setScheduledFor(""); setTiming("now");
      await loadCampaigns();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível criar a campanha"); }
    finally { setSaving(false); }
  }

  async function control(campaignId: string, action: "pause" | "resume" | "cancel") {
    try {
      await controlCampaign({ data: { campaignId, action } });
      toast.success(action === "pause" ? "Campanha pausada" : action === "resume" ? "Campanha retomada" : "Campanha cancelada");
      await loadCampaigns();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a campanha"); }
  }

  return <>
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Megaphone className="mt-0.5 h-5 w-5 text-primary" /><div><h2 className="font-semibold">Campanhas automáticas</h2><p className="text-sm text-muted-foreground">A Bia cria uma mensagem individual usando os dados da dívida.</p></div></div>
        <Button onClick={() => setOpen(true)} disabled={!enabled || !isAdmin}><Megaphone />Nova campanha</Button>
      </div>
      {!enabled && <p className="mt-3 text-xs text-muted-foreground">Conecte o WhatsApp e ative a Bia para liberar campanhas.</p>}
      <div className="mt-5 border-t border-border pt-4">
        {loading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : campaigns.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma campanha criada.</p> : <div className="space-y-3">
          {campaigns.slice(0, expanded ? campaigns.length : 5).map((campaign) => {
            const status = STATUS[campaign.status] ?? { label: campaign.status, variant: "outline" as const };
            return <div key={campaign.id} className="rounded-md border border-border p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{campaign.name}</p><Badge variant={status.variant}>{status.label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{campaign.audience_mode === "all_open" ? "Todos em aberto" : "Seleção da carteira"} · limite {campaign.daily_limit}/dia{campaign.scheduled_for ? ` · ${new Date(campaign.scheduled_for).toLocaleString("pt-BR")}` : ""}</p></div>
                <div className="flex gap-2">{campaign.status === "running" && <Button size="icon" variant="outline" aria-label="Pausar campanha" title="Pausar" onClick={() => void control(campaign.id, "pause")}><Pause /></Button>}{campaign.status === "paused" && <Button size="icon" variant="outline" aria-label="Retomar campanha" title="Retomar" onClick={() => void control(campaign.id, "resume")}><Play /></Button>}{["running", "paused", "scheduled"].includes(campaign.status) && <Button size="icon" variant="ghost" aria-label="Cancelar campanha" title="Cancelar" onClick={() => void control(campaign.id, "cancel")}><XCircle /></Button>}</div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5"><span><Users className="mr-1 inline h-3.5 w-3.5" />{campaign.contact_count} devedores</span><span>{campaign.sent_count} enviadas</span><span>{campaign.replied_count} respostas</span><span>{campaign.failed_count} falhas</span><span>{campaign.skipped_count} ignorados</span></div>
              {campaign.last_error && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{campaign.last_error}</p>}
            </div>;
          })}
          {campaigns.length > 5 && <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}><ChevronDown className={expanded ? "rotate-180" : ""} />{expanded ? "Mostrar menos" : `Ver mais ${campaigns.length - 5}`}</Button>}
        </div>}
      </div>
    </section>

    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>Nova campanha no WhatsApp</DialogTitle><DialogDescription>A Bia prepara cada mensagem com nome, valor e vencimento cadastrados.</DialogDescription></DialogHeader>
        <div className="space-y-5">
          <div className="space-y-1.5"><Label htmlFor="campaign-name">Nome da campanha</Label><Input id="campaign-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Cobrança de setembro" /></div>
          <div className="space-y-2"><Label>Quem receberá</Label><RadioGroup value={audience} onValueChange={(value) => setAudience(value as "selected" | "all_open")} className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="selected" /><span><span className="block text-sm font-medium">Selecionar da carteira</span><span className="text-xs text-muted-foreground">Marque os devedores antes de iniciar.</span></span></label>
            <label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="all_open" /><span><span className="block text-sm font-medium">Todos em aberto</span><span className="text-xs text-muted-foreground">Inclui quem tem dívida aberta e WhatsApp válido.</span></span></label>
          </RadioGroup></div>
          {audience === "selected" && <div className="space-y-2"><Label>Devedores ({selected.length} selecionados)</Label><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome ou telefone" className="pl-9" /></div><div className="max-h-56 overflow-y-auto rounded-md border border-border">{searching ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : debtors.map((debtor) => <label key={debtor.contact_id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-0"><Checkbox checked={selected.includes(debtor.contact_id)} onCheckedChange={(checked) => setSelected((current) => checked ? [...new Set([...current, debtor.contact_id])] : current.filter((id) => id !== debtor.contact_id))} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{debtor.name ?? "Sem nome"}</span><span className="block truncate text-xs text-muted-foreground">{debtor.phone_number} · {formatBRL(debtor.valor_aberto)}</span></span></label>)}</div></div>}
          <div className="space-y-2"><Label>Quando começar</Label><RadioGroup value={timing} onValueChange={(value) => setTiming(value as "now" | "scheduled")} className="grid gap-3 sm:grid-cols-2"><label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="now" /><Play className="h-4 w-4" /><span className="text-sm font-medium">Enviar agora</span></label><label className="flex cursor-pointer gap-3 rounded-md border border-border p-3"><RadioGroupItem value="scheduled" /><CalendarClock className="h-4 w-4" /><span className="text-sm font-medium">Agendar data e hora</span></label></RadioGroup>{timing === "scheduled" && <Input aria-label="Data e hora do envio" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />}</div>
          <div className="flex gap-3 rounded-md border border-border bg-muted/30 p-3"><CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /><p className="text-xs text-muted-foreground">Limite inicial de 100 mensagens por dia. Números bloqueados, inválidos ou sem dívida aberta não recebem.</p></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button><Button onClick={() => void submit()} disabled={saving || !name.trim() || (audience === "selected" && selected.length === 0) || (timing === "scheduled" && !scheduledFor)}>{saving ? <Loader2 className="animate-spin" /> : <Megaphone />}Criar campanha</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}