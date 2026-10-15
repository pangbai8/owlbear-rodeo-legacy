// Character settings panel: list, edit form (name, display name + tag, avatar,
// brackets as prefix [text] suffix, keep brackets) and Tupperbox import.
import { MAX_BRACKET_PAIRS, characterDisplayName, matchProxy, normalizeCharacter } from "./proxy.js";

const MAX_AVATAR_BYTES = 1024 * 1024;
const AVATAR_SIZE = 512;

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-") || key.startsWith("aria-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

export function bracketLabel(prefix, suffix) {
  return `${prefix}text${suffix}`;
}

/** Shrinks an image to at most 512px (keeps GIFs as they are) */
async function prepareAvatar(file) {
  if (file.type === "image/gif") {
    if (file.size > MAX_AVATAR_BYTES) throw new Error("GIF 头像不能超过 1MB");
    return file;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, AVATAR_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.9, 0.75, 0.6]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (blob && blob.type === "image/webp" && blob.size <= MAX_AVATAR_BYTES) return blob;
  }
  const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (png.size > MAX_AVATAR_BYTES) throw new Error("图片太大了，换一张小一点的");
  return png;
}

/**
 * @param {{ api: Function, getMe: () => {name: string, avatar: string}, onChange: (characters) => void }} options
 */
export function createCharacterPanel({ api, getMe, onChange }) {
  const panel = $("characters");
  const list = $("character-list");
  const form = $("character-form");
  const bracketRows = $("bracket-rows");
  const status = $("character-status");
  let characters = [];
  let editingId = null; // null = new

  function setStatus(text, isError = false) {
    status.textContent = text;
    status.className = isError ? "error" : "hint";
    status.hidden = !text;
  }

  function changed(next) {
    characters = next;
    renderList();
    onChange(characters);
  }

  async function load() {
    const data = await api("/api/characters");
    changed(data.characters);
    return characters;
  }

  function renderList() {
    list.replaceChildren(
      ...(characters.length
        ? characters.map((c) =>
            el("li", { class: "character-item" }, [
              el("img", { class: "avatar", src: c.avatarUrl || getMe().avatar, alt: "" }),
              el("div", { class: "character-text" }, [
                el("div", { class: "character-name", text: characterDisplayName(c) }),
                el("div", {
                  class: "character-brackets",
                  text: c.brackets.length
                    ? Array.from({ length: c.brackets.length / 2 }, (_, i) => bracketLabel(c.brackets[i * 2], c.brackets[i * 2 + 1])).join("  ")
                    : "（没有括号，只能从下拉框选择）",
                }),
              ]),
              el("button", { type: "button", class: "ghost", "data-edit": c.id, text: "编辑" }),
            ]),
          )
        : [el("li", { class: "hint empty", text: "还没有角色。新建一个，或者导入 Tupperbox 的 tul!export 文件。" })]),
    );
  }

  // ---- form ----

  function addBracketRow(prefix = "", suffix = "") {
    if (bracketRows.children.length >= MAX_BRACKET_PAIRS) return;
    const row = el("div", { class: "bracket-row" }, [
      el("input", { class: "bracket-prefix", value: prefix, placeholder: "前缀，如 n:", maxLength: 50, "aria-label": "前缀" }),
      el("span", { class: "bracket-text", text: "text" }),
      el("input", { class: "bracket-suffix", value: suffix, placeholder: "后缀", maxLength: 50, "aria-label": "后缀" }),
      el("button", { type: "button", class: "ghost remove-bracket", title: "删除这组括号", text: "×" }),
    ]);
    bracketRows.append(row);
    updatePreview();
  }

  function readForm() {
    const brackets = [];
    for (const row of bracketRows.children) brackets.push(row.querySelector(".bracket-prefix").value, row.querySelector(".bracket-suffix").value);
    return {
      name: $("character-name").value,
      nick: $("character-nick").value,
      tag: $("character-tag").value,
      avatarUrl: $("character-avatar-url").value,
      brackets,
      showBrackets: $("character-show-brackets").checked,
    };
  }

  function updatePreview() {
    const data = readForm();
    const avatar = data.avatarUrl.trim() || getMe().avatar;
    $("character-avatar-preview").src = avatar;
    const name = characterDisplayName({ ...data, name: data.name.trim() || "（未命名）" });
    $("character-heading").textContent = name;
    const pair = data.brackets.findIndex((_, i) => i % 2 === 0 && (data.brackets[i].trim() || data.brackets[i + 1].trim()));
    const sample = pair >= 0 ? `${data.brackets[pair]}你好${data.brackets[pair + 1]}` : "";
    const match = sample ? matchProxy(sample, [{ ...data, name: data.name || "?" }]) : null;
    $("character-preview").textContent = match
      ? `输入「${sample}」会以「${name}」发送：${match.content}`
      : "没有括号时，只能在输入框左边的下拉框里选这个角色。";
  }

  function openForm(character) {
    editingId = character?.id || null;
    $("character-name").value = character?.name || "";
    $("character-nick").value = character?.nick || "";
    $("character-tag").value = character?.tag || "";
    $("character-avatar-url").value = character?.avatarUrl || "";
    $("character-show-brackets").checked = !!character?.showBrackets;
    bracketRows.replaceChildren();
    const brackets = character?.brackets?.length ? character.brackets : ["", ""];
    for (let i = 0; i < brackets.length; i += 2) addBracketRow(brackets[i], brackets[i + 1]);
    $("character-delete").hidden = !editingId;
    list.hidden = true;
    $("character-actions").hidden = true;
    form.hidden = false;
    setStatus("");
    updatePreview();
    $("character-name").focus();
  }

  function closeForm() {
    form.hidden = true;
    list.hidden = false;
    $("character-actions").hidden = false;
    editingId = null;
  }

  async function save(event) {
    event.preventDefault();
    let character;
    try {
      character = normalizeCharacter(readForm());
    } catch (e) {
      return setStatus(e.message, true);
    }
    try {
      const path = editingId ? `/api/characters/${editingId}` : "/api/characters";
      await api(path, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(character),
      });
      await load();
      closeForm();
      setStatus("已保存。");
    } catch (e) {
      setStatus(`保存失败：${e.message}`, true);
    }
  }

  async function remove() {
    if (!editingId || !confirm(`删除角色「${$("character-name").value}」？已经发出的消息不受影响。`)) return;
    try {
      await api(`/api/characters/${editingId}`, { method: "DELETE" });
      await load();
      closeForm();
      setStatus("已删除。");
    } catch (e) {
      setStatus(`删除失败：${e.message}`, true);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    setStatus("正在上传头像…");
    try {
      const blob = await prepareAvatar(file);
      const data = await api("/api/avatars", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      $("character-avatar-url").value = data.url;
      updatePreview();
      setStatus("头像已上传，记得保存。");
    } catch (e) {
      setStatus(`上传失败：${e.message}`, true);
    }
  }

  async function importFile(file) {
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return setStatus("文件不是有效的 JSON", true);
    }
    try {
      const result = await api("/api/characters/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      changed(result.characters);
      setStatus(`导入完成：新增 ${result.added} 个，更新 ${result.updated} 个${result.skipped ? `，超出上限跳过 ${result.skipped} 个` : ""}。`);
    } catch (e) {
      setStatus(`导入失败：${e.message}`, true);
    }
  }

  // ---- wiring ----

  list.addEventListener("click", (event) => {
    const id = event.target.dataset.edit;
    if (id) openForm(characters.find((c) => c.id === id));
  });
  $("character-new").addEventListener("click", () => openForm(null));
  $("character-cancel").addEventListener("click", closeForm);
  $("character-delete").addEventListener("click", remove);
  $("character-add-bracket").addEventListener("click", () => addBracketRow());
  bracketRows.addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-bracket")) return;
    event.target.closest(".bracket-row").remove();
    if (!bracketRows.children.length) addBracketRow();
    updatePreview();
  });
  form.addEventListener("input", updatePreview);
  form.addEventListener("submit", save);
  $("character-avatar-file").addEventListener("change", (event) => {
    uploadAvatar(event.target.files[0]);
    event.target.value = "";
  });
  $("character-import-file").addEventListener("change", (event) => {
    importFile(event.target.files[0]);
    event.target.value = "";
  });
  $("characters-close").addEventListener("click", () => close());

  function open() {
    closeForm();
    setStatus("");
    panel.hidden = false;
  }

  function close() {
    panel.hidden = true;
  }

  return { load, open, close, get characters() {
    return characters;
  } };
}
