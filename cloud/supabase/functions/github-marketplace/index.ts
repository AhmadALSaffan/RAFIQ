/**
 * GitHub Marketplace webhook for Rafiq.
 *
 * GitHub calls this when someone installs Rafiq from the Marketplace, changes plan or
 * cancels (`marketplace_purchase`), and once with `ping` when the URL is saved. Each call is
 * checked against the shared secret (X-Hub-Signature-256) before anything is stored; one
 * that doesn't match is refused. A redelivered event (same X-GitHub-Delivery) is stored once.
 *
 * Secret: set GITHUB_WEBHOOK_SECRET in Supabase (Edge Functions → Secrets) to the same value
 * as "Webhook secret" in the Marketplace listing. Until it's set, every call is refused.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const encoder = new TextEncoder();

async function signatureOf(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return "sha256=" + Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares every character, so the time taken says nothing about how much matched.
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, "POST only");

  const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  if (!secret) return reply(503, "webhook secret not configured");

  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  if (!sameText(signature, await signatureOf(secret, body))) return reply(401, "bad signature");

  const event = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? crypto.randomUUID();
  if (event !== "marketplace_purchase" && event !== "ping") return reply(202, `ignored: ${event}`);

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(body);
  } catch {
    return reply(400, "body is not JSON");
  }

  const purchase = payload.marketplace_purchase ?? {};
  const account = purchase.account ?? {};
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { error } = await db.from("marketplace_events").upsert(
    {
      delivery_id: delivery,
      event,
      action: payload.action ?? null,
      account_id: account.id ?? null,
      account_login: account.login ?? null,
      account_type: account.type ?? null,
      plan_name: purchase.plan?.name ?? null,
      effective_date: payload.effective_date ?? null,
      payload,
    },
    { onConflict: "delivery_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("couldn't store the event", error.message);
    return reply(500, "couldn't store the event"); // GitHub retries a failed delivery
  }
  return reply(200, "ok");
});
