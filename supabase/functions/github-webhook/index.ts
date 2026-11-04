// github-webhook: the INBOX of the ingestion pipeline (docs/PLAN.md §2 item 8, §5).
//
//   GitHub --POST--> this function --rpc--> public.ingest_receive()   (one transaction:
//                                            INSERT ingest_event + pgmq.send)
//
// 1. Authenticates the request with the X-Hub-Signature-256 HMAC over the RAW body
//    (secret GITHUB_WEBHOOK_SECRET), compared in constant time. verify_jwt is off for this
//    function (supabase/config.toml): GitHub cannot send a Supabase JWT.
// 2. ping -> 200. push -> ingest_receive -> 202. Any other event -> 202 "ignored", not stored.
// 3. Answers fast: no Mongo write and no projection here. The worker does those from the
//    queue, so a slow database on the far side never makes GitHub time out (10 s limit).
// Idempotency lives in the database (ingest_event.delivery_id PK): a redelivery is a 202
// with duplicate=true and nothing is queued twice.
//
// Env: GITHUB_WEBHOOK_SECRET (set locally in supabase/functions/.env, in the cloud with
// `supabase secrets set`), SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (provided by the runtime).

import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 5 * 1024 * 1024; // GitHub caps payloads at 25 MB; pushes are far smaller
const DELIVERY_RE = /^[A-Za-z0-9._:-]{1,100}$/;
const EVENT_RE = /^[a-z_]{1,40}$/;

const encoder = new TextEncoder();

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time comparison: the loop always runs over the full expected length and never
// exits early, so the time taken does not reveal how many leading characters matched.
function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) {
    diff |= x[i] ^ (y[i % (y.length || 1)] ?? 0);
  }
  return diff === 0;
}

async function hmacSha256Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, body)));
}

// GitHub sends application/json, or application/x-www-form-urlencoded with payload=<json>.
function parsePayload(body: Uint8Array, contentType: string): unknown {
  const text = new TextDecoder().decode(body);
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const raw = new URLSearchParams(text).get("payload");
    if (raw === null) throw new Error("missing payload field");
    return JSON.parse(raw);
  }
  return JSON.parse(text);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const secret = Deno.env.get("GITHUB_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) {
    // Fail closed: without a secret no request can be authenticated.
    console.error("github-webhook: GITHUB_WEBHOOK_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
    return json(500, { error: "not_configured" });
  }

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) {
    return json(413, { error: "payload_too_large" });
  }

  // 1. Signature over the exact bytes received (before any parsing).
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + (await hmacSha256Hex(secret, body));
  if (!signature.startsWith("sha256=") || !timingSafeEqual(expected, signature)) {
    return json(401, { error: "invalid_signature" });
  }

  // 2. Event routing.
  const event = req.headers.get("x-github-event") ?? "";
  const delivery = req.headers.get("x-github-delivery") ?? "";
  if (!EVENT_RE.test(event) || !DELIVERY_RE.test(delivery)) {
    return json(400, { error: "missing_or_invalid_github_headers" });
  }
  if (event === "ping") {
    return json(200, { ok: true, event, delivery_id: delivery });
  }
  if (event !== "push") {
    return json(202, { status: "ignored", event, delivery_id: delivery });
  }

  let payload: unknown;
  try {
    payload = parsePayload(body, req.headers.get("content-type") ?? "");
  } catch {
    return json(400, { error: "invalid_json" });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return json(400, { error: "invalid_json" });
  }

  // 3. Inbox: one RPC, one transaction (ingest_event row + queue message).
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("ingest_receive", {
    p_delivery_id: delivery,
    p_event_type: event,
    p_payload: payload,
  });
  if (error) {
    // 5xx: GitHub shows the delivery as failed and it can be redelivered (idempotent).
    console.error("github-webhook: ingest_receive failed", error.code, error.message);
    const status = error.code === "22023" ? 400 : 500;
    return json(status, { error: "ingest_failed", code: error.code ?? null });
  }
  return json(202, data as Record<string, unknown>);
});
