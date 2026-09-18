// Add a document (URL or text) to the ElevenLabs knowledge base and attach
// it to a persona's agent. Called from the /agents knowledge tab.
//
// Body:
//   { account_id, persona_id, name, type?: "url" | "text" | "file",
//     url?, text? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import {
  ElevenLabsError,
  resolveCredentialsForAccount,
} from "../_shared/elevenlabs/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return j({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return j({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) return j({ error: "unauthorized" }, 401);

  let body: {
    accountId?: string;
    account_id?: string;
    personaId?: string;
    persona_id?: string;
    name: string;
    type?: "url" | "text";
    url?: string;
    text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return j({ error: "body must be JSON" }, 400);
  }
  const accountId = body.accountId ?? body.account_id;
  const personaId = body.personaId ?? body.persona_id;
  if (!accountId || !personaId || !body.name) {
    return j({ error: "account_id, persona_id and name required" }, 400);
  }

  // Load persona and verify ownership.
  const { data: persona } = await admin
    .from("agent_personas")
    .select("id, account_id, elevenlabs_agent_id, elevenlabs_knowledge_base_ids")
    .eq("id", personaId)
    .maybeSingle();
  if (!persona) return j({ error: "persona not found" }, 404);
  if (persona.account_id !== accountId) return j({ error: "forbidden" }, 403);
  if (!persona.elevenlabs_agent_id) {
    return j({ error: "persona must be synced to ElevenLabs first" }, 409);
  }

  const { data: membership } = await admin
    .from("account_users")
    .select("account_id")
    .eq("user_id", u.user.id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!membership) return j({ error: "forbidden" }, 403);

  let apiKey = "";
  try {
    const credentials = await resolveCredentialsForAccount(admin, accountId);
    apiKey = credentials.apiKey;
  } catch (error) {
    const message = error instanceof ElevenLabsError
      ? error.message
      : "Credencial da ElevenLabs indisponível para esta conta";
    return j({ error: message }, 503);
  }

  // 1. Create the KB document on EL.
  const type = body.type ?? (body.url ? "url" : "text");
  const createPath = type === "url"
    ? "/v1/convai/knowledge-base/url"
    : "/v1/convai/knowledge-base/text";
  const createBody = type === "url"
    ? { url: body.url, name: body.name }
    : { text: body.text, name: body.name };

  const createRes = await fetch(`https://api.elevenlabs.io${createPath}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    const t = await createRes.text().catch(() => "");
    if (createRes.status === 401 || createRes.status === 403) {
      console.warn(`[el-kb-add] knowledge-base create denied status=${createRes.status}`);
      return j({
        ok: false,
        code: "elevenlabs_knowledge_base_permission_required",
        error: "A chave da ElevenLabs funciona para voz, mas não permite criar documentos. Gere uma chave com acesso de escrita a Agents e Knowledge Base em Configurações → Integrações.",
      });
    }
    return j({ error: `Falha da ElevenLabs ao criar o documento (${createRes.status}): ${t.slice(0, 200)}` }, 502);
  }
  const doc = await createRes.json();
  const docId = doc.id as string;

  // 2. Fetch current agent config and append a complete KnowledgeBaseLocator.
  // ElevenLabs no longer accepts bare document IDs here: every item must be
  // an object containing id, name and type.
  const current = (persona.elevenlabs_knowledge_base_ids as string[]) ?? [];
  const nextKb = [...current, docId];

  const agentRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${persona.elevenlabs_agent_id}`,
    { headers: { "xi-api-key": apiKey, Accept: "application/json" } },
  );
  if (!agentRes.ok) {
    const t = await agentRes.text().catch(() => "");
    await deleteCreatedDocument(apiKey, docId);
    return j({ error: `Documento criado, mas não foi possível consultar o agente (${agentRes.status}): ${t.slice(0, 200)}` }, 502);
  }
  const agent = await agentRes.json();
  const existingLocators = Array.isArray(agent?.conversation_config?.agent?.prompt?.knowledge_base)
    ? agent.conversation_config.agent.prompt.knowledge_base.filter(isKnowledgeBaseLocator)
    : [];
  const nextLocators = [
    ...existingLocators.filter((item: { id: string }) => item.id !== docId),
    {
      id: docId,
      name: typeof doc?.name === "string" ? doc.name : body.name,
      type: isKnowledgeBaseType(doc?.type) ? doc.type : type,
      usage_mode: "auto",
    },
  ];

  const patchRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/agents/${persona.elevenlabs_agent_id}`,
    {
      method: "PATCH",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_config: {
          agent: {
            prompt: {
              knowledge_base: nextLocators,
            },
          },
        },
      }),
    },
  );
  if (!patchRes.ok) {
    const t = await patchRes.text().catch(() => "");
    await deleteCreatedDocument(apiKey, docId);
    if (patchRes.status === 401 || patchRes.status === 403) {
      console.warn(`[el-kb-add] agent knowledge-base link denied status=${patchRes.status}`);
      return j({
        ok: false,
        code: "elevenlabs_agent_write_permission_required",
        error: "O documento foi criado, mas a chave da ElevenLabs não permite alterar o agente. Gere uma chave com acesso de escrita a Agents e Knowledge Base em Configurações → Integrações.",
      });
    }
    return j({ error: `Documento criado, mas a ElevenLabs não permitiu vinculá-lo ao agente (${patchRes.status}): ${t.slice(0, 200)}` }, 502);
  }

  // 3. Mirror the list back to our persona row.
  await admin
    .from("agent_personas")
    .update({ elevenlabs_knowledge_base_ids: nextKb })
    .eq("id", persona.id);

  console.log(
    `[el-kb-add] persona=${persona.id} agent=${persona.elevenlabs_agent_id} doc=${docId} type=${type}`,
  );

  return j({ ok: true, document_id: docId, knowledge_base_ids: nextKb });
});

function j(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type KnowledgeBaseType = "url" | "text" | "file" | "folder";

function isKnowledgeBaseType(value: unknown): value is KnowledgeBaseType {
  return value === "url" || value === "text" || value === "file" || value === "folder";
}

function isKnowledgeBaseLocator(value: unknown): value is {
  id: string;
  name: string;
  type: KnowledgeBaseType;
  usage_mode?: string;
} {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" &&
    typeof item.name === "string" &&
    isKnowledgeBaseType(item.type);
}

async function deleteCreatedDocument(apiKey: string, docId: string) {
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/knowledge-base/${docId}`,
      { method: "DELETE", headers: { "xi-api-key": apiKey } },
    );
    if (!response.ok) {
      console.warn(`[el-kb-add] failed to clean up document=${docId} status=${response.status}`);
    }
  } catch (error) {
    console.warn(`[el-kb-add] failed to clean up document=${docId}`, error);
  }
}
