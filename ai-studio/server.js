// Intercambio Navideño — servidor para Google AI Studio / Cloud Run.
// Misma API que la versión de Cloudflare; los datos viven en Firestore.
// Toda la lectura y escritura pasa por aquí: el navegador nunca toca Firestore.

import express from "express";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SIZE = 6;
const TOKEN = /^[0-9a-f]{48}$/; // 16 hex del sorteo + 32 hex secretos (128 bits)

const hex = (bytes) => randomBytes(bytes).toString("hex");

// Permutación aleatoria uniforme sin puntos fijos: nadie se saca a sí mismo.
const derangement = (n) => {
  let p;
  do {
    p = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [p[i], p[j]] = [p[j], p[i]];
    }
  } while (p.some((v, i) => v === i));
  return p;
};

const sameSecret = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const fail = (status, error) => ({ status, error });

/* ---------- Almacenamiento ---------- */

// Firestore: cada sorteo es un documento; elegir regalo usa una transacción,
// así que si dos personas tocan el mismo regalo a la vez solo una lo obtiene.
const firestoreStore = async () => {
  const { initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const cfgPath = join(ROOT, "firebase-applet-config.json");
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
  const app = initializeApp(cfg.projectId ? { projectId: cfg.projectId } : undefined);
  const dbId = process.env.FIRESTORE_DATABASE_ID || cfg.firestoreDatabaseId;
  const col = (dbId ? getFirestore(app, dbId) : getFirestore(app)).collection("sorteos");
  return {
    async get(id) {
      const snap = await col.doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async create(id, data) {
      await col.doc(id).create(data);
    },
    async change(id, fn) {
      const ref = col.doc(id);
      return ref.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const { save, result } = fn(snap.exists ? snap.data() : null);
        if (save) tx.set(ref, save);
        return result;
      });
    },
    async remove(id) {
      await col.doc(id).delete();
    },
  };
};

const store = await firestoreStore();

/* ---------- Reglas del sorteo ---------- */

const find = (s, secret) => (s ? s.people.findIndex((p) => sameSecret(p.secret, secret)) : -1);

const snapshot = (s, i) => {
  const me = s.people[i];
  return {
    me: me.name,
    date: s.date,
    budget: s.budget,
    gifts: s.slots.map((who) => (who === null ? "free" : who === i ? "mine" : "taken")),
    result: me.slot === null ? null : s.people[me.gives].name,
  };
};

const cleanDraw = (b) => {
  if (!b || !Array.isArray(b.names) || b.names.length !== SIZE) return null;
  const names = b.names.map((n) => (typeof n === "string" ? n.trim().replace(/\s+/g, " ") : ""));
  if (names.some((n) => !n || n.length > 30)) return null;
  if (new Set(names.map((n) => n.toLocaleLowerCase("es"))).size !== SIZE) return null;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
  const n = Number(b.budget);
  const budget = b.budget !== "" && b.budget != null && Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
  return { names, date, budget };
};

const createDraw = async (input) => {
  const drawId = hex(8), order = derangement(SIZE);
  const s = {
    adminSecret: hex(16),
    date: input.date,
    budget: input.budget,
    created: Date.now(),
    people: input.names.map((name, i) => ({ name, secret: hex(16), gives: order[i], slot: null, at: null })),
    slots: Array(SIZE).fill(null),
  };
  await store.create(drawId, s);
  return { admin: drawId + s.adminSecret, people: s.people.map((p) => ({ name: p.name, token: drawId + p.secret })) };
};

const viewDraw = async (drawId, secret) => {
  const s = await store.get(drawId), i = find(s, secret);
  return i < 0 ? fail(404, "not_found") : snapshot(s, i);
};

const pickGift = (drawId, secret, slot) =>
  store.change(drawId, (s) => {
    const i = find(s, secret);
    if (i < 0) return { result: fail(404, "not_found") };
    if (s.people[i].slot !== null) return { result: snapshot(s, i) }; // ya eligió: no cambia
    if (s.slots[slot] !== null) return { result: { ...fail(409, "taken"), ...snapshot(s, i) } };
    s.slots[slot] = i;
    s.people[i].slot = slot;
    s.people[i].at = Date.now();
    return { save: s, result: snapshot(s, i) };
  });

const adminDraw = async (drawId, secret) => {
  const s = await store.get(drawId);
  if (!s || !sameSecret(s.adminSecret, secret)) return fail(404, "not_found");
  // El panel nunca recibe las asignaciones.
  return { date: s.date, budget: s.budget, people: s.people.map((p) => ({ name: p.name, secret: p.secret, done: p.slot !== null })) };
};

const closeDraw = async (drawId, secret) => {
  const s = await store.get(drawId);
  if (!s || !sameSecret(s.adminSecret, secret)) return fail(404, "not_found");
  await store.remove(drawId);
  return { ok: true };
};

/* ---------- HTTP ---------- */

const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({ "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  next();
});
app.use(express.json({ limit: "4kb" }));

const reply = (res, r) => res.status(r.error ? r.status : 200).json(r);
const split = (t) => [t.slice(0, 16), t.slice(16)];
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) { res.status(500).json({ error: "server" }); }
};

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/draws", wrap(async (req, res) => {
  const input = cleanDraw(req.body);
  if (!input) return res.status(400).json({ error: "invalid" });
  res.json(await createDraw(input));
}));

app.get("/api/p/:t", wrap(async (req, res) => {
  if (!TOKEN.test(req.params.t)) return res.status(404).json({ error: "not_found" });
  reply(res, await viewDraw(...split(req.params.t)));
}));

app.post("/api/p/:t/pick", wrap(async (req, res) => {
  const slot = req.body?.slot;
  if (!TOKEN.test(req.params.t)) return res.status(404).json({ error: "not_found" });
  if (!Number.isInteger(slot) || slot < 0 || slot >= SIZE) return res.status(400).json({ error: "invalid" });
  reply(res, await pickGift(...split(req.params.t), slot));
}));

app.get("/api/admin/:t", wrap(async (req, res) => {
  if (!TOKEN.test(req.params.t)) return res.status(404).json({ error: "not_found" });
  reply(res, await adminDraw(...split(req.params.t)));
}));

app.delete("/api/admin/:t", wrap(async (req, res) => {
  if (!TOKEN.test(req.params.t)) return res.status(404).json({ error: "not_found" });
  reply(res, await closeDraw(...split(req.params.t)));
}));

app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

// Página con metadatos para la vista previa de WhatsApp.
const HTML = readFileSync(join(ROOT, "public", "index.html"), "utf8");
const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const page = (kind) => wrap(async (req, res) => {
  const origin = `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
  let title = "Intercambio Navideño";
  let desc = "Sorteo navideño de intercambio de regalos. Elige un regalo y descubre a quién te toca regalar.";
  if (kind === "p") {
    const v = await viewDraw(...split(req.params.t));
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
<meta property="og:image" content="${origin}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="description" content="${attr(desc)}">
<!--/OG-->`;
  if (kind) res.set("x-robots-tag", "noindex, nofollow");
  res.type("html").send(HTML.replace(/<!--OG-->[\s\S]*?<!--\/OG-->/, og));
});

app.get(["/", "/nuevo"], page());
app.get("/p/:t", (req, res, next) => (TOKEN.test(req.params.t) ? page("p")(req, res) : next()));
app.get("/admin/:t", (req, res, next) => (TOKEN.test(req.params.t) ? page("admin")(req, res) : next()));
app.use(express.static(join(ROOT, "public"), { index: false }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Intercambio Navideño en el puerto ${port}`));
