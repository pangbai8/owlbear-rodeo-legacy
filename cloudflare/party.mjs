// Shared data for the party status panel (public/party-panel): a tiny
// document store per game room, kept in the room's SQLite storage.
// Paths look like Firestore ones: "teams/t1", "teams/t1/members/c1".

export const PARTY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_DOC_BYTES = 64 * 1024;
export const MAX_DOCS = 1000;
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** A document path: collection/doc pairs, at most three levels deep */
export function validDocPath(path) {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return parts.length >= 2 && parts.length <= 6 && parts.length % 2 === 0 && parts.every((p) => SEGMENT.test(p));
}

export class PartyError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export class PartyStore {
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS party_docs (path TEXT PRIMARY KEY, data TEXT NOT NULL)");
  }

  all() {
    const docs = {};
    for (const row of this.sql.exec("SELECT path, data FROM party_docs")) docs[row.path] = JSON.parse(row.data);
    return docs;
  }

  set(path, data) {
    if (!validDocPath(path)) throw new PartyError("invalid_argument", "bad path");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new PartyError("invalid_argument", "bad data");
    const text = JSON.stringify(data);
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > MAX_DOC_BYTES) throw new PartyError("quota_exceeded", "document too large");
    const [{ count, total }] = this.sql
      .exec("SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(CAST(data AS BLOB))), 0) AS total FROM party_docs WHERE path != ?", path)
      .toArray();
    if (count >= MAX_DOCS || total + bytes > MAX_TOTAL_BYTES) throw new PartyError("quota_exceeded", "room storage full");
    this.sql.exec("INSERT OR REPLACE INTO party_docs (path, data) VALUES (?, ?)", path, text);
    return JSON.parse(text);
  }

  delete(path) {
    if (!validDocPath(path)) throw new PartyError("invalid_argument", "bad path");
    this.sql.exec("DELETE FROM party_docs WHERE path = ?", path);
  }

  clear() {
    this.sql.exec("DELETE FROM party_docs");
  }
}
