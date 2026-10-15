import { v4 as uuid } from "uuid";

/**
 * Character sheets live only in this browser, in their own IndexedDB database
 * so they never touch the versioned Owlbear schema.
 * Metadata and file bytes are separate stores so listing does not load files.
 */
const DB_NAME = "OwlbearCharacterSheets";
const META_STORE = "sheets";
const FILE_STORE = "files";

export type SheetMeta = {
  id: string;
  /** File name without extension */
  name: string;
  /** Lower case extension of the stored bytes, e.g. "xlsx" */
  ext: string;
  size: number;
  updatedAt: number;
};

let dbPromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(META_STORE, { keyPath: "id" });
        request.result.createObjectStore(FILE_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Allow a later retry if opening failed (e.g. private browsing)
    dbPromise.catch(() => {
      dbPromise = undefined;
    });
  }
  return dbPromise;
}

async function run<T>(
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => IDBRequest<T> | void
): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const request = body(tx);
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listSheets(): Promise<SheetMeta[]> {
  const sheets =
    (await run<SheetMeta[]>([META_STORE], "readonly", (tx) =>
      tx.objectStore(META_STORE).getAll()
    )) || [];
  return sheets.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSheetFile(
  id: string
): Promise<ArrayBuffer | undefined> {
  return run<ArrayBuffer>([FILE_STORE], "readonly", (tx) =>
    tx.objectStore(FILE_STORE).get(id)
  );
}

export async function putSheet(
  meta: Omit<SheetMeta, "id" | "size" | "updatedAt"> & { id?: string },
  data: ArrayBuffer
): Promise<SheetMeta> {
  const sheet: SheetMeta = {
    id: meta.id || uuid(),
    name: meta.name,
    ext: meta.ext,
    size: data.byteLength,
    updatedAt: Date.now(),
  };
  await run([META_STORE, FILE_STORE], "readwrite", (tx) => {
    tx.objectStore(META_STORE).put(sheet);
    tx.objectStore(FILE_STORE).put(data, sheet.id);
  });
  return sheet;
}

export async function deleteSheet(id: string): Promise<void> {
  await run([META_STORE, FILE_STORE], "readwrite", (tx) => {
    tx.objectStore(META_STORE).delete(id);
    tx.objectStore(FILE_STORE).delete(id);
  });
}

/** Split "Hero lv4.xlsm" into ["Hero lv4", "xlsm"] */
export function splitFileName(fileName: string): [string, string] {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return [fileName, ""];
  }
  return [fileName.slice(0, dot), fileName.slice(dot + 1).toLowerCase()];
}

const spreadsheetExts = ["xlsx", "xlsm", "xls", "ods"];
const textExts = ["docx", "doc", "odt", "rtf", "txt"];

export const importAccept = [...spreadsheetExts, "csv", ...textExts]
  .map((ext) => `.${ext}`)
  .join(",");

/**
 * Extension to tell the editor when opening. Its converter has no entry for
 * .xlsm but reads macro-enabled workbooks fine when given as .xlsx
 * (the macros are not kept).
 */
export function editorOpenExt(ext: string): string {
  return ext === "xlsm" ? "xlsx" : ext;
}

/** Format edits are saved in, which is also the stored extension afterwards */
export function editorSaveExt(ext: string): string {
  if (spreadsheetExts.includes(ext)) {
    return "xlsx";
  }
  if (textExts.includes(ext)) {
    return "docx";
  }
  return ext;
}
