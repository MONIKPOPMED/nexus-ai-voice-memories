// Validações compartilhadas para devedores: CPF/CNPJ, telefone BR, valor BR, datas.
// Extraído de debtors-import-csv para reuso em debt-create / debt-update.

export function onlyDigits(s: string): string {
  return (s ?? "").toString().replace(/\D/g, "");
}

export function isValidCPF(doc: string): boolean {
  const cpf = onlyDigits(doc);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10]);
}

export function isValidCNPJ(doc: string): boolean {
  const cnpj = onlyDigits(doc);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (base: string, weights: number[]) => {
    let sum = 0;
    for (let i = 0; i < weights.length; i++) sum += parseInt(base[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(cnpj.slice(0, 12), w1);
  if (d1 !== parseInt(cnpj[12])) return false;
  const d2 = calc(cnpj.slice(0, 13), w2);
  return d2 === parseInt(cnpj[13]);
}

export function classifyDoc(doc: string | null | undefined): {
  type: "cpf" | "cnpj" | null;
  clean: string | null;
  valid: boolean;
} {
  if (!doc) return { type: null, clean: null, valid: true }; // doc é opcional
  const clean = onlyDigits(doc);
  if (clean.length === 11) return { type: "cpf", clean, valid: isValidCPF(clean) };
  if (clean.length === 14) return { type: "cnpj", clean, valid: isValidCNPJ(clean) };
  return { type: null, clean: null, valid: false };
}

// Aceita (11) 98877-6655, 11988776655, +5511988776655, 5511988776655
export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = onlyDigits(raw);
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length === 12 || digits.length === 13) {
    return digits.startsWith("55") ? `+${digits}` : null;
  }
  return null;
}

export function parseBRNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? raw : null;
  const trimmed = raw.trim().replace(/\s/g, "").replace(/^R\$/, "");
  if (!trimmed) return null;
  const hasComma = trimmed.includes(",");
  const hasDot = trimmed.includes(".");
  let normalized = trimmed;
  if (hasComma && hasDot) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = trimmed.replace(",", ".");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseBRDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (br) {
    const [, d, m, y] = br;
    const year = y.length === 2 ? 2000 + parseInt(y) : parseInt(y);
    const isoOut = `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    if (!isNaN(Date.parse(isoOut))) return isoOut;
  }
  return null;
}
