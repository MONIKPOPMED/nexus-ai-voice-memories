// TwiML served to Twilio after voice-escalate redirects the call.
// ?mode=transfer&to=+15551234567&caller_id=+15557654321 → <Dial> that number
// ?mode=voicemail                → <Say><Record>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function xml(body: string) {
  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "voicemail";

  if (mode === "transfer") {
    const to = url.searchParams.get("to") ?? "";
    const callerId = url.searchParams.get("caller_id") ?? "";
    if (!to) {
      return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Desculpe, nao consegui transferir. Deixe seu recado apos o sinal.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
    }
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerId ? ` callerId="${escapeXml(callerId)}"` : ""}>
    <Number>${escapeXml(to)}</Number>
  </Dial>
</Response>`);
  }

  // voicemail
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Deixe seu recado apos o sinal. Retornamos o contato em breve.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
});
