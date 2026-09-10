import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccount } from "@/lib/account-context";
import { createDebtor } from "@/lib/debtors";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (result?: { contact_id: string; debt_id: string | null }) => void;
};

export function DebtorFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { accountId } = useAccount();
  const [submitting, setSubmitting] = useState(false);

  // Devedor
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [doc, setDoc] = useState("");

  // Dívida (opcional)
  const [withDebt, setWithDebt] = useState(true);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [origem, setOrigem] = useState("");

  const reset = () => {
    setName(""); setPhone(""); setEmail(""); setDoc("");
    setDescricao(""); setValor(""); setVencimento(""); setOrigem("");
    setWithDebt(true);
  };

  const submit = async () => {
    if (!accountId) return;
    if (!name.trim() || !phone.trim()) {
      toast.error("Nome e telefone são obrigatórios");
      return;
    }
    if (withDebt && (!valor.trim() || !vencimento.trim())) {
      toast.error("Para criar a dívida, informe valor e vencimento");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createDebtor(accountId, {
        debtor: {
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          doc_number: doc.trim() || null,
        },
        debt: withDebt ? {
          descricao: descricao.trim() || null,
          valor: valor.trim(),
          vencimento: vencimento.trim(),
          origem: origem.trim() || null,
        } : null,
      });
      toast.success("Devedor cadastrado");
      reset();
      onOpenChange(false);
      onCreated?.({ contact_id: result.contact_id, debt_id: result.debt_id });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("phone_in_dnc")) toast.error("Telefone está na lista DNC");
      else if (msg.includes("documento_invalido")) toast.error("CPF/CNPJ inválido");
      else if (msg.includes("telefone_invalido")) toast.error("Telefone inválido (use formato BR)");
      else toast.error("Falha ao cadastrar devedor");
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Novo devedor
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3 rounded-md border border-border/40 bg-muted/20 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Devedor
            </div>
            <div>
              <Label htmlFor="d-name" className="text-xs">Nome *</Label>
              <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="João Silva" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="d-phone" className="text-xs">Telefone *</Label>
                <Input id="d-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98877-6655" />
              </div>
              <div>
                <Label htmlFor="d-doc" className="text-xs">CPF / CNPJ</Label>
                <Input id="d-doc" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="000.000.000-00" />
              </div>
            </div>
            <div>
              <Label htmlFor="d-email" className="text-xs">E-mail</Label>
              <Input id="d-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" />
            </div>
          </div>

          <div className="space-y-3 rounded-md border border-border/40 bg-muted/20 p-3">
            <label className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Primeira dívida
              </span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={withDebt}
                  onChange={(e) => setWithDebt(e.target.checked)}
                  className="h-3 w-3"
                />
                Adicionar agora
              </span>
            </label>
            {withDebt && (
              <>
                <div>
                  <Label htmlFor="d-desc" className="text-xs">Descrição</Label>
                  <Input id="d-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Fatura nº 4567" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="d-valor" className="text-xs">Valor *</Label>
                    <Input id="d-valor" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1250,50" />
                  </div>
                  <div>
                    <Label htmlFor="d-venc" className="text-xs">Vencimento *</Label>
                    <Input id="d-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="d-origem" className="text-xs">Origem</Label>
                  <Input id="d-origem" value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="boleto, fatura, contrato…" />
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
