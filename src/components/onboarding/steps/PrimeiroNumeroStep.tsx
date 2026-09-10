import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export function PrimeiroNumeroStep({ accountId }: { accountId: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count: c } = await (supabase as any)
        .from("phone_numbers")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      if (!cancelled) {
        setCount(c ?? 0);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Primeiro número de telefone</h2>
        <p className="text-sm text-muted-foreground">
          Pra a IA ligar e atender chamadas, você precisa de pelo menos um número
          Twilio importado. Esse passo é opcional — pode pular e configurar
          depois.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : count && count > 0 ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            {count} número{count > 1 ? "s" : ""} já cadastrado{count > 1 ? "s" : ""}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Você pode adicionar mais ou ativar a IA neles em <code>/phone-numbers</code>.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-muted/40 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold">Importe seu número Twilio</h4>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Em /phone-numbers você cola o SID do número, escolhe a persona
                vinculada e ativa a IA. Leva menos de 1 minuto.
              </p>
            </div>
          </div>
          <Button asChild className="mt-3 w-full" variant="outline">
            <a
              href="/phone-numbers"
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir página de números
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
