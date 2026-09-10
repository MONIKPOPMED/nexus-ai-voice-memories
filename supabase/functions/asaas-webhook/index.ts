// Asaas webhook receiver.
// Asaas v3: POST body { event: "PAYMENT_OVERDUE"|"PAYMENT_CONFIRMED"|"PAYMENT_CREATED"|...,
//                       payment: {...} }
// Signature: header 'asaas-access-token' = configured value (no HMAC — Asaas
// doesn't sign; acts as shared secret).
//
// We persist to payments_ledger and emit workflow event source=billing,
// provider=asaas, event_type=payment_overdue|payment_paid|... so workflows
// like "collection D+1" can fire.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { loggerFor } from "../_shared/logger.ts";
import { resolveOrCreateContact } from "../_shared/integrations/contact-match.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);
  const log = loggerFor(req, { function: "asaas-webhook" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) return j({ error: "account_id query param required" }, 400);

  const { data: integration } = await admin
    .from("billing_integrations")
    .select("config, enabled")
    .eq("account_id", accountId)
    .eq("provider", "asaas")
    .maybeSingle();

  if (!integration || !integration.enabled) {
    log.warn("asaas integration disabled/missing", { account_id: accountId });
    return j({ error: "integration disabled" }, 409);
  }

  const sharedSecret = (integration.config as any)?.webhook_secret ?? "";
  const providedSecret = req.headers.get("asaas-access-token") ?? "";
  if (sharedSecret && providedSecret !== sharedSecret) {
    log.warn("asaas secret mismatch", { account_id: accountId });
    return j({ error: "forbidden" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return j({ error: "invalid json" }, 400);
  }

  const event: string = String(body.event ?? "").toLowerCase();
  const payment = body.payment ?? {};

  const ledgerRow = {
    account_id: accountId,
    provider: "asaas",
    provider_payment_id: payment.id,
    amount_cents: Math.round((payment.value ?? 0) * 100),
    currency: "BRL",
    status: mapAsaasStatus(event, payment),
    due_at: payment.dueDate ? `${payment.dueDate}T23:59:59Z` : null,
    paid_at: payment.paymentDate ? `${payment.paymentDate}T00:00:00Z` : null,
    customer_email: payment.customerObject?.email ?? null,
    customer_phone: payment.customerObject?.phone ?? payment.customerObject?.mobilePhone ?? null,
    description: payment.description ?? null,
    payload: body,
  };

  if (ledgerRow.provider_payment_id) {
    const contactId = await resolveOrCreateContact(admin, {
      accountId,
      email: ledgerRow.customer_email,
      phone: ledgerRow.customer_phone,
      name: payment.customerObject?.name ?? null,
      source: "billing:asaas",
    });
    await admin
      .from("payments_ledger")
      .upsert(
        { ...ledgerRow, contact_id: contactId },
        { onConflict: "account_id,provider,provider_payment_id" },
      );

    // Atualiza payment_arrangements quando cobrança é paga/cancelada/refund.
    // Resolve pelo externalReference (que mandamos como arrangement.id) ou pelo
    // asaas_charge_id (fallback).
    const arrangementId =
      (payment.externalReference as string | undefined) ?? null;
    let targetRow: { id: string; debt_id: string } | null = null;
    if (arrangementId) {
      const { data } = await admin
        .from("payment_arrangements")
        .select("id, debt_id")
        .eq("id", arrangementId)
        .maybeSingle();
      if (data) targetRow = data;
    }
    if (!targetRow) {
      const { data } = await admin
        .from("payment_arrangements")
        .select("id, debt_id")
        .eq("asaas_charge_id", ledgerRow.provider_payment_id)
        .maybeSingle();
      if (data) targetRow = data;
    }

    if (targetRow) {
      if (ledgerRow.status === "paid") {
        await admin
          .from("payment_arrangements")
          .update({ status: "pago", paid_at: ledgerRow.paid_at ?? new Date().toISOString() })
          .eq("id", targetRow.id);
        await admin
          .from("debts")
          .update({ status: "pago" })
          .eq("id", targetRow.debt_id);
      } else if (ledgerRow.status === "overdue") {
        await admin
          .from("payment_arrangements")
          .update({ status: "atrasado" })
          .eq("id", targetRow.id)
          .eq("status", "pendente");
      } else if (ledgerRow.status === "canceled" || ledgerRow.status === "refunded") {
        await admin
          .from("payment_arrangements")
          .update({ status: "cancelado", canceled_at: new Date().toISOString() })
          .eq("id", targetRow.id);
      }
    }
  }

  await admin
    .from("billing_integrations")
    .update({ last_event_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("provider", "asaas");

  return j({ ok: true });
});

function mapAsaasStatus(event: string, payment: any): string {
  const s = String(payment.status ?? "").toLowerCase();
  if (event.includes("confirmed") || s === "received" || s === "confirmed") return "paid";
  if (event.includes("overdue") || s === "overdue") return "overdue";
  if (event.includes("refunded") || s === "refunded") return "refunded";
  if (event.includes("canceled") || s === "canceled") return "canceled";
  return "pending";
}

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
