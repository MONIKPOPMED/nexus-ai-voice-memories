/**
 * company_settings — dados que o agente IA usa em ligação:
 *  - company_name      → "aqui é Marina da {company_name}"
 *  - support_phone     → escalação humana ("transfira para …")
 *  - cnpj              → compliance / identificação
 *  - reply_email       → e-mail de retorno
 *  - legal_footer      → rodapé de mensagens
 *  - default_discount_pct / default_max_installments → defaults de negociação
 *
 * Isso é DIFERENTE de `accounts.name` (que é só o nome do workspace na UI).
 * Por isso temos esta tabela separada com upsert por account_id.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CompanySettings {
  account_id: string;
  company_name: string;
  cnpj: string | null;
  support_phone: string | null;
  reply_email: string | null;
  legal_footer: string | null;
  default_discount_pct: number | null;
  default_max_installments: number | null;
}

export type CompanySettingsInput = Partial<Omit<CompanySettings, "account_id">> & {
  company_name: string;
};

export async function fetchCompanySettings(accountId: string): Promise<CompanySettings | null> {
  const { data, error } = await supabase
    .from("company_settings")
    .select(
      "account_id, company_name, cnpj, support_phone, reply_email, legal_footer, default_discount_pct, default_max_installments",
    )
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return (data as CompanySettings | null) ?? null;
}

export async function upsertCompanySettings(
  accountId: string,
  payload: CompanySettingsInput,
): Promise<void> {
  const row = {
    account_id: accountId,
    company_name: payload.company_name,
    cnpj: payload.cnpj ?? null,
    support_phone: payload.support_phone ?? null,
    reply_email: payload.reply_email ?? null,
    legal_footer: payload.legal_footer ?? null,
    default_discount_pct: payload.default_discount_pct ?? null,
    default_max_installments: payload.default_max_installments ?? null,
  };
  const { error } = await supabase
    .from("company_settings")
    .upsert(row as any, { onConflict: "account_id" });
  if (error) throw error;
}

/**
 * Espelha o nome em company_settings se ainda estiver vazio.
 * Usado pelo onboarding e pelo /settings → Organização para garantir que o
 * agente saia falando o nome certo da empresa sem o usuário precisar configurar
 * duas vezes.
 */
export async function mirrorCompanyNameIfEmpty(accountId: string, name: string): Promise<void> {
  if (!name?.trim()) return;
  const current = await fetchCompanySettings(accountId).catch(() => null);
  if (current?.company_name && current.company_name.trim()) return;
  await upsertCompanySettings(accountId, {
    ...(current ?? {}),
    company_name: name.trim(),
  });
}
