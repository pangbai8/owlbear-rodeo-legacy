// Stands in for window.claude.use("db") — the shared store the party status
// panel was written for as a Claude artifact — so that everyone in a game room
// shares one copy of the panel's data through the VTT backend (/party/ws).
// Supports the Firestore-like subset the panel uses: collection(path).onSnapshot
// / get, doc(path).get / set / delete. Without ?room= the panel keeps its data
// in this browser, as before.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var room = params.get("room");
  if (!room) return;
  var broker = params.get("broker") || location.origin;

  // The game password Owlbear keeps for this tab (same origin as the panel)
  var password = "";
  try {
    password = sessionStorage.getItem("auth") || "";
  } catch (e) {}

  var docs = new Map(); // path -> data, as last confirmed by the server
  var listeners = new Set(); // { collection, cb, err, primed }
  var pending = new Map(); // request id -> { msg, resolve, reject }
  var socket = null;
  var ready = false;
  var fatal = null;
  var started = false;
  var nextId = 1;
  var retry = 0;
  var readyWaiters = [];

  function parentOf(path) {
    return path.slice(0, path.lastIndexOf("/"));
  }
  function copy(data) {
    return data == null ? undefined : JSON.parse(JSON.stringify(data));
  }
  function docSnap(path, data) {
    return {
      id: path.slice(path.lastIndexOf("/") + 1),
      exists: data != null,
      data: function () {
        return copy(data);
      },
    };
  }
  function querySnap(collection, changes) {
    var list = [];
    docs.forEach(function (data, path) {
      if (parentOf(path) === collection) list.push(docSnap(path, data));
    });
    return {
      docs: list,
      empty: list.length === 0,
      size: list.length,
      docChanges: function () {
        return changes || list.map(function (doc) {
          return { type: "added", doc: doc };
        });
      },
    };
  }
  function emit(path, before, after) {
    var collection = parentOf(path);
    var type = after == null ? "removed" : before == null ? "added" : "modified";
    listeners.forEach(function (l) {
      if (l.primed && l.collection === collection) l.cb(querySnap(collection, [{ type: type, doc: docSnap(path, after == null ? before : after) }]));
    });
  }
  function applyChange(path, data) {
    var before = docs.get(path);
    if (data == null) {
      if (before === undefined) return;
      docs.delete(path);
    } else {
      if (JSON.stringify(before) === JSON.stringify(data)) return;
      docs.set(path, data);
    }
    emit(path, before, data);
    scheduleLinks();
  }
  /** A full copy from the server (first connect, reconnect, room cleared) */
  function applyAll(next) {
    var paths = new Set(Object.keys(next));
    docs.forEach(function (_, path) {
      paths.add(path);
    });
    paths.forEach(function (path) {
      applyChange(path, next[path] === undefined ? null : next[path]);
    });
    listeners.forEach(prime);
    scheduleLinks();
  }
  function prime(l) {
    if (l.primed || !ready) return;
    l.primed = true;
    l.cb(querySnap(l.collection));
  }
  function whenReady() {
    if (ready) return Promise.resolve();
    if (fatal) return Promise.reject(fatal);
    return new Promise(function (resolve, reject) {
      readyWaiters.push({ resolve: resolve, reject: reject });
    });
  }
  function settleReady(error) {
    var waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach(function (w) {
      error ? w.reject(error) : w.resolve();
    });
  }
  function codeError(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  function showBanner(text) {
    var show = function () {
      var el = document.getElementById("party-shim-banner");
      if (!el) {
        el = document.createElement("div");
        el.id = "party-shim-banner";
        el.style.cssText =
          "position:fixed;left:0;right:0;top:0;z-index:99999;padding:8px 12px;background:#7a2730;color:#fff;font:14px/1.4 system-ui,sans-serif;text-align:center";
        document.body.appendChild(el);
      }
      el.textContent = text;
      el.hidden = !text;
    };
    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show);
  }

  function connect() {
    var url = broker.replace(/^http/, "ws") + "/party/ws?room=" + encodeURIComponent(room);
    var ws = new WebSocket(url);
    socket = ws;
    ws.onopen = function () {
      ws.send(JSON.stringify({ op: "auth", password: password }));
    };
    ws.onmessage = function (event) {
      var m;
      try {
        m = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (m.t === "ready") {
        retry = 0;
        ready = true;
        showBanner("");
        applyAll(m.docs || {});
        settleReady();
        // Anything not yet confirmed is sent again (set/delete are idempotent)
        pending.forEach(function (p) {
          ws.send(JSON.stringify(p.msg));
        });
      } else if (m.t === "change") {
        applyChange(m.path, m.data);
      } else if (m.t === "reset") {
        applyAll({});
      } else if (m.t === "ack") {
        var p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        m.code ? p.reject(codeError(m.code)) : p.resolve();
      } else if (m.t === "error" && m.code === "permission_denied") {
        fatal = codeError("permission_denied");
        showBanner("无法读取这个房间的小队数据：请先用正确的密码进入游戏，再打开小队面板。");
        settleReady(fatal);
        listeners.forEach(function (l) {
          if (l.err) l.err(fatal);
        });
        pending.forEach(function (p) {
          p.reject(fatal);
        });
        pending.clear();
      }
    };
    ws.onclose = function () {
      if (socket !== ws) return;
      socket = null;
      ready = false;
      if (fatal) return;
      showBanner(retry > 1 ? "与房间的连接中断，正在重连…" : "");
      setTimeout(connect, Math.min(15000, 500 * Math.pow(2, retry++)));
    };
  }

  function start() {
    if (started) return;
    started = true;
    connect();
  }

  function request(msg) {
    if (fatal) return Promise.reject(fatal);
    msg.id = nextId++;
    return new Promise(function (resolve, reject) {
      pending.set(msg.id, { msg: msg, resolve: resolve, reject: reject });
      if (ready && socket) socket.send(JSON.stringify(msg));
    });
  }

  var db = {
    collection: function (path) {
      return {
        onSnapshot: function (cb, err) {
          var l = { collection: path, cb: cb, err: err, primed: false };
          listeners.add(l);
          // Like Firestore: the first snapshot arrives asynchronously
          Promise.resolve().then(function () {
            if (fatal) {
              if (err) err(fatal);
            } else prime(l);
          });
          return function () {
            listeners.delete(l);
          };
        },
        get: function () {
          return whenReady().then(function () {
            return querySnap(path);
          });
        },
      };
    },
    doc: function (path) {
      return {
        get: function () {
          return whenReady().then(function () {
            return docSnap(path, docs.get(path));
          });
        },
        set: function (data) {
          return request({ op: "set", path: path, data: copy(data) });
        },
        delete: function () {
          return request({ op: "delete", path: path });
        },
      };
    },
  };

  // The VTT's window menu: "清空本房间的小队数据"
  window.addEventListener("message", function (event) {
    if (event.origin !== location.origin || !event.data || event.data.type !== "party-panel-clear") return;
    request({ op: "clear" }).catch(function () {});
  });

  /* ---------- monsters dragged from the VTT's 5e quick search ---------- */

  var MONSTER_TYPE = "application/x-owlbear-monster";
  var TEAM_KEY = "dnd-active-team"; // the panel's own "current team" key
  var monsterRequests = new Map();
  var nextMonsterRequest = 1;

  function isMonsterDrag(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return !!types && Array.prototype.indexOf.call(types, MONSTER_TYPE) >= 0;
  }

  function notice(text, isError) {
    var el = document.getElementById("party-shim-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "party-shim-notice";
      el.style.cssText =
        "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;padding:8px 14px;border-radius:8px;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4)";
      document.body.appendChild(el);
    }
    el.style.background = isError ? "#7a2730" : "#2f6b45";
    el.textContent = text;
    el.hidden = false;
    clearTimeout(notice.timer);
    notice.timer = setTimeout(function () {
      el.hidden = true;
    }, 3000);
  }

  function dropHint(show) {
    var el = document.getElementById("party-shim-drop");
    if (!el && show) {
      el = document.createElement("div");
      el.id = "party-shim-drop";
      el.textContent = "放下即可加入当前小队（作为 NPC）";
      el.style.cssText =
        "position:fixed;inset:6px;z-index:99998;display:flex;align-items:center;justify-content:center;border:2px dashed #c9b6ff;border-radius:12px;background:rgba(20,18,30,.75);color:#e9e2ff;font:16px system-ui,sans-serif;pointer-events:none";
      document.body.appendChild(el);
    }
    if (el) el.hidden = !show;
  }

  /** The VTT page looks the monster up (one shared loader) and answers */
  function askVtt(ref) {
    var target = window.parent !== window ? window.parent : window.opener;
    if (!target) return Promise.reject(new Error("请在 VTT 里打开小队面板"));
    var id = nextMonsterRequest++;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        monsterRequests.delete(id);
        reject(new Error("读取怪物数据超时"));
      }, 20000);
      monsterRequests.set(id, function (data) {
        clearTimeout(timer);
        data.error ? reject(new Error(data.error)) : resolve(data.stats);
      });
      target.postMessage({ type: "party-panel-monster", id: id, ref: ref }, location.origin);
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== location.origin || !data || data.type !== "party-panel-monster-result") return;
    var done = monsterRequests.get(data.id);
    if (done) {
      monsterRequests.delete(data.id);
      done(data);
    }
  });

  /** The team the panel shows: its saved choice if it exists here, else the oldest */
  function currentTeam() {
    var saved = null;
    try {
      saved = localStorage.getItem(TEAM_KEY);
    } catch (e) {}
    if (saved && docs.has("teams/" + saved)) return saved;
    var teams = [];
    docs.forEach(function (data, path) {
      var m = path.match(/^teams\/([^/]+)$/);
      if (m) teams.push({ id: m[1], created: (data && data.created) || 0 });
    });
    teams.sort(function (a, b) {
      return a.created - b.created;
    });
    return teams.length ? teams[0].id : saved || "main";
  }

  function uniqueName(team, name) {
    var taken = new Set();
    docs.forEach(function (data, path) {
      if (path.indexOf("teams/" + team + "/members/") === 0 && data) taken.add(data.name);
    });
    if (!taken.has(name)) return name;
    for (var n = 2; ; n++) if (!taken.has(name + " " + n)) return name + " " + n;
  }

  function addMonster(stats, link) {
    var team = currentTeam();
    var writes = [];
    if (!docs.has("teams/" + team)) {
      writes.push(
        db.doc("teams/" + team).set({
          name: "我的小队",
          created: Date.now(),
          meta: { round: 0, turn: null, sortInit: true, spellSystem: "slots", multiConc: false },
        })
      );
    }
    var name = uniqueName(team, stats.name);
    var hp = stats.hp && stats.hp > 0 ? stats.hp : 10;
    // Same shape as the panel's "+ NPC"; the panel fills in the rest
    var npc = {
      name: name,
      clsLabel: "NPC",
      cls: "",
      level: 1,
      hp: hp,
      maxHp: hp,
      temp: 0,
      ac: stats.ac != null ? stats.ac : 10,
      init: 0,
      initBonus: stats.initBonus || 0,
      initPending: true,
      initManual: false,
      created: Date.now(),
      // Its stat card can be opened again from the 📖 button on the card
      monster: { name: stats.name, englishName: stats.englishName, source: stats.source, url: stats.url },
    };
    if (stats.system === "pf2") npc.monster.system = "pf2";
    // Dropped on the map: the token it stands for (HP and turn show on it)
    if (link && typeof link.tokenStateId === "string") {
      npc.token = { id: link.tokenStateId, map: String(link.mapId || "") };
    }
    var id = "c" + Math.random().toString(36).slice(2, 10);
    writes.push(db.doc("teams/" + team + "/members/" + id).set(npc));
    return Promise.all(writes).then(function () {
      return name;
    });
  }

  /* ---------- auto-add monsters dropped on the VTT map ---------- */

  // Read by the VTT on a map drop (same origin), so it is per browser: only
  // the GM who turns it on adds the monsters they drop
  var AUTO_KEY = "partyPanel.autoAddMapMonsters";

  function autoAddOn() {
    try {
      return localStorage.getItem(AUTO_KEY) === "true";
    } catch (e) {
      return false;
    }
  }

  function setupAutoButton() {
    var button = document.getElementById("autoMapBtn");
    if (!button) return;
    // Only inside the VTT (the iframe or its pop-out), where the map is
    button.hidden = window.parent === window && !window.opener;
    var sync = function () {
      var on = autoAddOn();
      button.setAttribute("aria-pressed", String(on));
      button.textContent = on ? "地图怪物入队：开" : "地图怪物入队：关";
    };
    sync();
    button.addEventListener("click", function () {
      try {
        localStorage.setItem(AUTO_KEY, String(!autoAddOn()));
      } catch (e) {}
      sync();
      notice(autoAddOn() ? "已打开：拖到地图上的怪物会自动加入小队" : "已关闭地图怪物自动入队");
    });
    // The iframe and the pop-out show the same switch
    window.addEventListener("storage", function (event) {
      if (event.key === AUTO_KEY) sync();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setupAutoButton);
  else setupAutoButton();

  // The VTT sends the stats of a monster just dropped on the map
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== location.origin || !data || data.type !== "party-panel-add-monster" || !event.source) return;
    var reply = function (payload) {
      payload.type = "party-panel-add-monster-result";
      payload.id = data.id;
      event.source.postMessage(payload, location.origin);
    };
    if (fatal) return reply({ error: "无法连接房间的小队数据" });
    whenReady()
      .then(function () {
        return addMonster(data.stats, data.link);
      })
      .then(function (name) {
        reply({ name: name });
      })
      .catch(function (error) {
        reply({ error: error && error.message ? error.message : String(error) });
      });
  });

  /* ---------- NPCs linked to map tokens ---------- */

  function vttWindow() {
    return window.parent !== window ? window.parent : window.opener;
  }

  // HP and whose turn it is, for every NPC with a token: the VTT marks them
  var linksTimer = null;
  function scheduleLinks() {
    clearTimeout(linksTimer);
    linksTimer = setTimeout(postLinks, 150);
  }
  function postLinks() {
    var target = vttWindow();
    if (!target || !ready) return;
    var turns = {};
    docs.forEach(function (data, path) {
      var m = path.match(/^teams\/([^/]+)$/);
      if (m && data && data.meta && data.meta.round > 0 && data.meta.turn) turns[m[1]] = data.meta.turn;
    });
    var links = [];
    docs.forEach(function (data, path) {
      var m = path.match(/^teams\/([^/]+)\/members\/([^/]+)$/);
      if (!m || !data || !data.token || typeof data.token.id !== "string") return;
      links.push({
        tokenStateId: data.token.id,
        mapId: String(data.token.map || ""),
        name: String(data.name || ""),
        hp: Number(data.hp) || 0,
        maxHp: Math.max(1, Number(data.maxHp) || 1),
        turn: turns[m[1]] === m[2],
        // Their conditions show (and are edited) on the token too
        pf2: !!(data.monster && data.monster.system === "pf2"),
        conds: tokenConds(data),
      });
    });
    try {
      target.postMessage({ type: "party-panel-links", links: links }, location.origin);
    } catch (e) {}
  }
  window.addEventListener("message", function (event) {
    if (event.origin === location.origin && event.data && event.data.type === "party-panel-links-request") postLinks();
  });

  // An NPC's conditions as the token shows them: its conditions, and for a
  // 5e NPC its exhaustion level as "力竭 N" (the panel keeps it apart)
  function tokenConds(member) {
    var conds = Array.isArray(member.conds)
      ? member.conds.filter(function (c) { return typeof c === "string"; })
      : [];
    var pf2 = member.monster && member.monster.system === "pf2";
    var exh = Number(member.exh) || 0;
    return !pf2 && exh > 0 ? conds.concat("力竭 " + exh) : conds;
  }

  // Conditions changed on a token: the VTT updates its linked NPC
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.origin !== location.origin || !data || data.type !== "party-panel-set-conds" || !ready) return;
    if (typeof data.tokenStateId !== "string" || !Array.isArray(data.conds)) return;
    var conds = data.conds.filter(function (c) { return typeof c === "string"; }).slice(0, 40);
    docs.forEach(function (doc, path) {
      if (!/^teams\/[^/]+\/members\/[^/]+$/.test(path) || !doc || !doc.token || doc.token.id !== data.tokenStateId) return;
      if (JSON.stringify(tokenConds(doc)) === JSON.stringify(conds)) return;
      var next = copy(doc);
      if (doc.monster && doc.monster.system === "pf2") {
        next.conds = conds;
      } else {
        // 5e: "力竭 N" back to the exhaustion level
        var exh = 0;
        next.conds = conds.filter(function (c) {
          var m = c.match(/^力竭\s*(\d+)$/);
          if (m) exh = Math.min(6, Number(m[1]));
          return !m;
        });
        next.exh = exh;
      }
      db.doc(path).set(next).catch(function () {});
    });
  });

  // 📍 on a linked NPC: the map scrolls to its token
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest('[data-act="locate"]');
    if (!button) return;
    var target = vttWindow();
    if (target) target.postMessage({ type: "party-panel-locate", tokenStateId: button.dataset.token }, location.origin);
  });

  /* ---------- 5e / PF2 mode (the VTT's book and PF2 buttons) ---------- */

  var FIVE_E_KEY = "quickSearch.visible";
  var RULES_KEY = "ruleSystem";
  function fiveEMode() {
    try {
      return localStorage.getItem(FIVE_E_KEY) === "true";
    } catch (e) {
      return false;
    }
  }
  function ruleSystem() {
    try {
      var value = localStorage.getItem(RULES_KEY);
      return value === "pf2" || value === "4e" ? value : "5e";
    } catch (e) {
      return "5e";
    }
  }
  // body.fiveE: lookups on (either rules); data-rules: which rules
  function syncFiveEMode() {
    if (!document.body) return;
    document.body.classList.toggle("fiveE", fiveEMode() && !!vttWindow());
    document.body.setAttribute("data-rules", ruleSystem());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncFiveEMode);
  else syncFiveEMode();
  window.addEventListener("storage", function (event) {
    if (event.key === FIVE_E_KEY || event.key === RULES_KEY) syncFiveEMode();
  });

  // Condition and concentration chips open their 5e card in the VTT
  document.addEventListener("click", function (event) {
    if (!document.body.classList.contains("fiveE")) return;
    if (event.target.closest && event.target.closest("[data-act]")) return;
    var chip = event.target.closest && event.target.closest("[data-lookup]");
    if (!chip) return;
    var value = chip.getAttribute("data-lookup");
    var colon = value.indexOf(":");
    var target = vttWindow();
    if (colon < 0 || !target) return;
    target.postMessage(
      { type: "party-panel-lookup", kind: value.slice(0, colon), name: value.slice(colon + 1) },
      location.origin
    );
  });

  // 📖 on an NPC card from the quick search: the VTT shows its stat card
  document.addEventListener("click", function (event) {
    var button = event.target.closest && event.target.closest('[data-act="monster"]');
    if (!button) return;
    var target = window.parent !== window ? window.parent : window.opener;
    if (!target) return notice("请在 VTT 里打开小队面板查看怪物资料", true);
    try {
      var ref = JSON.parse(button.dataset.monster);
      target.postMessage({ type: "party-panel-open-monster", ref: ref }, location.origin);
      if (target === window.opener) notice("已在 VTT 窗口打开「" + ref.name + "」的资料");
    } catch (e) {}
  });

  document.addEventListener("dragenter", function (event) {
    if (!isMonsterDrag(event)) return;
    event.preventDefault();
    dropHint(true);
  });
  document.addEventListener("dragover", function (event) {
    if (!isMonsterDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    dropHint(true);
  });
  document.addEventListener("dragleave", function (event) {
    if (!event.relatedTarget) dropHint(false);
  });
  document.addEventListener("drop", function (event) {
    if (!isMonsterDrag(event)) return;
    event.preventDefault();
    dropHint(false);
    var ref;
    try {
      ref = JSON.parse(event.dataTransfer.getData(MONSTER_TYPE));
    } catch (e) {
      return;
    }
    if (fatal) return notice("无法连接房间的小队数据", true);
    notice("正在读取「" + ref.name + "」…");
    askVtt(ref)
      .then(addMonster)
      .then(function (name) {
        notice("已把「" + name + "」加入小队");
      })
      .catch(function (error) {
        notice("添加失败：" + (error && error.message ? error.message : error), true);
      });
  });

  window.claude = Object.assign(window.claude || {}, {
    use: function (name) {
      if (name !== "db") return Promise.reject(new Error("unsupported: " + name));
      start();
      return Promise.resolve(db);
    },
  });
})();
