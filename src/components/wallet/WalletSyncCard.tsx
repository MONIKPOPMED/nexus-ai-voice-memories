// Painel reusável de "carteira / CRM": mostra cada integração de cobrança
// configurada (HubSpot, Pipedrive, Asaas), permite sincronizar manualmente
// e mostra a última sincronização (vinda de accounts.settings.collection_integrations).
//
// Usado em:
//   - /settings → Integrações (seção "Origem das cobranças")
//   - /recuperacao (faixa "Sincronizar agora")
//
// Sem credenciais salvas → mostra CTA pra abrir /settings (ou onboarding).

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listAccountSecrets } from "@/lib/account-secrets";
import { syncDebtorsFromProvider } from "@/lib/debtors";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type ProviderKey = "hubspot" | "pipedrive" | "asaas";

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
  asaas: "Asaas",
};

const REQUIRED_KEYS: Record<ProviderKey, string[]> = {
  hubspot: ["access_token"],
  pipedrive: ["api_token", "company_domain"],
  asaas: ["api_key"],
};

interface ProviderRow {
  key: ProviderKey;
  configured: boolean;
  autoSync: boolean;
  lastSyncedAt: string | null;
  syncing: boolean;
  lastResult: string | null;
}

interface Props {
  accountId: string;
  /** "compact" (na faixa do /recuperacao) ou "card" (em /settings) */
  variant?: "compact" | "card";
  className?: string;
}

export function WalletSyncCard({ accountId, variant = "card", className }: Props) {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [secrets, accountResp] = await Promise.all([
        listAccountSecrets(accountId),
        (supabase as any).from("accounts").select("settings").eq("id", accountId).maybeSingle(),
      ]);
      const collectionCfg =
        (accountResp.data?.settings as any)?.collection_integrations ?? {};

      const built: ProviderRow[] = (Object.keys(REQUIRED_KEYS) as ProviderKey[]).map((key) => {
        const required = REQUIRED_KEYS[key];
        const configured = required.every((name) =>
          secrets.some((s) => s.provider === key && s.key_name === name),
        );
        const cfg = collectionCfg[key] ?? {};
        return {
          key,
          configured,
          autoSync: cfg.auto_sync === true,
          lastSyncedAt: cfg.last_synced_at ?? null,
          syncing: false,
          lastResult: null,
        };
      });
      setRows(built);
    } catch (e: any) {
      toast.error(`Falha ao carregar integrações: ${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync(p: ProviderRow) {
    setRows((prev) =>
      prev.map((r) => (r.key === p.key ? { ...r, syncing: true, lastResult: null } : r)),
    );
    try {
      const r = await syncDebtorsFromProvider(accountId, p.key);
      setRows((prev) =>
        prev.map((row) =>
          row.key === p.key
            ? {
                ...row,
                syncing: false,
                lastSyncedAt: new Date().toISOString(),
                lastResult: r.ok
                  ? `${r.imported} novas / ${r.total} processadas`
                  : "nenhuma nova",
              }
            : row,
        ),
      );
      if (r.ok) {
        toast.success(`${PROVIDER_LABEL[p.key]}: ${r.imported} novas, ${r.total} processadas`);
      } else {
        toast.warning(`${PROVIDER_LABEL[p.key]}: nenhuma cobrança importada`);
      }
    } catch (e: any) {
      setRows((prev) =>
        prev.map((row) =>
          row.key === p.key ? { ...row, syncing: false, lastResult: "erro" } : row,
        ),
      );
      toast.error(`${PROVIDER_LABEL[p.key]}: ${e?.message ?? "falhou"}`);
    }
  }

  const configuredRows = rows.filter((r) => r.configured);
  const noneConfigured = !loading && configuredRows.length === 0;

  // Compact: faixa horizontal (recuperação)
  if (variant === "compact") {
    if (loading) {
      return (
        <div className={cn("flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground", className)}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando integrações…
        </div>
      );
    }
    if (noneConfigured) {
      return (
        <div className={cn("flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs", className)}>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-300" />
            <span className="text-foreground">
              Nenhuma origem de cobrança conectada. Importações automáticas estão desativadas.
            </span>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-500/30"
          >
            Configurar <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      );
    }
    return (
      <div className={cn("rounded-lg border border-border bg-muted/40 p-3", className)}>
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-300" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sincronizar carteira agora
            </h3>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
          >
            gerenciar <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {configuredRows.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant="outline"
              onClick={() => handleSync(p)}
              disabled={p.syncing}
              className="h-8 text-xs"
            >
              {p.syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {PROVIDER_LABEL[p.key]}
              {p.lastSyncedAt && !p.syncing && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  · {formatRelative(p.lastSyncedAt)}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  // Card: bloco completo em /settings
  return (
    <div className={className}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Origem das cobranças (CRM/Gateway)
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(Object.keys(PROVIDER_LABEL) as ProviderKey[]).map((key) => {
          const p = rows.find((r) => r.key === key) ?? {
            key,
            configured: false,
            autoSync: false,
            lastSyncedAt: null,
            syncing: false,
            lastResult: null,
          };
          return (
            <div key={key} className="glass flex flex-col gap-2 rounded-lg p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg",
                      p.configured ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Wallet className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">{PROVIDER_LABEL[key]}</h4>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {p.configured ? (p.autoSync ? "auto-sync 6h" : "manual") : "não conectado"}
                    </p>
                  </div>
                </div>
                {p.configured ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                ) : (
                  <CircleDashed className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {p.lastSyncedAt && (
                <p className="text-[11px] text-muted-foreground">
                  Última: {new Date(p.lastSyncedAt).toLocaleString("pt-BR")}
                  {p.lastResult && <span className="ml-1">— {p.lastResult}</span>}
                </p>
              )}

              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                {p.configured ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSync(p)}
                    disabled={p.syncing}
                    className="h-7 text-[11px]"
                  >
                    {p.syncing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Sincronizar agora
                  </Button>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    Configure no onboarding ou use o botão abaixo
                  </span>
                )}
                <Link
                  to="/settings"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary"
                >
                  {p.configured ? "editar" : "configurar"} <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min}min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
