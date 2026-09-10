// Step opcional do onboarding: integrações de carteira (CRM/cobrança).
// 3 provedores suportados: HubSpot, Pipedrive e Asaas.
// Tudo aqui é opcional — botão "Pular esta etapa" sempre visível.

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ExternalLink,
  Handshake,
  Loader2,
  ShieldCheck,
  SkipForward,
  Wallet,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  listAccountSecrets,
  setAccountSecretsBulk,
} from "@/lib/account-secrets";
import { supabase } from "@/integrations/supabase/client";
import { syncDebtorsFromProvider } from "@/lib/debtors";

type ProviderKey = "hubspot" | "pipedrive" | "asaas";

interface ProviderDef {
  key: ProviderKey;
  title: string;
  subtitle: string;
  helpUrl: string;
  fields: Array<{
    name: string;
    label: string;
    placeholder: string;
    secret?: boolean;
    helpText?: string;
  }>;
  /** Campos não-sensíveis salvos em accounts.settings.collection_integrations.<key>. */
  settingsFields?: Array<{
    name: string;
    label: string;
    placeholder: string;
    helpText?: string;
    type?: "text" | "number";
  }>;
}

const PROVIDERS: ProviderDef[] = [
  {
    key: "hubspot",
    title: "HubSpot",
    subtitle: "Importa deals de uma stage como cobranças",
    helpUrl: "https://developers.hubspot.com/docs/api/private-apps",
    fields: [
      {
        name: "access_token",
        label: "Private App Token",
        placeholder: "pat-na1-...",
        helpText: "Crie em Settings → Integrations → Private Apps com escopo crm.objects.deals.read e crm.objects.contacts.read.",
      },
    ],
    settingsFields: [
      { name: "pipeline_id", label: "Pipeline ID", placeholder: "default" },
      { name: "stage_id", label: "Stage ID", placeholder: "appointmentscheduled" },
    ],
  },
  {
    key: "pipedrive",
    title: "Pipedrive",
    subtitle: "Importa deals abertos de uma stage como cobranças",
    helpUrl: "https://support.pipedrive.com/en/article/how-can-i-find-my-personal-api-key",
    fields: [
      {
        name: "api_token",
        label: "API Token",
        placeholder: "abc123...",
        helpText: "Settings → Personal preferences → API.",
      },
      {
        name: "company_domain",
        label: "Subdomínio da empresa",
        placeholder: "minhaempresa",
        secret: false,
        helpText: "Sem .pipedrive.com. Ex.: 'minhaempresa' (de minhaempresa.pipedrive.com).",
      },
    ],
    settingsFields: [
      { name: "stage_id", label: "Stage ID", placeholder: "5", type: "number" },
    ],
  },
  {
    key: "asaas",
    title: "Asaas",
    subtitle: "Importa cobranças PENDING e OVERDUE",
    helpUrl: "https://docs.asaas.com/docs/autenticacao",
    fields: [
      {
        name: "api_key",
        label: "API Key",
        placeholder: "$aact_...",
        helpText: "Disponível em Configurações → Integrações.",
      },
    ],
  },
];

interface CarteiraStepProps {
  accountId: string;
  onSkip: () => void;
  onContinue: () => void;
}

interface ProviderState {
  configured: boolean;
  saving: boolean;
  testing: boolean;
  fields: Record<string, string>;
  settings: Record<string, string>;
  autoSync: boolean;
  lastSyncedAt: string | null;
}

const emptyState = (def: ProviderDef): ProviderState => ({
  configured: false,
  saving: false,
  testing: false,
  fields: Object.fromEntries(def.fields.map((f) => [f.name, ""])),
  settings: Object.fromEntries((def.settingsFields ?? []).map((f) => [f.name, ""])),
  autoSync: false,
  lastSyncedAt: null,
});

export function CarteiraStep({ accountId, onSkip, onContinue }: CarteiraStepProps) {
  const [state, setState] = useState<Record<ProviderKey, ProviderState>>(() => ({
    hubspot: emptyState(PROVIDERS[0]),
    pipedrive: emptyState(PROVIDERS[1]),
    asaas: emptyState(PROVIDERS[2]),
  }));
  const [loading, setLoading] = useState(true);

  // Carrega estado: quais providers já têm secrets salvos + settings atuais.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [secrets, accountResp] = await Promise.all([
          listAccountSecrets(accountId),
          (supabase as any).from("accounts").select("settings").eq("id", accountId).maybeSingle(),
        ]);
        if (cancelled) return;
        const collectionCfg =
          (accountResp.data?.settings as any)?.collection_integrations ?? {};

        setState((prev) => {
          const next = { ...prev };
          for (const def of PROVIDERS) {
            const requiredSecrets = def.fields.map((f) => f.name);
            const hasAll = requiredSecrets.every((name) =>
              secrets.some((s) => s.provider === def.key && s.key_name === name),
            );
            const cfg = collectionCfg[def.key] ?? {};
            next[def.key] = {
              ...next[def.key],
              configured: hasAll,
              autoSync: cfg.auto_sync === true,
              lastSyncedAt: cfg.last_synced_at ?? null,
              settings: Object.fromEntries(
                (def.settingsFields ?? []).map((f) => [f.name, cfg[f.name]?.toString() ?? ""]),
              ),
            };
          }
          return next;
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  function update(key: ProviderKey, patch: Partial<ProviderState>) {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function handleSave(def: ProviderDef) {
    const ps = state[def.key];
    update(def.key, { saving: true });
    try {
      const newSecrets: Record<string, string> = {};
      for (const f of def.fields) {
        const v = ps.fields[f.name]?.trim();
        if (v) newSecrets[f.name] = v;
      }
      if (Object.keys(newSecrets).length > 0) {
        await setAccountSecretsBulk(accountId, def.key, newSecrets);
      }

      // Persiste settings (pipeline_id, stage_id, auto_sync)
      const acctResp = await (supabase as any)
        .from("accounts")
        .select("settings")
        .eq("id", accountId)
        .maybeSingle();
      const currentSettings = acctResp.data?.settings ?? {};
      const collectionCfg = currentSettings.collection_integrations ?? {};
      const merged = {
        ...currentSettings,
        collection_integrations: {
          ...collectionCfg,
          [def.key]: {
            ...(collectionCfg[def.key] ?? {}),
            ...Object.fromEntries(
              (def.settingsFields ?? [])
                .map((f) => [f.name, ps.settings[f.name]?.trim()])
                .filter(([, v]) => v),
            ),
            auto_sync: ps.autoSync,
          },
        },
      };
      await (supabase as any).from("accounts").update({ settings: merged }).eq("id", accountId);

      update(def.key, {
        saving: false,
        configured: true,
        fields: Object.fromEntries(def.fields.map((f) => [f.name, ""])),
      });
      toast.success(`${def.title} salvo`);
    } catch (e: any) {
      update(def.key, { saving: false });
      toast.error(e?.message ?? "Erro ao salvar");
    }
  }

  async function handleTestSync(def: ProviderDef) {
    update(def.key, { testing: true });
    try {
      const r = await syncDebtorsFromProvider(accountId, def.key);
      update(def.key, {
        testing: false,
        lastSyncedAt: new Date().toISOString(),
      });
      if (r.ok) {
        toast.success(`${def.title}: ${r.imported} novas, ${r.total} processadas`);
      } else {
        toast.warning(`${def.title}: nenhuma cobrança importada`);
      }
    } catch (e: any) {
      update(def.key, { testing: false });
      toast.error(e?.message ?? `Falha ao sincronizar com ${def.title}`);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-amber-300" />
          <h2 className="text-lg font-semibold text-foreground">
            Carteira de cobrança <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte seu CRM ou gateway pra puxar cobranças automaticamente. Você pode pular agora e configurar
          depois em <span className="font-mono">Configurações → Integrações</span>.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-3">
          {PROVIDERS.map((def) => {
            const ps = state[def.key];
            return (
              <div
                key={def.key}
                className="rounded-lg border border-border bg-muted/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{def.title}</h3>
                      {ps.configured && (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-700">
                          <ShieldCheck className="h-2.5 w-2.5" /> configurado
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{def.subtitle}</p>
                  </div>
                  <a
                    href={def.helpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  >
                    docs <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {def.fields.map((f) => (
                    <div key={f.name} className="space-y-1.5">
                      <Label className="text-xs font-medium">
                        {f.label}
                        {ps.configured && (
                          <span className="ml-1 text-[10px] text-emerald-600">(salvo)</span>
                        )}
                      </Label>
                      <Input
                        type={f.secret === false ? "text" : "password"}
                        placeholder={ps.configured ? "•••••• (deixe em branco pra manter)" : f.placeholder}
                        value={ps.fields[f.name]}
                        onChange={(e) =>
                          update(def.key, {
                            fields: { ...ps.fields, [f.name]: e.target.value },
                          })
                        }
                        autoComplete="off"
                        className="font-mono text-xs bg-background"
                      />
                      {f.helpText && (
                        <p className="text-[10px] text-muted-foreground">{f.helpText}</p>
                      )}
                    </div>
                  ))}
                  {def.settingsFields?.map((f) => (
                    <div key={f.name} className="space-y-1.5">
                      <Label className="text-xs font-medium">{f.label}</Label>
                      <Input
                        type={f.type ?? "text"}
                        placeholder={f.placeholder}
                        value={ps.settings[f.name]}
                        onChange={(e) =>
                          update(def.key, {
                            settings: { ...ps.settings, [f.name]: e.target.value },
                          })
                        }
                        className="font-mono text-xs bg-background"
                      />
                      {f.helpText && (
                        <p className="text-[10px] text-muted-foreground">{f.helpText}</p>
                      )}
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
                  <label className="inline-flex items-center gap-2 text-xs">
                    <Switch
                      checked={ps.autoSync}
                      onCheckedChange={(checked) => update(def.key, { autoSync: checked })}
                    />
                    Auto-sync a cada 6h
                  </label>

                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSave(def)}
                      disabled={ps.saving}
                    >
                      {ps.saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleTestSync(def)}
                      disabled={ps.testing || !ps.configured}
                    >
                      {ps.testing ? (
                        <>
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Sincronizando…
                        </>
                      ) : (
                        "Testar sincronização"
                      )}
                    </Button>
                  </div>
                </div>

                {ps.lastSyncedAt && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Última sync: {new Date(ps.lastSyncedAt).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          <SkipForward className="mr-1 h-3.5 w-3.5" /> Pular esta etapa
        </Button>
        <Button onClick={onContinue}>
          <CheckCircle2 className="mr-1 h-4 w-4" /> Continuar
        </Button>
      </div>
    </div>
  );
}
