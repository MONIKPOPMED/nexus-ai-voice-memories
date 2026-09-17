import { createFileRoute } from "@tanstack/react-router";

const TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="+5548996975445">
    <Number>+5511999998888</Number>
  </Dial>
</Response>`;

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Content-Type": "text/xml; charset=utf-8",
};

export const Route = createFileRoute("/api/public/twilio/bia-dial")({
  server: {
    handlers: {
      GET: async () => new Response(TWIML, { status: 200, headers: responseHeaders }),
      POST: async () => new Response(TWIML, { status: 200, headers: responseHeaders }),
      OPTIONS: async () => new Response(null, { status: 204, headers: responseHeaders }),
    },
  },
});