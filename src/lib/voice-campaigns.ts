import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type VoiceCampaignStatus =
  | "draft"
  | "scheduled"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type VoiceScriptMode = "script_readback" | "conversational" | "hybrid";

export type OutcomeCategory =
  | "interested"
  | "not_interested"
  | "callback_requested"
  | "voicemail"
  | "wrong_number"
  | "do_not_call"
  | "no_answer"
  | "busy"
  | "failed"
  | "escalated"
  | "other";

export const OUTCOME_CATEGORY_LABELS: Record<OutcomeCategory, string> = {
  interested: "Interessado",
  not_interested: "Sem interesse",
  callback_requested: "Pediu retorno",
  voicemail: "Correio de voz",
  wrong_number: "Número errado",
  do_not_call: "Não ligar mais",
  no_answer: "Sem resposta",
  busy: "Ocupado",
  failed: "Falhou",
  escalated: "Escalado",
  other: "Outro",
};

export const OUTCOME_CATEGORY_TONE: Record<OutcomeCategory, string> = {
  interested: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  callback_requested: "border-sky-500/40 text-sky-300 bg-sky-500/10",
  not_interested: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  voicemail: "border-violet-500/40 text-violet-300 bg-violet-500/10",
  wrong_number: "border-orange-500/40 text-orange-300 bg-orange-500/10",
  do_not_call: "border-red-500/40 text-red-300 bg-red-500/10",
  no_answer: "border-white/20 text-muted-foreground",
  busy: "border-white/20 text-muted-foreground",
  failed: "border-red-500/40 text-red-300 bg-red-500/10",
  escalated: "border-fuchsia-500/40 text-fuchsia-300 bg-fuchsia-500/10",
  other: "border-white/20 text-muted-foreground",
};

export interface EscalationRule {
  trigger: "keyword" | "no_response_sec" | "negative_sentiment" | "confidence_below" | "explicit_request";
  value?: string | number;
  action: "transfer_to_human" | "transfer_to_number" | "take_voicemail" | "hang_up" | "notify_only";
  target?: string;
}

export interface VoiceCampaign {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  persona_id: string | null;
  voice_id: string | null;
  language_code: string;
  script_mode: VoiceScriptMode;
  opening_script: string | null;
  system_prompt: string | null;
  phone_number_id: string | null;
  escalation_rules: EscalationRule[];
  max_call_duration_sec: number;
  voicemail_detection: boolean;
  record_call: boolean;
  status: VoiceCampaignStatus;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  canceled_after_placed: number | null;
  test_mode: boolean;
  contact_count: number;
  placed_count: number;
  connected_count: number;
  escalated_count: number;
  voicemail_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export async function listVoiceCampaigns(accountId: string): Promise<VoiceCampaign[]> {
  const { data, error } = await (supabase as any)
    .from("voice_campaigns")
    .select("*")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as VoiceCampaign[];
}

export async function getVoiceCampaign(campaignId: string): Promise<VoiceCampaign | null> {
  const { data, error } = await (supabase as any)
    .from("voice_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as VoiceCampaign | null;
}

export interface CampaignCollectionConfig {
  /** % de desconto à vista. 0-100. */
  discount_pct?: number;
  /** Número máximo de parcelas permitido. */
  max_installments?: number;
  /** Valor mínimo por parcela em BRL. */
  min_installment_value?: number;
  /** Dias mínimos da hoje pra primeira parcela. */
  first_due_min_days?: number;
  /** Dias máximos da hoje pra primeira parcela. */
  first_due_max_days?: number;
  /** Honrar lista DNC. */
  respect_dnc?: boolean;
  /** Honrar janela legal de contato. */
  respect_window?: boolean;
  /** Pular feriados nacionais. */
  skip_holidays?: boolean;
  /** Critério de prioridade na fila. */
  priority_by?: "valor_desc" | "atraso_desc" | "vencimento_asc";
}

export interface StartVoiceCampaignInput {
  accountId: string;
  name: string;
  description?: string;
  personaId?: string;
  voiceId?: string;
  phoneNumberId: string;
  languageCode?: string;
  scriptMode: VoiceScriptMode;
  openingScript?: string;
  systemPrompt?: string;
  contactIds: string[];
  escalationRules?: EscalationRule[];
  maxCallDurationSec?: number;
  voicemailDetection?: boolean;
  recordCall?: boolean;
  scheduledFor?: string | null;
  variablesByContact?: Record<string, Record<string, unknown>>;
  /** F2: Disparar só para os 3 primeiros contatos. */
  testMode?: boolean;
  /** Regras de negociação específicas desta campanha. */
  collectionConfig?: CampaignCollectionConfig;
  /** Quotas de disparo (NULL/undefined = sem limite). */
  quotas?: {
    max_calls_per_day?: number | null;
    max_calls_per_week?: number | null;
    max_calls_per_month?: number | null;
    max_messages_per_day?: number | null;
    max_messages_per_week?: number | null;
    max_messages_per_month?: number | null;
  };
}

export async function startVoiceCampaign(input: StartVoiceCampaignInput) {
  const { data, error } = await supabase.functions.invoke("voice-campaign-start", {
    body: {
      account_id: input.accountId,
      name: input.name,
      description: input.description,
      persona_id: input.personaId,
      voice_id: input.voiceId,
      phone_number_id: input.phoneNumberId,
      language_code: input.languageCode ?? "pt-BR",
      script_mode: input.scriptMode,
      opening_script: input.openingScript,
      system_prompt: input.systemPrompt,
      contact_ids: input.contactIds,
      escalation_rules: input.escalationRules ?? [],
      max_call_duration_sec: input.maxCallDurationSec ?? 300,
      voicemail_detection: input.voicemailDetection ?? true,
      record_call: input.recordCall ?? true,
      scheduled_for: input.scheduledFor ?? null,
      variables_by_contact: input.variablesByContact ?? {},
      test_mode: input.testMode === true,
      collection_config: input.collectionConfig,
      quotas: input.quotas ?? null,
    },
  });
  if (error) throw error;
  return data as { campaign_id: string; queued: number; skipped: number };
}

export async function pauseVoiceCampaign(campaignId: string) {
  const { error } = await (supabase as any)
    .from("voice_campaigns")
    .update({ status: "paused" })
    .eq("id", campaignId);
  if (error) throw error;
}

export async function resumeVoiceCampaign(campaignId: string) {
  const { error } = await (supabase as any)
    .from("voice_campaigns")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", campaignId);
  if (error) throw error;
}

export async function deleteVoiceCampaign(campaignId: string) {
  const { data, error } = await supabase.rpc("delete_voice_campaign", {
    p_campaign_id: campaignId,
  });
  if (error) {
    if (error.message.includes("campaign_has_call_history")) {
      throw new Error("Campanhas com histórico de ligações não podem ser excluídas.");
    }
    if (error.message.includes("campaign_is_active")) {
      throw new Error("Pause ou cancele a campanha antes de excluí-la.");
    }
    throw error;
  }
  return data;
}

/**
 * Cancela campanha + invoca edge pra abortar chamadas Twilio em curso.
 * E7: Snapshot do `placed_count` no momento do cancel pra mostrar "cancelada após X chamadas".
 */
export async function cancelVoiceCampaign(campaignId: string) {
  // Read current placed_count so we can snapshot it
  const { data: current } = await (supabase as any)
    .from("voice_campaigns")
    .select("placed_count")
    .eq("id", campaignId)
    .maybeSingle();
  const placedSnapshot = (current as any)?.placed_count ?? 0;

  // Hard-stop active calls first
  try {
    await supabase.functions.invoke("voice-call-cancel", {
      body: { campaign_id: campaignId },
    });
  } catch (e) {
    console.error("[cancelVoiceCampaign] voice-call-cancel failed", e);
  }
  const nowIso = new Date().toISOString();
  const { error } = await (supabase as any)
    .from("voice_campaigns")
    .update({
      status: "canceled",
      completed_at: nowIso,
      canceled_at: nowIso,
      canceled_after_placed: placedSnapshot,
    })
    .eq("id", campaignId);
  if (error) throw error;
}

/** Cancela uma única chamada ativa. */
export async function cancelSingleCall(voiceCallId: string) {
  const { data, error } = await supabase.functions.invoke("voice-call-cancel", {
    body: { voice_call_id: voiceCallId },
  });
  if (error) throw error;
  return data as { ok: boolean; canceled: number; errors: string[] };
}

/** F1: Export results as CSV. Returns a Blob ready for download. */
export async function exportVoiceCampaignCsv(campaignId: string): Promise<{ blob: Blob; filename: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("not authenticated");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const res = await fetch(`${supabaseUrl}/functions/v1/voice-campaign-export`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ campaign_id: campaignId }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`export failed (${res.status}): ${txt.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") ?? "";
  const m = cd.match(/filename="([^"]+)"/);
  const filename = m?.[1] ?? `campanha-${campaignId}.csv`;
  return { blob, filename };
}

// ── Live stats hook ────────────────────────────────────────────────

export interface VoiceCallLite {
  id: string;
  to_number: string;
  status: string;
  duration_seconds: number | null;
  outcome_category: OutcomeCategory | null;
  outcome_summary: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  metadata: Record<string, any> | null;
}

export interface CampaignLiveStats {
  loading: boolean;
  calls: VoiceCallLite[];
  active: VoiceCallLite[];
  finished: VoiceCallLite[];
  byStatus: Record<string, number>;
  byOutcome: Partial<Record<OutcomeCategory, number>>;
  totalContacts: number;
  placed: number;
  remaining: number;
  velocityPerMin: number;
  etaMinutes: number | null;
  conversionRate: number;
  reload: () => Promise<void>;
}

/**
 * Hook: subscribe à campanha em tempo real.
 * Recarrega lista de voice_calls quando voice_campaign_contacts muda.
 */
export function useCampaignLiveStats(campaignId: string | null): CampaignLiveStats {
  const [calls, setCalls] = useState<VoiceCallLite[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!campaignId) return;
    // 1. Get all voice_call_ids for this campaign
    const { data: contacts } = await (supabase as any)
      .from("voice_campaign_contacts")
      .select("voice_call_id, status")
      .eq("campaign_id", campaignId);

    const callIds = (contacts ?? [])
      .map((c: any) => c.voice_call_id)
      .filter(Boolean) as string[];

    setTotalContacts((contacts ?? []).length);

    if (callIds.length === 0) {
      setCalls([]);
      setLoading(false);
      return;
    }

    const { data: voiceCalls } = await (supabase as any)
      .from("voice_calls")
      .select("id, to_number, status, duration_seconds, outcome_category, outcome_summary, started_at, ended_at, created_at, metadata")
      .in("id", callIds)
      .order("created_at", { ascending: false });

    setCalls((voiceCalls ?? []) as VoiceCallLite[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!campaignId) return;
    setLoading(true);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // Realtime subscription
  // E8: Filter voice_calls UPDATEs by call IDs for this campaign so we don't process
  // every call event in the workspace.
  useEffect(() => {
    if (!campaignId) return;
    const callIdSet = new Set(calls.map((c) => c.id));
    const callIdList = Array.from(callIdSet);

    const channel = supabase
      .channel(`campaign-live:${campaignId}:${callIdList.length}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "voice_campaign_contacts",
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => load(),
      );

    if (callIdList.length > 0) {
      // Postgres `id=in.(uuid1,uuid2,...)` filter
      const filter = `id=in.(${callIdList.join(",")})`;
      channel.on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "voice_calls", filter },
        (payload) => {
          setCalls((prev) => {
            const idx = prev.findIndex((c) => c.id === (payload.new as any).id);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], ...(payload.new as any) };
            return next;
          });
        },
      );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, calls.length]);

  const stats = useMemo(() => {
    const active = calls.filter((c) => ["queued", "ringing", "in_progress"].includes(c.status));
    const finished = calls.filter((c) => !["queued", "ringing", "in_progress"].includes(c.status));

    const byStatus: Record<string, number> = {};
    const byOutcome: Partial<Record<OutcomeCategory, number>> = {};
    for (const c of calls) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      if (c.outcome_category) {
        byOutcome[c.outcome_category] = (byOutcome[c.outcome_category] ?? 0) + 1;
      }
    }

    const placed = calls.length;
    const remaining = Math.max(0, totalContacts - placed);

    // Velocity: calls finished in the last 5 minutes
    const cutoff = Date.now() - 5 * 60 * 1000;
    const recentFinished = finished.filter((c) => {
      const t = c.ended_at ? new Date(c.ended_at).getTime() : 0;
      return t > cutoff;
    });
    const velocityPerMin = recentFinished.length / 5;
    const etaMinutes = velocityPerMin > 0 ? Math.ceil(remaining / velocityPerMin) : null;

    const answered = (byOutcome.interested ?? 0) +
      (byOutcome.not_interested ?? 0) +
      (byOutcome.callback_requested ?? 0) +
      (byOutcome.do_not_call ?? 0) +
      (byOutcome.escalated ?? 0);
    const positive = (byOutcome.interested ?? 0) + (byOutcome.callback_requested ?? 0);
    const conversionRate = answered > 0 ? positive / answered : 0;

    return {
      active,
      finished,
      byStatus,
      byOutcome,
      placed,
      remaining,
      velocityPerMin,
      etaMinutes,
      conversionRate,
    };
  }, [calls, totalContacts]);

  return {
    loading,
    calls,
    totalContacts,
    reload: load,
    ...stats,
  };
}

/** Reclassifica manualmente uma chamada (admin). E5: usa edge dedicada com validação de ownership. */
export async function reclassifyCall(voiceCallId: string) {
  const { data, error } = await supabase.functions.invoke("voice-reclassify", {
    body: { voice_call_id: voiceCallId },
  });
  if (error) throw error;
  if (data && (data as any).ok === false) {
    throw new Error((data as any).error ?? "reclassification failed");
  }
  return data as { ok: true; classification: { category: string; confidence: number; summary: string } };
}
