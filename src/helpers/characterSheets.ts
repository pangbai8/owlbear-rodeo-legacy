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

const importExts = [...spreadsheetExts, "csv", ...textExts];

export const importAccept = importExts.map((ext) => `.${ext}`).join(",");

/** Whether a file can be imported as a character sheet, judged by its name */
export function isSheetFile(file: File): boolean {
  return importExts.includes(splitFileName(file.name)[1]);
}

/** MIME types of importable files, for recognising a drag before the drop */
const sheetMimeTypes = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.oasis.opendocument.text",
  "application/rtf",
  "text/rtf",
];

/**
 * Whether every file being dragged looks like a character sheet.
 * Browsers expose only MIME types while dragging, and some leave them empty,
 * so this can say no for a sheet; the drop itself is judged by file name.
 */
export function isSheetDrag(dataTransfer: DataTransfer | null): boolean {
  const items = Array.from(dataTransfer?.items || []).filter(
    (item) => item.kind === "file"
  );
  return (
    items.length > 0 &&
    items.every((item) => sheetMimeTypes.includes(item.type.toLowerCase()))
  );
}

/** localStorage key of the sheet the window shows */
export const CURRENT_SHEET_STORAGE_KEY = "characterSheets.current";

/** Window event asking the character sheet window to show a sheet (detail: id) */
export const OPEN_SHEET_EVENT = "owlbear:open-sheet";

/**
 * Store files as character sheets and ask the sheet window to show the last.
 * The window may not exist yet, so the choice is also left in localStorage.
 */
export async function importSheetFiles(
  files: File[]
): Promise<SheetMeta | undefined> {
  let last: SheetMeta | undefined;
  for (const file of files) {
    const [name, ext] = splitFileName(file.name);
    last = await putSheet({ name, ext }, await file.arrayBuffer());
  }
  if (last) {
    try {
      localStorage.setItem(CURRENT_SHEET_STORAGE_KEY, last.id);
    } catch {}
    window.dispatchEvent(
      new CustomEvent<string>(OPEN_SHEET_EVENT, { detail: last.id })
    );
  }
  return last;
}

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
