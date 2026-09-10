// deno-lint-ignore-file no-explicit-any
//
// collection-extract-arrangement
// ------------------------------
// Lê o transcript de uma chamada e:
//   1. Classifica outcome via heurística (regex PT-BR) — mesma lógica de
//      collection-classify-outcome.
//   2. Se outcome ∈ {acordo, cpc, pago}: chama Lovable AI Gateway pra
//      EXTRAIR estruturadamente (tool calling) {acordo_fechado, valor,
//      parcelas, metodo, prazo, confianca}.
//   3. Se acordo_fechado=true && confianca≥0.6 && não existe arrangement
//      pra essa call → cria payment_arrangements em pendente_aprovacao
//      com source='transcript_extraction'.
//
// Idempotente — se collection_outcome já está setado E já existe
// arrangement linkado, retorna sem refazer.
//
// Body (modo voz): { voice_call_id: uuid, transcript?: string, summary?: string }
// Body (modo whatsapp): { conversation_id: uuid, contact_id?: uuid, debt_id?: uuid }
//
// No modo whatsapp, o transcript é construído a partir das últimas mensagens
// não-privadas da conversa. O acordo é gravado com source='whatsapp_extraction'
// e referencia conversation_id + message_id (última msg do contato).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Outcome =
  | "cpc" | "cpct" | "nao_atende" | "caixa_postal" | "numero_errado"
  | "recusa" | "dnc_solicitado" | "acordo" | "pago" | "sem_resultado";

const DNC_PATTERNS = [
  /n[aã]o\s+(me\s+)?liga?\s+mais/i,
  /tira\s+(meu\s+)?(n[uú]mero|da\s+lista)/i,
  /n[aã]o\s+quero\s+(mais\s+)?(receber|liga[cç][aã]o)/i,
  /pare\s+de\s+(me\s+)?ligar/i,
];
const WRONG_NUMBER_PATTERNS = [
  /n[uú]mero\s+errado/i,
  /n[aã]o\s+conhe[cç]o/i,
  /pessoa\s+errada/i,
];
const PAID_PATTERNS = [/j[aá]\s+paguei/i, /j[aá]\s+foi\s+pago/i, /quita(do|da|r)/i];
const AGREEMENT_PATTERNS = [
  /aceito|fech(ou|amos)\s+o?\s*acordo/i,
  /pode\s+(mandar|enviar)\s+o?\s+link/i,
  /vou\s+pagar\s+(hoje|amanh[aã]|at[eé]|nessa|essa\s+sexta)/i,
  /quero\s+parcel/i,
  /fica\s+em\s+\d+\s*x/i,
  /vamos\s+fechar/i,
  /combinad[oa]/i,
  /pode\s+gerar\s+(o\s+)?(boleto|pix|link)/i,
];
const REFUSAL_PATTERNS = [
  /n[aã]o\s+vou\s+pagar/i,
  /n[aã]o\s+tenho\s+(como|dinheiro|condi)/i,
  /desempreg/i,
];

function heuristicClassify(transcript: string, metadata: any): { outcome: Outcome; confidence: number } {
  const t = (transcript || "").toLowerCase();
  const status = metadata?.call_status ?? metadata?.status;
  if (status === "no_answer") return { outcome: "nao_atende", confidence: 0.95 };
  if (!t || t.length < 30) return { outcome: "sem_resultado", confidence: 0.3 };
  // ORDEM IMPORTA: acordo vence recusa quando ambos aparecem (devedor pode
  // dizer "não tenho como pagar 7x mas aceito 1x"). DNC > wrong > pago > acordo > recusa.
  for (const p of DNC_PATTERNS) if (p.test(t)) return { outcome: "dnc_solicitado", confidence: 0.9 };
  for (const p of WRONG_NUMBER_PATTERNS) if (p.test(t)) return { outcome: "numero_errado", confidence: 0.85 };
  for (const p of PAID_PATTERNS) if (p.test(t)) return { outcome: "pago", confidence: 0.75 };
  for (const p of AGREEMENT_PATTERNS) if (p.test(t)) return { outcome: "acordo", confidence: 0.78 };
  for (const p of REFUSAL_PATTERNS) if (p.test(t)) return { outcome: "recusa", confidence: 0.75 };
  // Fallback: sempre cpc (não recusa) — o LLM decide se foi acordo de fato
  return { outcome: "cpc", confidence: 0.4 };
}

interface ExtractedArrangement {
  acordo_fechado: boolean;
  confianca: number;
  valor_total: number | null;
  num_parcelas: number | null;
  metodo: string | null;
  prazo_dias_primeiro_pagamento: number | null;
  observacao: string | null;
}

async function llmExtract(
  transcript: string,
  summary: string | null,
  context: { valor_debito: number | null; debtor_name: string | null },
): Promise<ExtractedArrangement | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;

  const sample = (transcript || summary || "").slice(0, 6000);

  const body = {
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content:
          "Você analisa transcrições de chamadas de cobrança em PT-BR. Sua única tarefa é decidir se houve um ACORDO DE PAGAMENTO concreto entre o agente e o devedor, e extrair os termos. Seja conservador: só marque acordo_fechado=true se o devedor explicitamente concordou em pagar (não basta ouvir a oferta — o devedor precisa aceitar).",
      },
      {
        role: "user",
        content:
          `Contexto:
- Valor original do débito: ${context.valor_debito != null ? `R$ ${context.valor_debito.toFixed(2)}` : "desconhecido"}
- Nome do devedor: ${context.debtor_name ?? "desconhecido"}
- Resumo do agente: ${summary ?? "(nenhum)"}

Transcrição:
${sample}

Responda chamando a função registrar_extracao com os campos extraídos. Se não houve acordo, acordo_fechado=false e demais campos null.`,
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "registrar_extracao",
          description: "Registra o que foi extraído da chamada sobre o acordo.",
          parameters: {
            type: "object",
            properties: {
              acordo_fechado: { type: "boolean", description: "true APENAS se o devedor aceitou explicitamente pagar." },
              confianca: { type: "number", description: "0 a 1, sua confiança na decisão de acordo_fechado." },
              valor_total: { type: ["number", "null"], description: "Valor total acordado em reais. Se à vista com desconto, é o valor líquido a pagar." },
              num_parcelas: { type: ["integer", "null"], description: "Número de parcelas. 1 para à vista." },
              metodo: { type: ["string", "null"], enum: ["pix", "boleto", "cartao", "parcelado", null], description: "Método combinado." },
              prazo_dias_primeiro_pagamento: { type: ["integer", "null"], description: "Em quantos dias a partir de hoje vence a primeira parcela." },
              observacao: { type: ["string", "null"], description: "Detalhes relevantes mencionados, em 1 frase." },
            },
            required: ["acordo_fechado", "confianca"],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "registrar_extracao" } },
  };

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn("[extract] AI HTTP", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    const args = JSON.parse(call.function?.arguments ?? "{}");
    return {
      acordo_fechado: Boolean(args.acordo_fechado),
      confianca: typeof args.confianca === "number" ? Math.max(0, Math.min(1, args.confianca)) : 0,
      valor_total: typeof args.valor_total === "number" ? args.valor_total : null,
      num_parcelas: Number.isInteger(args.num_parcelas) ? args.num_parcelas : null,
      metodo: typeof args.metodo === "string" ? args.metodo : null,
      prazo_dias_primeiro_pagamento: Number.isInteger(args.prazo_dias_primeiro_pagamento) ? args.prazo_dias_primeiro_pagamento : null,
      observacao: typeof args.observacao === "string" ? args.observacao : null,
    };
  } catch (e) {
    console.warn("[extract] AI exception", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    voice_call_id?: string;
    transcript?: string;
    summary?: string;
    conversation_id?: string;
    contact_id?: string;
    debt_id?: string;
  };
  try { body = await req.json(); } catch { return j({ error: "bad JSON" }, 400); }

  if (body.conversation_id) {
    return await handleConversation(admin, body);
  }
  if (body.voice_call_id) {
    return await handleVoiceCall(admin, body);
  }
  return j({ error: "voice_call_id or conversation_id required" }, 400);
});

// ────────────────────────────────────────────────────────────────────────────
// Modo VOZ — comportamento original
// ────────────────────────────────────────────────────────────────────────────
async function handleVoiceCall(
  admin: SupabaseClient,
  body: { voice_call_id?: string; transcript?: string; summary?: string },
): Promise<Response> {
  const { data: call } = await admin
    .from("voice_calls")
    .select(
      "id, account_id, to_number, debt_id, metadata, transcript, collection_outcome",
    )
    .eq("id", body.voice_call_id!)
    .maybeSingle();
  if (!call) return j({ error: "call not found" }, 404);

  const transcriptText = body.transcript ?? extractTranscriptText(call.transcript);
  const summary = body.summary ?? (call.metadata as any)?.summary ?? null;

  const heur = heuristicClassify(transcriptText, call.metadata ?? {});

  if (!call.collection_outcome) {
    await admin
      .from("voice_calls")
      .update({
        collection_outcome: heur.outcome,
        metadata: { ...(call.metadata as any), outcome_confidence: heur.confidence },
      })
      .eq("id", call.id);
  }

  const finalOutcome = call.collection_outcome ?? heur.outcome;
  const metadata = (call.metadata as any) ?? {};
  const debtId = call.debt_id || metadata.debt_id || metadata.variables?.debt_id || null;

  const { data: existingArr } = await admin
    .from("payment_arrangements")
    .select("id, status, source")
    .eq("voice_call_id", call.id)
    .maybeSingle();

  if (existingArr) {
    return j({
      ok: true,
      outcome: finalOutcome,
      arrangement_id: existingArr.id,
      already_had_arrangement: true,
      source: existingArr.source,
    });
  }

  const skipLlm = ["dnc_solicitado", "numero_errado", "nao_atende", "caixa_postal", "sem_resultado"].includes(finalOutcome);
  if (skipLlm || !debtId || !transcriptText || transcriptText.length < 50) {
    return j({ ok: true, outcome: finalOutcome, arrangement_id: null });
  }

  const { data: debt } = await admin
    .from("debts")
    .select("id, valor_atual, contact_id, account_id")
    .eq("id", debtId)
    .maybeSingle();
  if (!debt) return j({ ok: true, outcome: finalOutcome, arrangement_id: null, reason: "debt not found" });

  const debtorName = await fetchDebtorName(admin, debt.contact_id);

  const extracted = await llmExtract(transcriptText, summary, {
    valor_debito: Number(debt.valor_atual),
    debtor_name: debtorName,
  });

  if (!extracted || !extracted.acordo_fechado || extracted.confianca < 0.6) {
    return j({
      ok: true,
      outcome: finalOutcome,
      arrangement_id: null,
      llm_decision: extracted ?? null,
      reason: extracted ? "no_acordo_or_low_confidence" : "llm_unavailable",
    });
  }

  const { valorNegociado, parcelas, metodo, firstDueDate, violations, discountPct, firstDueWindow, campaignId } =
    await resolveArrangementTerms(admin, debt, extracted, metadata);

  const { data: arr, error: insErr } = await admin
    .from("payment_arrangements")
    .insert({
      account_id: debt.account_id,
      debt_id: debt.id,
      contact_id: debt.contact_id,
      voice_call_id: call.id,
      valor_negociado: valorNegociado,
      metodo,
      num_parcelas: parcelas,
      primeiro_vencimento: firstDueDate.toISOString().slice(0, 10),
      status: "pendente_aprovacao",
      source: "transcript_extraction",
      metadata: {
        valor_original: Number(debt.valor_atual),
        discount_pct_aplicado: parcelas === 1 && valorNegociado < Number(debt.valor_atual)
          ? Math.round((1 - valorNegociado / Number(debt.valor_atual)) * 1000) / 10
          : 0,
        campaign_id: campaignId,
        rule_violations: violations,
        first_due_window: firstDueWindow,
        source: "transcript_extraction",
        confianca: extracted.confianca,
        observacao: extracted.observacao,
      },
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("[extract] arrangement insert failed", insErr);
    return j({ error: "failed to create arrangement", details: insErr.message }, 500);
  }

  await admin
    .from("debts")
    .update({ status: "em_negociacao", last_call_at: new Date().toISOString() })
    .eq("id", debt.id);

  // BUGFIX: o LLM (com contexto completo) acabou de confirmar acordo_fechado
  // com confiança ≥ 0.6. A heurística regex pode ter classificado como
  // 'recusa' ou 'cpc' (ex.: devedor disse "não tenho como pagar X" ANTES de
  // aceitar Y). O LLM tem prioridade — sobrescrevemos o outcome para 'acordo'
  // pra histórico/dashboard refletirem a realidade.
  const overrideOutcome = finalOutcome !== "acordo" && finalOutcome !== "pago";
  if (overrideOutcome) {
    await admin
      .from("voice_calls")
      .update({
        collection_outcome: "acordo",
        metadata: {
          ...(call.metadata as any),
          outcome_confidence: extracted.confianca,
          outcome_overridden_from: finalOutcome,
          outcome_override_reason: "llm_extracted_acordo",
        },
      })
      .eq("id", call.id);
  }

  console.log(
    `[extract:voice] call=${call.id} debt=${debt.id} valor=${valorNegociado} parc=${parcelas} conf=${extracted.confianca} arr=${arr?.id} viol=${violations.length} override=${overrideOutcome}`,
  );

  return j({
    ok: true,
    outcome: overrideOutcome ? "acordo" : finalOutcome,
    outcome_overridden_from: overrideOutcome ? finalOutcome : null,
    arrangement_id: arr?.id ?? null,
    awaiting_approval: true,
    confianca: extracted.confianca,
    rule_violations: violations,
    source: "transcript_extraction",
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Modo WHATSAPP — extrai acordo a partir das mensagens da conversa
// ────────────────────────────────────────────────────────────────────────────
async function handleConversation(
  admin: SupabaseClient,
  body: { conversation_id?: string; contact_id?: string; debt_id?: string },
): Promise<Response> {
  const conversationId = body.conversation_id!;

  const { data: conv } = await admin
    .from("conversations")
    .select("id, account_id, contact_id, inbox_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return j({ error: "conversation not found" }, 404);

  const contactId = body.contact_id ?? conv.contact_id;
  if (!contactId) return j({ ok: true, arrangement_id: null, reason: "no contact" });

  // Resolve débito ativo do contato (mais recente em pendente/em_negociacao)
  let debtId = body.debt_id ?? null;
  if (!debtId) {
    const { data: debts } = await admin
      .from("debts")
      .select("id, valor_atual, contact_id, account_id, status, created_at")
      .eq("contact_id", contactId)
      .in("status", ["pendente", "em_negociacao"])
      .order("created_at", { ascending: false })
      .limit(1);
    debtId = debts?.[0]?.id ?? null;
  }
  if (!debtId) return j({ ok: true, arrangement_id: null, reason: "no active debt for contact" });

  // Carrega últimas mensagens da conversa
  const { data: msgs } = await admin
    .from("messages")
    .select("id, content, sender_type, created_at, private")
    .eq("conversation_id", conversationId)
    .eq("private", false)
    .order("created_at", { ascending: false })
    .limit(30);
  const ordered = (msgs ?? []).reverse().filter((m: any) => {
    const c = (m.content ?? "").trim();
    return c && c !== "[mensagem]" && c !== "[mídia]";
  });
  if (ordered.length < 2) {
    return j({ ok: true, arrangement_id: null, reason: "not enough messages" });
  }

  const transcriptText = ordered
    .map((m: any) => `${m.sender_type === "Contact" ? "Cliente" : "Agente"}: ${m.content}`)
    .join("\n");

  const lastContactMsg = [...ordered].reverse().find((m: any) => m.sender_type === "Contact");
  const messageId = lastContactMsg?.id ?? null;

  // Idempotência: arrangement existente para essa conversa em estado vivo?
  const { data: existingArr } = await admin
    .from("payment_arrangements")
    .select("id, status, source, updated_at")
    .eq("conversation_id", conversationId)
    .in("status", ["pendente_aprovacao", "aprovado", "aguardando_pagamento"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingArr) {
    // Se nenhuma msg de Contact após o updated_at do arrangement, nada a fazer
    const newer = lastContactMsg && new Date(lastContactMsg.created_at).getTime() >
      new Date(existingArr.updated_at).getTime();
    if (!newer) {
      return j({
        ok: true,
        arrangement_id: existingArr.id,
        already_had_arrangement: true,
        source: existingArr.source,
      });
    }
    // caso contrário, segue e re-extrai (pode ser renegociação)
  }

  const { data: debt } = await admin
    .from("debts")
    .select("id, valor_atual, contact_id, account_id")
    .eq("id", debtId)
    .maybeSingle();
  if (!debt) return j({ ok: true, arrangement_id: null, reason: "debt not found" });

  const debtorName = await fetchDebtorName(admin, contactId);

  const extracted = await llmExtract(transcriptText, null, {
    valor_debito: Number(debt.valor_atual),
    debtor_name: debtorName,
  });

  if (!extracted || !extracted.acordo_fechado || extracted.confianca < 0.6) {
    return j({
      ok: true,
      arrangement_id: null,
      llm_decision: extracted ?? null,
      reason: extracted ? "no_acordo_or_low_confidence" : "llm_unavailable",
    });
  }

  const { valorNegociado, parcelas, metodo, firstDueDate, violations, firstDueWindow, campaignId } =
    await resolveArrangementTerms(admin, debt, extracted, {});

  const { data: arr, error: insErr } = await admin
    .from("payment_arrangements")
    .insert({
      account_id: debt.account_id,
      debt_id: debt.id,
      contact_id: debt.contact_id,
      conversation_id: conversationId,
      message_id: messageId,
      valor_negociado: valorNegociado,
      metodo,
      num_parcelas: parcelas,
      primeiro_vencimento: firstDueDate.toISOString().slice(0, 10),
      status: "pendente_aprovacao",
      source: "whatsapp_extraction",
      metadata: {
        valor_original: Number(debt.valor_atual),
        discount_pct_aplicado: parcelas === 1 && valorNegociado < Number(debt.valor_atual)
          ? Math.round((1 - valorNegociado / Number(debt.valor_atual)) * 1000) / 10
          : 0,
        campaign_id: campaignId,
        rule_violations: violations,
        first_due_window: firstDueWindow,
        source: "whatsapp_extraction",
        confianca: extracted.confianca,
        observacao: extracted.observacao,
        channel: "whatsapp",
      },
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("[extract:whatsapp] insert failed", insErr);
    return j({ error: "failed to create arrangement", details: insErr.message }, 500);
  }

  await admin
    .from("debts")
    .update({ status: "em_negociacao" })
    .eq("id", debt.id);

  console.log(
    `[extract:whatsapp] conv=${conversationId} debt=${debt.id} valor=${valorNegociado} parc=${parcelas} conf=${extracted.confianca} arr=${arr?.id} viol=${violations.length}`,
  );

  return j({
    ok: true,
    arrangement_id: arr?.id ?? null,
    awaiting_approval: true,
    confianca: extracted.confianca,
    rule_violations: violations,
    source: "whatsapp_extraction",
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers compartilhados
// ────────────────────────────────────────────────────────────────────────────
async function fetchDebtorName(admin: SupabaseClient, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const { data: c } = await admin
    .from("contacts")
    .select("name")
    .eq("id", contactId)
    .maybeSingle();
  return (c?.name as string | null) ?? null;
}

async function resolveArrangementTerms(
  admin: SupabaseClient,
  debt: { account_id: string; valor_atual: number | string },
  extracted: ExtractedArrangement,
  metadata: any,
) {
  const campaignId = metadata?.campaign_id ?? metadata?.variables?.campaign_id ?? null;
  let discountPct = 0;
  let maxInstallments = 1;
  let minInstallmentValue = 0;
  let firstDueMinDays = 3;
  let firstDueMaxDays = 10;
  if (campaignId) {
    const { data: campaign } = await admin
      .from("voice_campaigns")
      .select("collection_config")
      .eq("id", campaignId)
      .maybeSingle();
    const conf = (campaign?.collection_config as any) ?? {};
    discountPct = Number(conf.discount_pct ?? 0);
    maxInstallments = Number(conf.max_installments ?? 1);
    minInstallmentValue = Number(conf.min_installment_value ?? 0);
    firstDueMinDays = Number(conf.first_due_min_days ?? 3);
    firstDueMaxDays = Number(conf.first_due_max_days ?? 10);
  } else {
    const { data: settings } = await admin
      .from("company_settings")
      .select("default_discount_pct, default_max_installments")
      .eq("account_id", debt.account_id)
      .maybeSingle();
    discountPct = Number(settings?.default_discount_pct ?? 10);
    maxInstallments = Number(settings?.default_max_installments ?? 1);
  }

  const valorBase = Number(debt.valor_atual);
  const parcelas = Math.max(1, extracted.num_parcelas ?? 1);
  const valorNegociado = extracted.valor_total != null && extracted.valor_total > 0
    ? extracted.valor_total
    : (parcelas === 1 && discountPct > 0
        ? Math.round(valorBase * (1 - discountPct / 100) * 100) / 100
        : valorBase);
  const metodo = (extracted.metodo ?? (parcelas > 1 ? "parcelado" : "pix")).toLowerCase();
  const dueDays = clamp(extracted.prazo_dias_primeiro_pagamento ?? firstDueMinDays, 1, 60);
  const firstDueDate = new Date();
  firstDueDate.setDate(firstDueDate.getDate() + dueDays);

  const violations: string[] = [];
  if (parcelas > maxInstallments) {
    violations.push(`parcelas_excedidas: extraído ${parcelas}x (máx ${maxInstallments}x)`);
  }
  if (parcelas === 1 && valorNegociado < valorBase) {
    const desc = (1 - valorNegociado / valorBase) * 100;
    if (desc > discountPct + 0.5) {
      violations.push(`desconto_excedido: extraído ${desc.toFixed(1)}% (máx ${discountPct}%)`);
    }
  }
  if (minInstallmentValue > 0 && parcelas > 1) {
    const vp = valorNegociado / parcelas;
    if (vp < minInstallmentValue - 0.01) {
      violations.push(`parcela_abaixo_minimo: ${vp.toFixed(2)} < ${minInstallmentValue}`);
    }
  }
  if (dueDays < firstDueMinDays || dueDays > firstDueMaxDays) {
    violations.push(`vencimento_fora_janela: ${dueDays} dias (janela ${firstDueMinDays}-${firstDueMaxDays})`);
  }

  return {
    valorNegociado,
    parcelas,
    metodo,
    firstDueDate,
    violations,
    discountPct,
    firstDueWindow: { min: firstDueMinDays, max: firstDueMaxDays },
    campaignId,
  };
}

function extractTranscriptText(transcript: any): string {
  if (!transcript) return "";
  if (typeof transcript === "string") return transcript;
  if (Array.isArray(transcript)) {
    return transcript
      .map((t: any) => {
        const role = t.role ?? t.speaker ?? "";
        const content = t.message ?? t.text ?? t.content ?? "";
        return `${role}: ${content}`;
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
