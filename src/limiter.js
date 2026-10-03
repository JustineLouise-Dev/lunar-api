/**
 * Lunar AI API
 * Copyright (c) 2026 JustineLouise. Dilisensikan di bawah MIT License (lihat LICENSE).
 *
 * Penghitung limit per API key (satu Durable Object per key).
 * Periode: hour | day | week | month, memakai zona waktu WIB (UTC+7).
 * Minggu dimulai hari Senin. Jendela direset otomatis saat periode berganti.
 */
import { DurableObject } from "cloudflare:workers";

const TZ_MS = 7 * 3600 * 1000; // WIB
const H = 3600000;
const D = 86400000;

export function windowOf(period, now = Date.now()) {
  const t = now + TZ_MS;
  if (period === "hour") {
    const id = Math.floor(t / H);
    return { id, reset: (id + 1) * H - TZ_MS };
  }
  if (period === "week") {
    const id = Math.floor((Math.floor(t / D) + 3) / 7); // minggu mulai Senin
    return { id, reset: (7 * (id + 1) - 3) * D - TZ_MS };
  }
  if (period === "month") {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    return { id: y * 12 + m, reset: Date.UTC(y, m + 1, 1) - TZ_MS };
  }
  const id = Math.floor(t / D);
  return { id, reset: (id + 1) * D - TZ_MS };
}

const used = (slot, period) =>
  slot && slot.p === period && slot.w === windowOf(period).id ? slot.n : 0;

const bump = (slot, period, by) => ({
  p: period,
  w: windowOf(period).id,
  n: used(slot, period) + by,
});

function fail(kind, period) {
  const secs = Math.ceil((windowOf(period).reset - Date.now()) / 1000);
  return { ok: false, kind, period, retryAfter: Math.max(1, secs) };
}

export const limiterStub = (env, id) => env.LIMITER.get(env.LIMITER.idFromName(id));

export class KeyLimiter extends DurableObject {
  /** Cek limit lalu hitung 1 request. Dipanggil sebelum model dijalankan. */
  async reserve(L = {}) {
    const s = (await this.ctx.storage.get("s")) || {};
    const rp = L.reqPeriod || "day";
    const tp = L.tokPeriod || "day";
    if (L.reqMax > 0 && used(s.req, rp) >= L.reqMax) return fail("request", rp);
    if (L.tokMax > 0 && used(s.tok, tp) >= L.tokMax) return fail("token", tp);
    s.req = bump(s.req, rp, 1);
    await this.ctx.storage.put("s", s);
    return { ok: true };
  }

  /** Tambah pemakaian token setelah respons selesai. */
  async addTokens(n, L = {}) {
    if (!(n > 0)) return;
    const s = (await this.ctx.storage.get("s")) || {};
    s.tok = bump(s.tok, L.tokPeriod || "day", Math.round(n));
    await this.ctx.storage.put("s", s);
  }

  /** Pemakaian pada jendela saat ini (untuk tampilan admin). */
  async usage(L = {}) {
    const s = (await this.ctx.storage.get("s")) || {};
    return {
      reqUsed: used(s.req, L.reqPeriod || "day"),
      tokUsed: used(s.tok, L.tokPeriod || "day"),
    };
  }
}
