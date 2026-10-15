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

  window.claude = Object.assign(window.claude || {}, {
    use: function (name) {
      if (name !== "db") return Promise.reject(new Error("unsupported: " + name));
      start();
      return Promise.resolve(db);
    },
  });
})();
