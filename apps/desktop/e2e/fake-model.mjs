/**
 * A pretend model for the end-to-end test: an OpenAI-style server that answers every
 * chat with «وصلتني: <the last user message>», streamed a few characters at a time like a
 * real model. No network, no key, no cost — and the reply is known in advance, so the
 * test can look for it.
 */

import http from "node:http";

const port = Number(process.env.FAKE_MODEL_PORT ?? 9931);

function lastUserText(messages) {
  const user = [...(messages ?? [])].reverse().find((m) => m.role === "user");
  if (!user) return "";
  if (typeof user.content === "string") return user.content;
  return (user.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join(" ");
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.endsWith("/models")) {
    return send(res, 200, { object: "list", data: [{ id: "fake-echo", object: "model" }] });
  }
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(res, 404, { error: "not found" });

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    // The question may arrive with Rafiq's notes around it; the reply quotes its last line.
    const asked = lastUserText(body.messages).trim().split("\n").pop() ?? "";
    const reply = `وصلتني: ${asked}`;
    const usage = { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 };

    if (!body.stream) {
      return send(res, 200, {
        id: "fake-1",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage,
      });
    }

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const chunk = (delta, finish = null, extra = {}) =>
      res.write(`data: ${JSON.stringify({ id: "fake-1", object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
    const pieces = reply.match(/.{1,4}/gsu) ?? [reply];
    let i = 0;
    const timer = setInterval(() => {
      if (i < pieces.length) {
        chunk(i === 0 ? { role: "assistant", content: pieces[i] } : { content: pieces[i] });
        i += 1;
        return;
      }
      clearInterval(timer);
      chunk({}, "stop", { usage });
      res.end("data: [DONE]\n\n");
    }, 30);
  });
});

server.listen(port, "127.0.0.1", () => console.log(`fake model on http://127.0.0.1:${port}`));
