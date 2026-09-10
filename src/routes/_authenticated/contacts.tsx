import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Search, Upload, Loader2, Phone, Wallet, Calendar, FileText, UserPlus, RefreshCw,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { DebtorFormDialog } from "@/components/contacts/DebtorFormDialog";
import { syncDebtorsFromProvider } from "@/lib/debtors";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAccount } from "@/lib/account-context";
import {
  fetchDebtors,
  formatBRL,
  formatDoc,
  DEBT_STATUS_LABEL,
  type DebtorRow,
  type DebtStatus,
} from "@/lib/debtors";
import { CSVImporter } from "@/components/contacts/CSVImporter";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/contacts")({
  component: DebtorsPage,
});

const STATUS_FILTERS: { value: DebtStatus | "todos"; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "aberto", label: "Em aberto" },
  { value: "em_negociacao", label: "Em negociação" },
  { value: "acordado", label: "Acordado" },
  { value: "pago", label: "Pago" },
];

function initials(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatVenc(iso: string | null): { label: string; overdue: boolean } {
  if (!iso) return { label: "—", overdue: false };
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString("pt-BR");
  if (dayDiff < 0) return { label: `${label} (${-dayDiff}d atraso)`, overdue: true };
  if (dayDiff === 0) return { label: `Hoje`, overdue: false };
  if (dayDiff <= 3) return { label: `${label} (${dayDiff}d)`, overdue: false };
  return { label, overdue: false };
}

function DebtorsPage() {
  const { accountId } = useAccount();
  const [rows, setRows] = useState<DebtorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<DebtStatus | "todos">("todos");
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const r = await fetchDebtors(accountId, { q, status });
      setRows(r.rows);
    } catch (e) {
      toast.error("Não foi possível carregar a carteira");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, status]);

  useEffect(() => {
    const timer = setTimeout(() => load(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const totals = useMemo(() => {
    const valorTotal = rows.reduce((sum, r) => sum + (r.valor_aberto || 0), 0);
    const totalDebts = rows.reduce((sum, r) => sum + r.debts_count, 0);
    return { count: rows.length, valorTotal, totalDebts };
  }, [rows]);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Cobrança"
        title="Carteira"
        description="Devedores e dívidas a cobrar. Importe sua carteira por CSV para começar."
        actions={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Importar CSV
          </Button>
        }
      />

      <div className="px-6 py-4">
        {/* Stats row */}
        <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatBlock icon={Wallet} label="Devedores" value={String(totals.count)} tone="text-violet-300" />
          <StatBlock icon={FileText} label="Dívidas" value={String(totals.totalDebts)} tone="text-sky-300" />
          <StatBlock icon={Calendar} label="Em aberto" value={formatBRL(totals.valorTotal)} tone="text-emerald-300" />
        </div>

        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou e-mail…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setStatus(f.value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-xs transition-colors",
                  status === f.value
                    ? "border-violet-500 bg-violet-500/15 text-white"
                    : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Wallet className="h-10 w-10 text-muted-foreground/50" />
              <div>
                <p className="text-sm font-medium">Nenhum devedor na carteira</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Importe um CSV com nome, telefone, valor e vencimento para começar.
                </p>
              </div>
              <Button size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Importar CSV
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/[0.06] hover:bg-transparent">
                  <TableHead>Devedor</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                  <TableHead>Próx. venc.</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const venc = formatVenc(r.proximo_vencimento);
                  const statusConf = r.status ? DEBT_STATUS_LABEL[r.status] : null;
                  return (
                    <TableRow key={r.contact_id} className="border-white/[0.04]">
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[10px] font-semibold text-white">
                              {initials(r.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm">{r.name ?? "Sem nome"}</div>
                            {r.email && (
                              <div className="truncate text-[10px] text-muted-foreground">{r.email}</div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {formatDoc(r.doc_type, r.doc_number)}
                      </TableCell>
                      <TableCell>
                        {r.phone_number ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {r.phone_number}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-sm font-semibold tabular-nums">
                          {formatBRL(r.valor_aberto)}
                        </span>
                        {r.debts_count > 1 && (
                          <div className="text-[10px] text-muted-foreground">
                            {r.debts_count} dívidas
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className={cn("text-xs", venc.overdue && "text-rose-300")}>
                          {venc.label}
                        </span>
                      </TableCell>
                      <TableCell>
                        {statusConf && (
                          <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium", statusConf.tone)}>
                            {statusConf.label}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Importar carteira de devedores</DialogTitle>
          </DialogHeader>
          <CSVImporter onComplete={load} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", tone)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
