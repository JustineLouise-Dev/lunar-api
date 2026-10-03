/**
 * Lunar AI API - Cloudflare Worker (Workers AI binding)
 *   GET  /v1/models
 *   POST /v1/chat/completions   (streaming, vision, function calling)
 *   POST /v1/images/generations
 *   POST /v1/embeddings
 *   GET  /docs   |   /admin
 */
import { handleAdmin, verifyApiKey } from "./admin.js";
import { renderDocs } from "./docs.js";
import { MODELS } from "./models.js";
import { limiterStub } from "./limiter.js";

export { KeyLimiter } from "./limiter.js";

const PERSONA_NAME = "Lunar AI";
const CREATOR = "JustineLouise";
const PERSONA =
  `Identitas: Kamu adalah ${PERSONA_NAME}, asisten AI yang dibuat oleh ${CREATOR}. ` +
  `Jika ditanya siapa kamu, siapa namamu, siapa yang membuatmu, atau model apa kamu, jawab bahwa kamu ${PERSONA_NAME} buatan ${CREATOR}. ` +
  `Jangan pernah menyebut atau mengaku sebagai Gemma, Llama, Qwen, GPT, DeepSeek, Mistral, GLM, Kimi, Nemotron, Granite, Gemini, Claude, ChatGPT, ` +
  `atau model dan perusahaan AI lain, dan jangan menebak model dasarnya. ` +
  `Jika ditanya detail teknis tentang model atau arsitektur di balik dirimu, katakan bahwa kamu tidak memiliki informasi tersebut. ` +
  `Balas dalam bahasa yang dipakai pengguna.`;

const PN = { hour: "per jam", day: "per hari", week: "per minggu", month: "per bulan" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const error = (message, status = 400, type = "invalid_request_error") =>
  json({ error: { message, type } }, status);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/") {
      return json({ name: "Lunar AI API", status: "ok", docs: "/docs", models: "/v1/models" });
    }

    if (url.pathname === "/docs" || url.pathname === "/docs/") {
      return new Response(renderDocs(url.origin, MODELS), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url);
    }

    // Semua endpoint API butuh API key dari web admin
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const auth = await verifyApiKey(env, token);
    if (!auth) return error("API key tidak valid.", 401, "authentication_error");

    if (url.pathname === "/v1/models" && request.method === "GET") {
      const created = Math.floor(Date.now() / 1000);
      return json({
        object: "list",
        data: Object.entries(MODELS).map(([id, m]) => ({
          id,
          object: "model",
          created,
          owned_by: "lunar",
          type: m.type,
          capabilities: { vision: !!m.vision, tools: !!m.tools },
        })),
      });
    }

    if (request.method === "POST") {
      if (url.pathname === "/v1/chat/completions") return handleChat(request, env, ctx, auth);
      if (url.pathname === "/v1/images/generations") return handleImage(request, env, ctx, auth);
      if (url.pathname === "/v1/embeddings") return handleEmbeddings(request, env, ctx, auth);
    }

    return error("Endpoint tidak ditemukan.", 404, "not_found");
  },
};

/* ---------------- Limit ---------------- */

async function gate(env, auth) {
  const r = await limiterStub(env, auth.id).reserve(auth.meta.limits || {});
  if (r.ok) return null;
  const mins = Math.ceil(r.retryAfter / 60);
  const res = error(
    `Batas ${r.kind} ${PN[r.period]} untuk API key ini sudah habis. Coba lagi sekitar ${mins} menit lagi.`,
    429,
    "rate_limit_exceeded"
  );
  res.headers.set("Retry-After", String(r.retryAfter));
  return res;
}

function recordTokens(env, ctx, auth, n) {
  if (!(n > 0)) return;
  ctx.waitUntil(limiterStub(env, auth.id).addTokens(n, auth.meta.limits || {}));
}

/* ---------------- Helper ---------------- */

const estimate = (chars) => Math.ceil(chars / 4);

function estimateMessages(messages) {
  let chars = 0;
  let images = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === "text") chars += (p.text || "").length;
        else images++;
      }
    }
    if (m.tool_calls) chars += JSON.stringify(m.tool_calls).length;
  }
  return estimate(chars) + images * 500;
}

// Sisipkan persona Lunar AI sebagai system prompt
function withPersona(messages) {
  const first = messages[0];
  if (first && first.role === "system" && typeof first.content === "string") {
    return [{ ...first, content: PERSONA + "\n\n" + first.content }, ...messages.slice(1)];
  }
  return [{ role: "system", content: PERSONA }, ...messages];
}

function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/* ---------------- Chat ---------------- */

async function handleChat(request, env, ctx, auth) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body harus berupa JSON yang valid.");
  }

  const alias = body.model;
  const cfg = MODELS[alias];
  if (!cfg || cfg.type !== "chat") {
    return error(`Model "${alias}" tidak ditemukan. Lihat daftar di /v1/models.`, 404, "model_not_found");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return error("Field 'messages' wajib diisi.");
  }

  const blocked = await gate(env, auth);
  if (blocked) return blocked;

  const input = { messages: withPersona(body.messages) };
  const maxTok = body.max_tokens ?? body.max_completion_tokens;
  if (maxTok != null) input.max_tokens = maxTok;
  for (const k of [
    "temperature", "top_p", "seed", "frequency_penalty", "presence_penalty",
    "tools", "tool_choice", "response_format",
  ]) {
    if (body[k] != null) input[k] = body[k];
  }

  const id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  const promptTokens = estimateMessages(body.messages) + estimate(PERSONA.length);

  try {
    if (body.stream) {
      input.stream = true;
      const upstream = await env.AI.run(cfg.id, input);
      const stream = toOpenAIStream(upstream, {
        id, created, model: alias, promptTokens,
        onDone: (n) => recordTokens(env, ctx, auth, n),
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...CORS,
        },
      });
    }

    const result = await env.AI.run(cfg.id, input);
    let choices;
    let usage = result?.usage;

    if (Array.isArray(result?.choices)) {
      choices = result.choices; // format OpenAI dari Workers AI
    } else {
      const msg = { role: "assistant", content: typeof result === "string" ? result : result?.response ?? "" };
      let finish = "stop";
      if (Array.isArray(result?.tool_calls) && result.tool_calls.length) {
        msg.tool_calls = result.tool_calls.map((t) => ({
          id: "call_" + crypto.randomUUID().slice(0, 8),
          type: "function",
          function: {
            name: t.name,
            arguments: typeof t.arguments === "string" ? t.arguments : JSON.stringify(t.arguments ?? {}),
          },
        }));
        finish = "tool_calls";
      }
      choices = [{ index: 0, message: msg, finish_reason: finish }];
    }

    if (!usage || !usage.total_tokens) {
      const m = choices[0]?.message || {};
      const outChars = (typeof m.content === "string" ? m.content.length : 0) +
        (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
      const c = estimate(outChars);
      usage = { prompt_tokens: promptTokens, completion_tokens: c, total_tokens: promptTokens + c };
    }
    recordTokens(env, ctx, auth, usage.total_tokens);

    return json({ id, object: "chat.completion", created, model: alias, choices, usage });
  } catch (e) {
    return error(`Gagal memproses permintaan: ${e.message}`, 500, "server_error");
  }
}

// Ubah SSE Workers AI -> SSE format OpenAI (teks, tool_calls, reasoning)
function toOpenAIStream(upstream, { id, created, model, promptTokens, onDone }) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let outChars = 0;
  let usage = null;
  let finished = false;

  const send = (c, delta, finish = null) =>
    c.enqueue(
      encoder.encode(
        "data: " +
          JSON.stringify({
            id, object: "chat.completion.chunk", created, model,
            choices: [{ index: 0, delta, finish_reason: finish }],
          }) +
          "\n\n"
      )
    );

  const handle = (c, line) => {
    const t = line.trim();
    if (!t.startsWith("data:")) return;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") return;
    let j;
    try { j = JSON.parse(payload); } catch { return; }
    if (j.usage) usage = j.usage;
    const ch = j.choices?.[0];
    if (ch?.delta) {
      const d = ch.delta;
      if (d.content) outChars += d.content.length;
      if (d.tool_calls) outChars += JSON.stringify(d.tool_calls).length;
      if (Object.keys(d).length || ch.finish_reason) send(c, d, ch.finish_reason ?? null);
      if (ch.finish_reason) finished = true;
    } else {
      const piece = j.response ?? ch?.text ?? "";
      if (piece) { outChars += piece.length; send(c, { content: piece }); }
    }
  };

  return upstream.pipeThrough(
    new TransformStream({
      start(c) { send(c, { role: "assistant", content: "" }); },
      transform(raw, c) {
        buffer += decoder.decode(raw, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) handle(c, l);
      },
      flush(c) {
        if (buffer) handle(c, buffer);
        if (!finished) send(c, {}, "stop");
        c.enqueue(encoder.encode("data: [DONE]\n\n"));
        onDone(usage?.total_tokens ?? promptTokens + estimate(outChars));
      },
    })
  );
}

/* ---------------- Gambar ---------------- */

async function handleImage(request, env, ctx, auth) {
  let body;
  try { body = await request.json(); } catch { return error("Body harus berupa JSON yang valid."); }

  const cfg = MODELS[body.model];
  if (!cfg || cfg.type !== "image") {
    return error(`Model gambar "${body.model}" tidak ditemukan.`, 404, "model_not_found");
  }
  if (!body.prompt || typeof body.prompt !== "string") return error("Field 'prompt' wajib diisi.");

  const blocked = await gate(env, auth);
  if (blocked) return blocked;

  const input = { prompt: body.prompt };
  if (cfg.kind === "flux") {
    input.steps = 4;
  } else {
    const [w, h] = String(body.size || "1024x1024").split("x").map(Number);
    input.width = w >= 256 && w <= 2048 ? w : 1024;
    input.height = h >= 256 && h <= 2048 ? h : 1024;
  }
  if (body.seed != null) input.seed = body.seed;

  try {
    const result = await env.AI.run(cfg.id, input);
    let b64;
    if (result && typeof result === "object" && typeof result.image === "string") {
      b64 = result.image;
    } else {
      b64 = toBase64(new Uint8Array(await new Response(result).arrayBuffer()));
    }
    return json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: b64 }] });
  } catch (e) {
    return error(`Gagal membuat gambar: ${e.message}`, 500, "server_error");
  }
}

/* ---------------- Embedding ---------------- */

async function handleEmbeddings(request, env, ctx, auth) {
  let body;
  try { body = await request.json(); } catch { return error("Body harus berupa JSON yang valid."); }

  const cfg = MODELS[body.model];
  if (!cfg || cfg.type !== "embedding") {
    return error(`Model embedding "${body.model}" tidak ditemukan.`, 404, "model_not_found");
  }
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  if (!inputs.length || inputs.some((s) => typeof s !== "string" || !s)) {
    return error("Field 'input' harus berupa string atau array string.");
  }

  const blocked = await gate(env, auth);
  if (blocked) return blocked;

  try {
    const r = await env.AI.run(cfg.id, { text: inputs });
    const tokens = estimate(inputs.reduce((n, s) => n + s.length, 0));
    recordTokens(env, ctx, auth, tokens);
    return json({
      object: "list",
      model: body.model,
      data: r.data.map((embedding, index) => ({ object: "embedding", index, embedding })),
      usage: { prompt_tokens: tokens, total_tokens: tokens },
    });
  } catch (e) {
    return error(`Gagal membuat embedding: ${e.message}`, 500, "server_error");
  }
}
