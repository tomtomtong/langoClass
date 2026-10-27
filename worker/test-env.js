// In-memory D1 and R2 for Worker tests. D1 runs the checked-in migrations on
// node:sqlite; R2 keeps object bytes in a Map and enforces multipart part sizes.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function memoryD1({ migrate = true } = {}) {
  const db = new DatabaseSync(":memory:");
  if (migrate) {
    for (const file of ["0001_stores.sql", "0002_score_records.sql"]) {
      db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
  }
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function memoryR2() {
  const objects = new Map();
  const toBytes = async (value) => {
    if (value == null) return new Uint8Array(0);
    if (typeof value === "string") return new TextEncoder().encode(value);
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    return new Uint8Array(await new Response(value).arrayBuffer());
  };
  const objectOf = (key, stored, bytes) => ({
    key,
    size: stored.bytes.length,
    httpMetadata: stored.httpMetadata || {},
    body: new Response(bytes).body,
    arrayBuffer: async () => bytes.slice().buffer,
    text: async () => new TextDecoder().decode(bytes),
  });
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, { bytes: await toBytes(value), httpMetadata: options.httpMetadata || {} });
      return { key };
    },
    async get(key, options = {}) {
      const stored = objects.get(key);
      if (!stored) return null;
      let bytes = stored.bytes;
      if (options.range) {
        const offset = options.range.offset || 0;
        const length = options.range.length ?? bytes.length - offset;
        bytes = bytes.subarray(offset, offset + length);
      }
      return objectOf(key, stored, bytes);
    },
    async head(key) {
      const stored = objects.get(key);
      return stored ? { key, size: stored.bytes.length, httpMetadata: stored.httpMetadata } : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list({ prefix = "" } = {}) {
      return {
        objects: [...objects.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, stored]) => ({ key, size: stored.bytes.length })),
        truncated: false,
      };
    },
    async createMultipartUpload(key, options = {}) {
      const parts = new Map();
      return {
        async uploadPart(partNumber, value) {
          parts.set(partNumber, await toBytes(value));
          return { partNumber, etag: `etag-${partNumber}` };
        },
        async complete(list) {
          const ordered = list.map((part) => parts.get(part.partNumber));
          const first = ordered[0]?.length;
          if (ordered.slice(0, -1).some((part) => part.length !== first)) {
            throw new Error("All non-final parts must be the same size.");
          }
          const total = ordered.reduce((sum, part) => sum + part.length, 0);
          const bytes = new Uint8Array(total);
          let at = 0;
          for (const part of ordered) {
            bytes.set(part, at);
            at += part.length;
          }
          objects.set(key, { bytes, httpMetadata: options.httpMetadata || {}, multipart: ordered.length });
        },
        async abort() {
          parts.clear();
        },
      };
    },
  };
}

// Signs in as the built-in developer teacher (id 835).
export async function developerToken(handler, env) {
  const url = new URL("https://class.lango.ai/api/lango/login");
  const response = await handler(
    new Request(url, { method: "POST", body: JSON.stringify({ login: "lango-developer-alex", password: "lango123" }) }),
    env,
    url
  );
  return (await response.json()).token;
}

export function api(handler, env, token) {
  return async (path, init = {}) => {
    const url = new URL(path, "https://class.lango.ai");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const request = new Request(url, {
      method: init.method || "GET",
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
      duplex: "half",
    });
    return handler(request, env, url);
  };
}

export async function putDoc(env, name, value) {
  env.DB.raw
    .prepare("INSERT INTO documents (name, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET body = excluded.body")
    .run(name, JSON.stringify(value), new Date().toISOString());
}

export async function getDoc(env, name) {
  const row = env.DB.raw.prepare("SELECT body FROM documents WHERE name = ?").get(name);
  return row ? JSON.parse(row.body) : null;
}
