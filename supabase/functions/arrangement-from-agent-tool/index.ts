// deno-lint-ignore-file no-explicit-any
//
// Endpoint chamado pelo agente ElevenLabs (server tool: "registrar_acordo")
// no momento em que o devedor aceita um acordo durante a chamada.
//
// O agente envia os valores EXATOS combinados — não dependemos de regex
// no transcript. Validamos contra os tetos da campanha/empresa antes de
// inserir o payment_arrangement em status `pendente_aprovacao`.
//
// IDs de contexto (conversation_id, debt_id) vêm via HEADERS injetados
// automaticamente pelo ElevenLabs a partir das dynamic variables — o LLM
// NÃO precisa (e não deve) inventá-los no body. Mantemos fallback no body
// por compatibilidade.
//
// Body esperado:
// {
//   valor_negociado: number,             // valor total acordado (R$)
//   num_parcelas?: number,               // 1 = à vista; default 1
//   metodo?: "pix" | "boleto" | "cartao" | "parcelado",
//   primeiro_vencimento_dias?: number,   // dias a partir de hoje (default 3)
//   observacao?: string,
//   conversation_id?: string,            // fallback (header é preferido)
//   debt_id?: string,                    // fallback (header é preferido)
// }
// Headers preferidos:
//   x-el-webhook-secret, x-conversation-id, x-debt-id, x-agent-id
//
// Auth: x-el-webhook-secret (mesmo segredo dos outros webhooks EL).
// verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "*, x-el-webhook-secret, x-conversation-id, x-debt-id, x-agent-id, x-campaign-contact-id",
};

// IDs claramente fake que o LLM costuma inventar quando o placeholder
// não é resolvido (ex.: "12345", "654321", "abc123"). Tratamos como ausentes.
const FAKE_ID_RE = /^[0-9]{1,8}$|^abc[0-9]+$|^test/i;

function cleanId(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("{{") || s === "null" || s === "undefined") return null;
  if (FAKE_ID_RE.test(s)) return null;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const expected = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") ?? "";
  const received = req.headers.get("x-el-webhook-secret") ?? "";
  if (expected && !timingSafeEqual(expected, received)) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  let body: {
    conversation_id?: string;
    valor_negociado?: number;
    num_parcelas?: number;
    metodo?: string;
    primeiro_vencimento_dias?: number;
    debt_id?: string;
    observacao?: string;
  };
  try {
    body = await req.json();
  } catch {
    return j({ error: "invalid json" }, 400);
  }

  if (typeof body.valor_negociado !== "number" || body.valor_negociado <= 0) {
    return j(
      {
        error: "valor_negociado required (number)",
        message_to_agent:
          "Não consegui registrar — informe ao cliente o valor exato combinado e tente de novo.",
      },
      400,
    );
  }

  // ── Resolve IDs: header > body > fallback ───────────────────
  const conversationId =
    cleanId(req.headers.get("x-conversation-id")) ??
    cleanId(req.headers.get("elevenlabs-conversation-id")) ??
    cleanId(body.conversation_id);

  const headerDebtId =
    cleanId(req.headers.get("x-debt-id")) ?? cleanId(body.debt_id);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Localiza voice_call ──────────────────────────────────────
  let call: any = null;

  if (conversationId) {
    const { data } = await admin
      .from("voice_calls")
      .select("id, account_id, contact_id, debt_id, metadata, to_number, status")
      .or(
        `source_id.eq.${conversationId},provider_call_sid.eq.${conversationId}`,
      )
      .maybeSingle();
    call = data;
  }

  // Fallback: se não achou via ID, pega a chamada ativa mais recente
  // (últimos 30 min, status in_progress / ringing). Útil quando o EL
  // ainda não preencheu o header de system var.
  if (!call) {
    const { data } = await admin
      .from("voice_calls")
      .select("id, account_id, contact_id, debt_id, metadata, to_number, status")
      .in("status", ["in_progress", "ringing", "queued"])
      .gte("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    call = data;
    if (call) {
      console.warn(
        `[arrangement-from-agent-tool] FALLBACK: no conversation_id, using latest active call=${call.id}`,
      );
    }
  }

  if (!call) {
    return j(
      {
        error: "voice_call not found",
        message_to_agent:
          "Não consegui registrar agora. Por favor confirme novamente o valor combinado.",
      },
      404,
    );
  }

  // ── Resolve debt_id ─────────────────────────────────────────
  const debtId =
    headerDebtId ||
    (call.debt_id as string | null) ||
    ((call.metadata as any)?.variables?.debt_id as string | null) ||
    null;

  if (!debtId) {
    return j(
      {
        error: "no debt_id available",
        message_to_agent:
          "Não consegui localizar o débito ativo. Vou pedir pra equipe revisar.",
      },
      422,
    );
  }

  const { data: debt } = await admin
    .from("debts")
    .select("id, valor_atual, contact_id, account_id")
    .eq("id", debtId)
    .maybeSingle();
  if (!debt) {
    return j(
      {
        error: "debt not found",
        message_to_agent:
          "Não localizei o débito. Vou pedir pra equipe entrar em contato.",
      },
      404,
    );
  }

  // ── Resolve tetos (campanha → empresa) ──────────────────────
  const metadata = (call.metadata as any) ?? {};
  const campaignId =
    metadata?.campaign_id ?? metadata?.variables?.campaign_id ?? null;

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
  const valorNegociado = Math.max(0, Number(body.valor_negociado));
  const parcelas = Math.max(1, Math.floor(Number(body.num_parcelas ?? 1)));
  const metodo = (body.metodo ?? (parcelas > 1 ? "parcelado" : "pix")).toLowerCase();
  const dueDays = clamp(
    Number(body.primeiro_vencimento_dias ?? firstDueMinDays),
    1,
    60,
  );
  const firstDueDate = new Date();
  firstDueDate.setDate(firstDueDate.getDate() + dueDays);

  // ── Detecta violações de regra ──────────────────────────────
  const violations: string[] = [];

  if (parcelas > maxInstallments) {
    violations.push(
      `parcelas_excedidas: agente combinou ${parcelas}x (máx ${maxInstallments}x)`,
    );
  }

  if (parcelas === 1 && valorNegociado < valorBase) {
    const descontoOferecido = (1 - valorNegociado / valorBase) * 100;
    if (descontoOferecido > discountPct + 0.5) {
      violations.push(
        `desconto_excedido: agente combinou ${descontoOferecido.toFixed(1)}% (máx ${discountPct}%)`,
      );
    }
  }

  if (minInstallmentValue > 0 && parcelas > 1) {
    const valorPorParcela = valorNegociado / parcelas;
    if (valorPorParcela < minInstallmentValue - 0.01) {
      violations.push(
        `parcela_abaixo_minimo: ${valorPorParcela.toFixed(2)} < ${minInstallmentValue}`,
      );
    }
  }

  if (dueDays < firstDueMinDays || dueDays > firstDueMaxDays) {
    violations.push(
      `vencimento_fora_janela: ${dueDays} dias (janela ${firstDueMinDays}-${firstDueMaxDays})`,
    );
  }

  // ── Idempotência ────────────────────────────────────────────
  const { data: existing } = await admin
    .from("payment_arrangements")
    .select("id")
    .eq("voice_call_id", call.id)
    .maybeSingle();

  const arrangementPayload = {
    account_id: debt.account_id,
    debt_id: debt.id,
    contact_id: debt.contact_id,
    voice_call_id: call.id,
    valor_negociado: valorNegociado,
    metodo,
    num_parcelas: parcelas,
    primeiro_vencimento: firstDueDate.toISOString().slice(0, 10),
    status: "pendente_aprovacao",
    source: "agent_tool",
    metadata: {
      valor_original: valorBase,
      discount_pct_aplicado:
        parcelas === 1 && valorNegociado < valorBase
          ? Math.round((1 - valorNegociado / valorBase) * 1000) / 10
          : 0,
      campaign_id: campaignId,
      rule_violations: violations,
      first_due_window: { min: firstDueMinDays, max: firstDueMaxDays },
      observacao: body.observacao ?? null,
      conversation_id: conversationId,
    },
  };

  let arrId: string | null = existing?.id ?? null;
  if (arrId) {
    await admin
      .from("payment_arrangements")
      .update(arrangementPayload)
      .eq("id", arrId);
  } else {
    const { data: created } = await admin
      .from("payment_arrangements")
      .insert(arrangementPayload)
      .select("id")
      .single();
    arrId = created?.id ?? null;
  }

  // Marca o débito como em negociação e o call como acordo fechado
  await admin
    .from("debts")
    .update({ status: "em_negociacao", last_call_at: new Date().toISOString() })
    .eq("id", debt.id);

  await admin
    .from("voice_calls")
    .update({ collection_outcome: "acordo" })
    .eq("id", call.id);

  console.log(
    `[arrangement-from-agent-tool] call=${call.id} debt=${debt.id} valor=${valorNegociado} parc=${parcelas} viol=${violations.length} arr=${arrId} src=${conversationId ? "header" : "fallback"}`,
  );

  // Resposta para o agente — vira contexto na próxima fala
  return j({
    ok: true,
    arrangement_id: arrId,
    awaiting_approval: true,
    rule_violations: violations,
    summary: `Acordo registrado com sucesso: ${formatBRL(valorNegociado)} em ${parcelas}x via ${metodo}, primeiro vencimento em ${dueDays} dias.`,
    message_to_agent: `Acordo confirmado. Diga ao cliente: "Pronto, acordo registrado! Você vai receber o ${metodo === "boleto" ? "boleto" : metodo === "pix" ? "PIX" : "link de pagamento"} no WhatsApp e e-mail em instantes."`,
  });
});

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
