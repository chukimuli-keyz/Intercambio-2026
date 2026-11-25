import { DurableObject } from "cloudflare:workers";

/* Intercambio Navideño — API y servidor de páginas.
   Cada sorteo vive en su propio Durable Object: las operaciones se ejecutan
   una por una, así que dos personas nunca pueden quedarse con el mismo regalo. */

const SIZE = 6;
const TOKEN = /^[0-9a-f]{48}$/; // 16 hex del sorteo + 32 hex secretos (128 bits)

const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

const randInt = (n) => {
  const limit = Math.floor(2 ** 32 / n) * n;
  let x;
  do x = crypto.getRandomValues(new Uint32Array(1))[0];
  while (x >= limit);
  return x % n;
};

// Permutación aleatoria uniforme sin puntos fijos: nadie se saca a sí mismo.
const derangement = (n) => {
  let p;
  do {
    p = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
  } while (p.some((v, i) => v === i));
  return p;
};

const sameSecret = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

const fail = (status, error) => ({ status, error });

export class Draw extends DurableObject {
  load() {
    return this.ctx.storage.get("s");
  }

  async create({ names, date, budget }) {
    if (await this.load()) return fail(409, "exists");
    const order = derangement(SIZE);
    const s = {
      adminSecret: hex(16),
      date,
      budget,
      created: Date.now(),
      people: names.map((name, i) => ({ name, secret: hex(16), gives: order[i], slot: null, at: null })),
      slots: Array(SIZE).fill(null),
    };
    await this.ctx.storage.put("s", s);
    return { adminSecret: s.adminSecret, people: s.people.map(({ name, secret }) => ({ name, secret })) };
  }

  async admin(secret) {
    const s = await this.load();
    if (!s || !sameSecret(s.adminSecret, secret)) return fail(404, "not_found");
    // El panel nunca recibe las asignaciones.
    return {
      date: s.date,
      budget: s.budget,
      people: s.people.map((p) => ({ name: p.name, secret: p.secret, done: p.slot !== null })),
    };
  }

  async close(secret) {
    const s = await this.load();
    if (!s || !sameSecret(s.adminSecret, secret)) return fail(404, "not_found");
    await this.ctx.storage.deleteAll();
    return { ok: true };
  }

  find(s, secret) {
    return s ? s.people.findIndex((p) => sameSecret(p.secret, secret)) : -1;
  }

  snapshot(s, i) {
    const me = s.people[i];
    return {
      me: me.name,
      date: s.date,
      budget: s.budget,
      gifts: s.slots.map((who) => (who === null ? "free" : who === i ? "mine" : "taken")),
      result: me.slot === null ? null : s.people[me.gives].name,
    };
  }

  async view(secret) {
    const s = await this.load();
    const i = this.find(s, secret);
    return i < 0 ? fail(404, "not_found") : this.snapshot(s, i);
  }

  async pick(secret, slot) {
    const s = await this.load();
    const i = this.find(s, secret);
    if (i < 0) return fail(404, "not_found");
    if (s.people[i].slot !== null) return this.snapshot(s, i); // ya eligió: su resultado no cambia
    if (s.slots[slot] !== null) return { ...fail(409, "taken"), ...this.snapshot(s, i) };
    s.slots[slot] = i;
    s.people[i].slot = slot;
    s.people[i].at = Date.now();
    await this.ctx.storage.put("s", s);
    return this.snapshot(s, i);
  }
}

/* ---------- HTTP ---------- */

const baseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...baseHeaders, "content-type": "application/json; charset=utf-8" },
  });

const reply = (r) => (r.error ? json(r, r.status) : json(r));

const stub = (env, drawId) => env.DRAW.get(env.DRAW.idFromName(drawId));

const readBody = async (req) => {
  const text = await req.text();
  if (text.length > 4000) throw new Error("too_large");
  return JSON.parse(text || "{}");
};

const cleanDraw = (b) => {
  if (!Array.isArray(b.names) || b.names.length !== SIZE) return null;
  const names = b.names.map((n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ") : ""));
  if (names.some((n) => !n || n.length > 30)) return null;
  if (new Set(names.map((n) => n.toLocaleLowerCase("es"))).size !== SIZE) return null;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
  const n = Number(b.budget);
  const budget = b.budget !== "" && b.budget != null && Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
  return { names, date, budget };
};

async function api(req, env, path) {
  if (path === "/api/health") return json({ ok: true });

  if (path === "/api/draws") {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const input = cleanDraw(await readBody(req));
    if (!input) return json({ error: "invalid" }, 400);
    const drawId = hex(8);
    const r = await stub(env, drawId).create(input);
    if (r.error) return reply(r);
    return json({
      admin: drawId + r.adminSecret,
      people: r.people.map((p) => ({ name: p.name, token: drawId + p.secret })),
    });
  }

  const m = path.match(/^\/api\/(p|admin)\/([0-9a-f]{48})(\/pick)?$/);
  if (!m) return json({ error: "not_found" }, 404);
  const [, kind, token, pick] = m;
  const draw = stub(env, token.slice(0, 16));
  const secret = token.slice(16);

  if (kind === "p" && !pick && req.method === "GET") return reply(await draw.view(secret));
  if (kind === "p" && pick && req.method === "POST") {
    const { slot } = await readBody(req);
    if (!Number.isInteger(slot) || slot < 0 || slot >= SIZE) return json({ error: "invalid" }, 400);
    return reply(await draw.pick(secret, slot));
  }
  if (kind === "admin" && !pick && req.method === "GET") return reply(await draw.admin(secret));
  if (kind === "admin" && !pick && req.method === "DELETE") return reply(await draw.close(secret));
  return json({ error: "method" }, 405);
}

const attr = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Sirve la app con metadatos Open Graph para que WhatsApp muestre una vista previa.
async function page(req, env, url, kind, token) {
  const res = await env.ASSETS.fetch(new Request(new URL("/", url)));
  let html = await res.text();
  let title = "Intercambio Navideño";
  let desc = "Sorteo navideño de intercambio de regalos. Elige un regalo y descubre a quién te toca regalar.";
  if (kind === "p") {
    const v = await stub(env, token.slice(0, 16)).view(token.slice(16));
    if (!v.error) {
      title = `${v.me}, te espera un regalo misterioso`;
      desc = "Abre tu enlace personal, elige uno de los seis regalos y descubre a quién te toca regalar.";
    }
  }
  if (kind === "admin") title = "Panel del sorteo · Intercambio Navideño";
  const og = `<!--OG-->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Intercambio Navideño">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:image" content="${url.origin}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${attr(desc)}">
<!--/OG-->`;
  html = html.replace(/<!--OG-->[\s\S]*?<!--\/OG-->/, og);
  const headers = { ...baseHeaders, "content-type": "text/html; charset=utf-8" };
  if (kind) headers["x-robots-tag"] = "noindex, nofollow";
  return new Response(html, { headers });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) return await api(req, env, path);
      if (path === "/" || path === "/index.html" || path === "/nuevo") return await page(req, env, url);
      const m = path.match(/^\/(p|admin)\/([0-9a-f]{48})\/?$/);
      if (m && TOKEN.test(m[2])) return await page(req, env, url, m[1], m[2]);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: "server" }, e instanceof SyntaxError ? 400 : 500);
    }
  },
};
