/**
 * Lunar AI API - Cloudflare Worker (Workers AI binding)
 * Endpoint kompatibel OpenAI:
 *   GET  /v1/models
 *   POST /v1/chat/completions
 *
 * Nama model asli disembunyikan, hanya alias "lunar-*" yang terlihat.
 * Format alias: lunar-<versi>-<ukuran>[-varian]
 */

import { handleAdmin, verifyApiKey } from "./admin.js";
import { renderDocs } from "./docs.js";

// alias -> model ID asli di Workers AI
// Cek katalog terbaru: https://developers.cloudflare.com/workers-ai/models/
const MODELS = {
  // Gemma
  "lunar-3-12b": "@cf/google/gemma-3-12b-it",
  "lunar-sea-lion-v4-27b": "@cf/aisingapore/gemma-sea-lion-v4-27b-it",

  // Llama
  "lunar-2-7b": "@cf/meta/llama-2-7b-chat-fp16",
  "lunar-3-8b": "@cf/meta/llama-3-8b-instruct",
  "lunar-3.1-8b": "@cf/meta/llama-3.1-8b-instruct",
  "lunar-3.1-8b-fast": "@cf/meta/llama-3.1-8b-instruct-fast",
  "lunar-3.2-1b": "@cf/meta/llama-3.2-1b-instruct",
  "lunar-3.2-3b": "@cf/meta/llama-3.2-3b-instruct",
  "lunar-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "lunar-4-scout-17b": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "lunar-guard-3-8b": "@cf/meta/llama-guard-3-8b",

  // Qwen
  "lunar-3-30b": "@cf/qwen/qwen3-30b-a3b-fp8",
  "lunar-2.5-coder-32b": "@cf/qwen/qwen2.5-coder-32b-instruct",
  "lunar-q-32b": "@cf/qwen/qwq-32b",

  // Mistral
  "lunar-0.1-7b": "@cf/mistral/mistral-7b-instruct-v0.1",
  "lunar-0.2-7b": "@hf/mistral/mistral-7b-instruct-v0.2",
  "lunar-3.1-24b": "@cf/mistralai/mistral-small-3.1-24b-instruct",

  // OpenAI open-weight
  "lunar-oss-20b": "@cf/openai/gpt-oss-20b",
  "lunar-oss-120b": "@cf/openai/gpt-oss-120b",

  // DeepSeek
  "lunar-r1-32b": "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",

  // IBM Granite
  "lunar-4.0-micro": "@cf/ibm-granite/granite-4.0-h-micro",
};

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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/") {
      return json({ name: "Lunar AI API", status: "ok", docs: "/docs", models: "/v1/models" });
    }

    // Dokumentasi publik (tanpa API key)
    if (url.pathname === "/docs" || url.pathname === "/docs/") {
      return new Response(renderDocs(url.origin, Object.keys(MODELS)), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
      });
    }

    // Web admin (login sendiri, tidak memakai API key)
    if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
      return handleAdmin(request, env, url);
    }

    // Semua endpoint API butuh API key yang dibuat lewat web admin
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!(await verifyApiKey(env, token))) {
      return error("API key tidak valid.", 401, "authentication_error");
    }

    if (url.pathname === "/v1/models" && request.method === "GET") {
      const created = Math.floor(Date.now() / 1000);
      return json({
        object: "list",
        data: Object.keys(MODELS).map((id) => ({
          id,
          object: "model",
          created,
          owned_by: "lunar",
        })),
      });
    }

    if (url.pathname === "/v1/chat/completions" && request.method === "POST") {
      return handleChat(request, env);
    }

    return error("Endpoint tidak ditemukan.", 404, "not_found");
  },
};

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body harus berupa JSON yang valid.");
  }

  const alias = body.model;
  const realModel = MODELS[alias];
  if (!realModel) {
    return error(
      `Model "${alias}" tidak ditemukan. Lihat daftar di /v1/models.`,
      404,
      "model_not_found"
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return error("Field 'messages' wajib diisi.");
  }

  const input = { messages: body.messages };
  if (body.max_tokens != null) input.max_tokens = body.max_tokens;
  if (body.temperature != null) input.temperature = body.temperature;
  if (body.top_p != null) input.top_p = body.top_p;
  if (body.seed != null) input.seed = body.seed;
  if (body.frequency_penalty != null) input.frequency_penalty = body.frequency_penalty;
  if (body.presence_penalty != null) input.presence_penalty = body.presence_penalty;

  const id = "chatcmpl-" + crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);

  try {
    // ---------- Streaming ----------
    if (body.stream) {
      input.stream = true;
      const upstream = await env.AI.run(realModel, input);
      return new Response(toOpenAIStream(upstream, { id, created, model: alias }), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...CORS,
        },
      });
    }

    // ---------- Non-streaming ----------
    const result = await env.AI.run(realModel, input);
    const text = extractText(result);

    return json({
      id,
      object: "chat.completion",
      created,
      model: alias,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: text },
          finish_reason: "stop",
        },
      ],
      usage: result?.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    });
  } catch (e) {
    return error(`Gagal memproses permintaan: ${e.message}`, 500, "server_error");
  }
}

// Ambil teks dari berbagai format respons Workers AI
function extractText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  const msg = result.choices?.[0]?.message;
  if (msg?.content) return msg.content;
  if (result.choices?.[0]?.text) return result.choices[0].text;
  return "";
}

// Ubah SSE Workers AI -> SSE format OpenAI
function toOpenAIStream(upstream, { id, created, model }) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  const chunk = (delta, finish = null) =>
    encoder.encode(
      "data: " +
        JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        }) +
        "\n\n"
    );

  const transform = new TransformStream({
    start(controller) {
      controller.enqueue(chunk({ role: "assistant", content: "" }));
    },
    transform(raw, controller) {
      buffer += decoder.decode(raw, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          const piece =
            j.response ??
            j.choices?.[0]?.delta?.content ??
            j.choices?.[0]?.text ??
            "";
          if (piece) controller.enqueue(chunk({ content: piece }));
        } catch {
          /* abaikan baris yang bukan JSON */
        }
      }
    },
    flush(controller) {
      controller.enqueue(chunk({}, "stop"));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });

  return upstream.pipeThrough(transform);
}
