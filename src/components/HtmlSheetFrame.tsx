import { useEffect, useRef, useState } from "react";
import { Text } from "theme-ui";

import {
  HtmlSheetState,
  SheetMeta,
  getHtmlSheetState,
  getSheetFile,
  putHtmlSheetState,
} from "../helpers/characterSheets";

// Most an HTML sheet may save (its localStorage and field values together)
const MAX_STATE_CHARS = 2 * 1024 * 1024;

/**
 * Runs inside the sheet's page, before its own scripts. The page is
 * sandboxed (no access to the VTT, and no localStorage of its own), so this
 * gives it a localStorage that the VTT keeps for this sheet, and records the
 * values typed into its fields; both come back the next time it opens.
 */
function stateShim(initial: HtmlSheetState) {
  const json = JSON.stringify(initial).replace(/</g, "\\u003c");
  return `<script>(function(){
var init=${json};
var timer=null;
function fieldsOf(){
  var out={},list=document.querySelectorAll("input,textarea,select"),count={};
  for(var i=0;i<list.length;i++){var el=list[i],t=(el.type||"").toLowerCase();
    if(t==="file"||t==="password"||t==="button"||t==="submit"||t==="reset"||t==="hidden")continue;
    var base=el.id?"#"+el.id:(el.name?el.tagName+"["+el.name+"]":el.tagName);
    count[base]=(count[base]||0)+1;var key=base+"@"+count[base];
    out[key]=(t==="checkbox"||t==="radio")?el.checked:el.value;}
  return out;}
function send(){clearTimeout(timer);timer=setTimeout(function(){
  try{parent.postMessage({type:"html-sheet-state",storage:store,fields:fieldsOf()},"*")}catch(e){}},400);}
var store={};for(var k in init.storage)store[k]=String(init.storage[k]);
function storage(map,persist){return{
  getItem:function(k){return Object.prototype.hasOwnProperty.call(map,k)?map[k]:null},
  setItem:function(k,v){map[String(k)]=String(v);if(persist)send()},
  removeItem:function(k){delete map[k];if(persist)send()},
  clear:function(){for(var k in map)delete map[k];if(persist)send()},
  key:function(i){var keys=Object.keys(map);return i<keys.length?keys[i]:null},
  get length(){return Object.keys(map).length}};}
try{Object.defineProperty(window,"localStorage",{value:storage(store,true),configurable:true})}catch(e){}
try{Object.defineProperty(window,"sessionStorage",{value:storage({},false),configurable:true})}catch(e){}
function restore(){var saved=init.fields||{},now=fieldsOf();
  var list=document.querySelectorAll("input,textarea,select"),count={};
  for(var i=0;i<list.length;i++){var el=list[i],t=(el.type||"").toLowerCase();
    if(t==="file"||t==="password"||t==="button"||t==="submit"||t==="reset"||t==="hidden")continue;
    var base=el.id?"#"+el.id:(el.name?el.tagName+"["+el.name+"]":el.tagName);
    count[base]=(count[base]||0)+1;var key=base+"@"+count[base];
    if(!(key in saved)||saved[key]===now[key])continue;
    if(t==="checkbox"||t==="radio")el.checked=!!saved[key];else el.value=saved[key];
    el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));}}
document.addEventListener("input",send,true);
document.addEventListener("change",send,true);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",restore);else restore();
})();</script>`;
}

/** The sheet's text: UTF-8, or the GBK / Big5 its page declares */
function decodeHtml(data: ArrayBuffer) {
  const head = new TextDecoder("latin1").decode(data.slice(0, 2048));
  const charset = head.match(/charset\s*=\s*["']?\s*([\w-]+)/i)?.[1]?.toLowerCase();
  try {
    if (charset && /^(gbk|gb2312|gb18030|big5)$/.test(charset)) return new TextDecoder(charset).decode(data);
  } catch {}
  return new TextDecoder("utf-8").decode(data);
}

/** The shim goes first in <head>, so it is in place before the page's scripts */
function withShim(html: string, shim: string) {
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + shim + html.slice(at);
  }
  return shim + html;
}

/**
 * An HTML character sheet, run as its own page in a sandbox: its scripts
 * and fields work, but it cannot reach the VTT or this site's data. What it
 * saves is kept with the sheet (see stateShim).
 */
function HtmlSheetFrame({ sheet }: { sheet: SheetMeta }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    setError("");
    Promise.all([getSheetFile(sheet.id), getHtmlSheetState(sheet.id)])
      .then(([data, state]) => {
        if (cancelled) return;
        if (!data) return setError("找不到这张角色卡的文件");
        setSrcDoc(withShim(decodeHtml(data), stateShim(state)));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [sheet.id]);

  // What the page saved
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (event.source !== frameRef.current?.contentWindow || !data || data.type !== "html-sheet-state") return;
      const storage: Record<string, string> = {};
      const fields: Record<string, string | boolean> = {};
      for (const [k, v] of Object.entries(data.storage || {})) if (typeof v === "string") storage[k] = v;
      for (const [k, v] of Object.entries(data.fields || {}))
        if (typeof v === "string" || typeof v === "boolean") fields[k] = v;
      const state = { storage, fields };
      if (JSON.stringify(state).length > MAX_STATE_CHARS) return;
      putHtmlSheetState(sheet.id, state).catch(() => {});
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sheet.id]);

  if (error) return <Text sx={{ p: 3 }}>打不开这张角色卡：{error}</Text>;
  if (srcDoc === null) return <Text sx={{ p: 3, color: "gray" }}>正在打开…</Text>;
  return (
    <iframe
      ref={frameRef}
      title={sheet.name}
      srcDoc={srcDoc}
      // No allow-same-origin: the page runs apart from the VTT
      sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "white" }}
    />
  );
}

export default HtmlSheetFrame;
