import { MessageSquare, Phone } from "lucide-react";

export function SourceBadge({ source }: { source: string | null }) {
  if (source === "whatsapp_extraction") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
        <MessageSquare className="h-3 w-3" />
        WhatsApp
      </span>
    );
  }
  if (source === "transcript_extraction") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
        <Phone className="h-3 w-3" />
        Ligação
      </span>
    );
  }
  if (source === "agent_tool") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-500/40 bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
        Agente
      </span>
    );
  }
  return null;
}
