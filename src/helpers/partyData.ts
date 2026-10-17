// The party status panel's data, kept in the players' browsers instead of
// on the server. The current map's owner is the host: only the host takes
// changes, numbering them (version), and sends them to everyone over the
// game's WebRTC connections. Every browser keeps the latest copy it has
// seen (IndexedDB), so when the map changes hands the new owner carries on
// from the newest copy among the players online.

/** A room's panel data: Firestore-like paths ("teams/t1/members/c1") to documents */
export type PartyDocs = Record<string, any>;

export type PartySnapshot = {
  docs: PartyDocs;
  /** Changes made so far; the higher the newer */
  version: number;
  /** When the last change was made (ms), the tie-break */
  updated: number;
  /** The server's old copy has been read (and moved here) */
  serverChecked?: boolean;
};

export type PartyOp =
  | { op: "set"; path: string; data: any }
  | { op: "delete"; path: string }
  | { op: "clear" };

/** What a change did, for everyone else: one document, or all of them */
export type PartyChange =
  | { kind: "doc"; version: number; path: string; data: any }
  | { kind: "reset"; version: number };

export const MAX_DOC_BYTES = 64 * 1024;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export function emptySnapshot(): PartySnapshot {
  return { docs: {}, version: 0, updated: 0 };
}

/** A document path: collection/doc pairs, at most three levels deep */
export function validDocPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  const parts = path.split("/");
  return (
    parts.length >= 2 &&
    parts.length <= 6 &&
    parts.length % 2 === 0 &&
    parts.every((p) => SEGMENT.test(p))
  );
}

export class PartyOpError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/**
 * The host applies a change: the new snapshot and the change to send out.
 * Throws PartyOpError (invalid_argument, quota_exceeded) for bad changes.
 */
export function applyOp(
  snapshot: PartySnapshot,
  op: PartyOp,
  now = Date.now()
): { snapshot: PartySnapshot; change: PartyChange } {
  const version = snapshot.version + 1;
  if (op.op === "clear") {
    return {
      snapshot: { ...snapshot, docs: {}, version, updated: now },
      change: { kind: "reset", version },
    };
  }
  if (!validDocPath(op.path)) throw new PartyOpError("invalid_argument");
  const docs = { ...snapshot.docs };
  if (op.op === "delete") {
    delete docs[op.path];
    return {
      snapshot: { ...snapshot, docs, version, updated: now },
      change: { kind: "doc", version, path: op.path, data: null },
    };
  }
  if (!op.data || typeof op.data !== "object" || Array.isArray(op.data))
    throw new PartyOpError("invalid_argument");
  const text = JSON.stringify(op.data);
  // UTF-8 bytes (TextEncoder is not in every test environment)
  if (unescape(encodeURIComponent(text)).length > MAX_DOC_BYTES)
    throw new PartyOpError("quota_exceeded");
  const data = JSON.parse(text);
  docs[op.path] = data;
  return {
    snapshot: { ...snapshot, docs, version, updated: now },
    change: { kind: "doc", version, path: op.path, data },
  };
}

/**
 * A copy brought up to date by a change from the host; null when a change
 * was missed (the copy is behind), so the whole snapshot is asked for again.
 */
export function receiveChange(snapshot: PartySnapshot, change: PartyChange): PartySnapshot | null {
  if (change.version <= snapshot.version) return snapshot;
  if (change.version !== snapshot.version + 1) return null;
  if (change.kind === "reset")
    return { ...snapshot, docs: {}, version: change.version, updated: Date.now() };
  const docs = { ...snapshot.docs };
  if (change.data == null) delete docs[change.path];
  else docs[change.path] = change.data;
  return { ...snapshot, docs, version: change.version, updated: Date.now() };
}

/** The newest of the copies (by version, then time of the last change) */
export function newestSnapshot(copies: PartySnapshot[]): PartySnapshot {
  return copies.reduce(
    (best, copy) =>
      copy.version > best.version ||
      (copy.version === best.version && copy.updated > best.updated)
        ? copy
        : best,
    emptySnapshot()
  );
}

/** Whether a value received from a peer looks like a snapshot */
export function isSnapshot(value: any): value is PartySnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    value.docs &&
    typeof value.docs === "object" &&
    !Array.isArray(value.docs) &&
    Number.isFinite(value.version) &&
    Number.isFinite(value.updated)
  );
}

/* ---------- this browser's copy (IndexedDB, one record per room) ---------- */

const DB_NAME = "OwlbearPartyData";
const STORE = "rooms";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLocalSnapshot(room: string): Promise<PartySnapshot> {
  try {
    const db = await openDb();
    const value = await new Promise<any>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(room);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return isSnapshot(value) ? value : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

export async function saveLocalSnapshot(room: string, snapshot: PartySnapshot) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot, room);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}
