/**
 * Lunar AI API
 * Copyright (c) 2026 JustineLouise. Dilisensikan di bawah MIT License (lihat LICENSE).
 *
 * Daftar model: alias "lunar-*" -> model asli di Workers AI.
 * v = mendukung input gambar (vision), t = mendukung function calling.
 * Flag hanya informasi untuk docs & /v1/models, tidak dipakai untuk memblokir.
 * Katalog resmi: https://developers.cloudflare.com/workers-ai/models/
 */
const chat = (id, o = {}) => ({ type: "chat", id, vision: !!o.v, tools: !!o.t });
const image = (id, kind) => ({ type: "image", id, kind });
const embed = (id) => ({ type: "embedding", id });

export const MODELS = {
  // ---- Chat ----
  "lunar-4-26b": chat("@cf/google/gemma-4-26b-a4b-it", { v: 1, t: 1 }),
  "lunar-4-27b-sea": chat("@cf/aisingapore/gemma-sea-lion-v4-27b-it"),

  "lunar-3.1-8b": chat("@cf/meta/llama-3.1-8b-instruct-fp8"),
  "lunar-3.2-1b": chat("@cf/meta/llama-3.2-1b-instruct"),
  "lunar-3.2-3b": chat("@cf/meta/llama-3.2-3b-instruct"),
  "lunar-3.3-70b": chat("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { t: 1 }),
  "lunar-4-scout-17b": chat("@cf/meta/llama-4-scout-17b-16e-instruct", { v: 1, t: 1 }),
  "lunar-guard-3-8b": chat("@cf/meta/llama-guard-3-8b"),

  "lunar-3-30b": chat("@cf/qwen/qwen3-30b-a3b-fp8", { t: 1 }),
  "lunar-3.8-27b": chat("@cf/qwen/qwen3.8-27b", { v: 1, t: 1 }),
  "lunar-2.5-coder-32b": chat("@cf/qwen/qwen2.5-coder-32b-instruct"),
  "lunar-q-32b": chat("@cf/qwen/qwq-32b"),

  "lunar-3.1-24b": chat("@cf/mistralai/mistral-small-3.1-24b-instruct", { v: 1, t: 1 }),

  "lunar-oss-20b": chat("@cf/openai/gpt-oss-20b", { t: 1 }),
  "lunar-oss-120b": chat("@cf/openai/gpt-oss-120b", { t: 1 }),

  "lunar-r1-32b": chat("@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"),
  "lunar-v4-flash": chat("@cf/deepseek-ai/deepseek-v4-flash-0731", { t: 1 }),
  "lunar-v4-pro": chat("@cf/deepseek-ai/deepseek-v4-pro-0813", { t: 1 }),

  "lunar-4.7-flash": chat("@cf/zai-org/glm-4.7-flash", { t: 1 }),
  "lunar-5.2": chat("@cf/zai-org/glm-5.2", { t: 1 }),
  "lunar-5.3": chat("@cf/zai-org/glm-5.3", { t: 1 }),
  "lunar-5.3-flash": chat("@cf/zai-org/glm-5.3-flash", { v: 1, t: 1 }),

  "lunar-k2.6": chat("@cf/moonshotai/kimi-k2.6", { v: 1, t: 1 }),
  "lunar-k2.7-code": chat("@cf/moonshotai/kimi-k2.7-code", { v: 1, t: 1 }),

  "lunar-3-120b": chat("@cf/nvidia/nemotron-3-120b-a12b", { t: 1 }),
  "lunar-4.0-micro": chat("@cf/ibm-granite/granite-4.0-h-micro", { t: 1 }),

  // ---- Generator gambar ----
  "lunar-image-1": image("@cf/black-forest-labs/flux-1-schnell", "flux"),
  "lunar-image-2": image("@cf/bytedance/stable-diffusion-xl-lightning", "sd"),
  "lunar-image-3": image("@cf/lykon/dreamshaper-8-lcm", "sd"),

  // ---- Embedding ----
  "lunar-embed-1": embed("@cf/baai/bge-base-en-v1.5"),
  "lunar-embed-2": embed("@cf/baai/bge-m3"), // multibahasa, cocok untuk bahasa Indonesia
  "lunar-embed-3": embed("@cf/google/embeddinggemma-300m"),
};
