/* SR Video Lab — vanilla file:// app. Chrome only. Videos never copied. */
(function () {
  "use strict";

  var LS_KEY = "sr-video-lab-db";
  var FRAME_DT = 1 / 24;
  var DRIFT = 0.08;
  var SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  var ZOOM_MIN = 1;
  var ZOOM_MAX = 16;
  var ZOOM_STEP = 1.25;
  var WHEEL_STEP = 1.12;
  var RES_TOKENS = ["240p", "360p", "480p", "720p", "1080p", "1440p", "4k", "2160p", "8k"];
  var RES_RANK = {
    "240p": 0, "360p": 1, "480p": 2, "720p": 3, "1080p": 4,
    "1440p": 5, "4k": 6, "2160p": 6, "8k": 7
  };
  var UNCAT_COLOR = "#94a3b8";
  var PALETTE = ["#7c9cff", "#5eead4", "#f0abfc", "#e8a838", "#f07178", "#86c98a", "#94a3b8", "#fb923c", "#38bdf8", "#a78bfa"];

  var DEFAULT_DB = {
    categories: [
      { id: "a", name: "Animations", color: "#7c9cff" },
      { id: "s", name: "Sport", color: "#5eead4" },
      { id: "c", name: "Cinema", color: "#f0abfc" }
    ],
    groups: [
      {
        id: "a-big-buck-bunny",
        title: "Big Buck Bunny",
        categoryId: "a",
        license: "CC-BY 3.0 — Blender Foundation",
        notes: "Classic open movie. Compare 360p/720p originals against VSR and RealESRGAN upscales.",
        order: 0,
        variants: {
          "360p": { file: "a-big-buck-bunny-360p.mp4", path: "clips/a-big-buck-bunny-360p.mp4", resolution: "360p", fps: 60, tech: "" },
          "720p": { file: "a-big-buck-bunny-720p.mp4", path: "clips/a-big-buck-bunny-720p.mp4", resolution: "720p", fps: 60, tech: "" },
          "720p-24fps": { file: "a-big-buck-bunny-720p-24fps.mp4", path: "clips/a-big-buck-bunny-720p-24fps.mp4", resolution: "720p", fps: 24, tech: "" },
          "720p-VSR": { file: "a-big-buck-bunny-720p-VSR.mp4", path: "clips/a-big-buck-bunny-720p-VSR.mp4", resolution: "720p", fps: 60, tech: "VSR" },
          "720p-RealESRGAN": { file: "a-big-buck-bunny-720p-RealESRGAN.mp4", path: "clips/a-big-buck-bunny-720p-RealESRGAN.mp4", resolution: "720p", fps: 60, tech: "RealESRGAN" },
          "4k": { file: "a-big-buck-bunny-4k.mp4", path: "clips/a-big-buck-bunny-4k.mp4", resolution: "4k", fps: 60, tech: "" }
        }
      },
      {
        id: "s-goal-slowmo",
        title: "Goal Slowmo",
        categoryId: "s",
        license: "",
        notes: "Sport slow-motion clip.",
        order: 1,
        variants: {
          "1080p": { file: "s-goal-slowmo-1080p.mp4", path: "clips/s-goal-slowmo-1080p.mp4", resolution: "1080p", fps: 60, tech: "" }
        }
      },
      {
        id: "c-night-street",
        title: "Night Street",
        categoryId: "c",
        license: "",
        notes: "Low-light cinema street. Topaz upscale vs original 1080p.",
        order: 2,
        variants: {
          "1080p-Topaz": { file: "c-night-street-1080p-Topaz.mp4", path: "clips/c-night-street-1080p-Topaz.mp4", resolution: "1080p", fps: 60, tech: "Topaz" }
        }
      }
    ],
    settings: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  var videoA, videoB, videoC, videoD, paneA, paneB, paneC, paneD;
  var missingA, missingB, missingC, missingD, labelA, labelB, labelC, labelD;
  var picture, stage, placeholder, placeholderBody, wipeDivider;
  var seek, timeLabel, btnPlay, btnMute, saveStatus;
  var libraryList, catChips, dropOverlay;

  var fileMap = new Map();
  var fileByName = new Map();
  var urlMap = new Map();
  var handleMap = new Map();
  var rootDirHandle = null;

  var state = {
    db: null,
    selectedId: null,
    catFilter: "all",
    search: "",
    mode: "single",
    compareCount: 2,
    keyA: null,
    keyB: null,
    keyC: null,
    keyD: null,
    rate: 1,
    wipe: 50,
    wipeAxis: "v",
    muted: false,
    hasFolder: false,
    draggingId: null,
    wiping: false,
    canWrite: false,
    zoom: 1,
    panX: 0,
    panY: 0,
    sbsSolo: null
  };

  var lastExportJson = "";
  var saveTimer = 0;
  var flashTimer = 0;
  var seeking = false;
  var syncing = false;
  var booted = false;
  var panDrag = { on: false, pointerId: 0, sx: 0, sy: 0, ox: 0, oy: 0 };
  var lastPick = {
    mode: "single",
    compareCount: 2,
    wipeAxis: "v",
    fps: null,
    resA: null,
    techA: null,
    resB: null,
    techB: null,
    resC: null,
    techC: null,
    resD: null,
    techD: null
  };

  function isCompare() {
    return state.mode !== "single";
  }

  function isQuad() {
    return isCompare() && state.mode !== "wipe" && state.compareCount === 4;
  }

  function sbsSoloOrder() {
    return isQuad() ? ["A", "B", "C", "D"] : ["A", "B"];
  }

  function isSbsSolo() {
    return state.mode === "sbs" && !!state.sbsSolo;
  }

  function setSbsSolo(slot) {
    if (state.mode !== "sbs") return;
    if (slot && sbsSoloOrder().indexOf(slot) === -1) slot = null;
    state.sbsSolo = slot || null;
    applyPaneVisibility();
    applyZoom();
  }

  function toggleSbsSolo(slot) {
    if (state.mode !== "sbs") return;
    if (sbsSoloOrder().indexOf(slot) === -1) return;
    setSbsSolo(state.sbsSolo === slot ? null : slot);
  }

  function cycleSbsSolo(dir) {
    if (state.mode !== "sbs") return;
    var order = [null].concat(sbsSoloOrder());
    var cur = state.sbsSolo || null;
    var i = 0;
    for (; i < order.length; i++) if (order[i] === cur) break;
    if (i >= order.length) i = 0;
    var next = order[(i + dir + order.length) % order.length];
    setSbsSolo(next);
  }

  function forEachCompareVideo(fn) {
    if (!isCompare()) return;
    if (videoB) fn(videoB);
    if (isQuad()) {
      if (videoC) fn(videoC);
      if (videoD) fn(videoD);
    }
  }

  function keyForSlot(slot) {
    if (slot === "B") return state.keyB;
    if (slot === "C") return state.keyC;
    if (slot === "D") return state.keyD;
    return state.keyA;
  }

  function setKeyForSlot(slot, key) {
    if (slot === "B") state.keyB = key;
    else if (slot === "C") state.keyC = key;
    else if (slot === "D") state.keyD = key;
    else state.keyA = key;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function titleCaseSlug(slug) {
    return String(slug || "")
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); })
      .join(" ");
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function debounce(fn, ms) {
    var t = 0;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  function rankRes(res) {
    var k = String(res || "").toLowerCase();
    return RES_RANK[k] != null ? RES_RANK[k] : -1;
  }

  function sameRank(a, b) {
    return rankRes(a) === rankRes(b) && rankRes(a) >= 0;
  }

  function catById(id) {
    if (!id) return { id: "", name: "Uncategorized", color: UNCAT_COLOR };
    var list = (state.db && state.db.categories) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { id: id, name: id, color: UNCAT_COLOR };
  }

  function currentGroup() {
    if (!state.selectedId || !state.db) return null;
    var g = state.db.groups;
    for (var i = 0; i < g.length; i++) if (g[i].id === state.selectedId) return g[i];
    return null;
  }

  function parseFpsToken(tok) {
    var m = String(tok || "").toLowerCase().match(/^(\d+(?:\.\d+)?)fps$/);
    if (!m) return null;
    var n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 240) return null;
    return n;
  }

  function normFps(v) {
    if (v && v.fps != null && v.fps !== "") {
      var n = Number(v.fps);
      if (Number.isFinite(n) && n > 0) return n;
    }
    var name = (v && (v.file || v.path)) || "";
    var parts = String(name).split(/[/\\]/).pop().replace(/\.[^.]+$/, "").split("-");
    var i;
    for (i = 0; i < parts.length; i++) {
      var f = parseFpsToken(parts[i]);
      if (f != null) return f;
    }
    return 60;
  }

  function formatFps(n) {
    if (!Number.isFinite(n)) n = 60;
    if (Math.abs(n - Math.round(n)) < 1e-6) return Math.round(n) + "fps";
    return String(n) + "fps";
  }

  function fpsKeyTag(n) {
    n = Number(n);
    if (!Number.isFinite(n) || Math.abs(n - 60) < 1e-6) return "";
    return formatFps(n);
  }

  function makeVariantKey(resolution, fps, tech) {
    var key = resolution || "";
    var tag = fpsKeyTag(fps);
    if (tag) key += (key ? "-" : "") + tag;
    if (tech) key += (key ? "-" : "") + tech;
    return key || "clip";
  }

  function variantLabel(v, opts) {
    if (!v) return "";
    var parts = [];
    if (v.resolution) parts.push(v.resolution);
    var fps = normFps(v);
    if (!opts || !opts.hideFps) parts.push(formatFps(fps));
    if (v.tech) parts.push(v.tech);
    return parts.join(" · ") || "original";
  }

  function exportPayload(db) {
    var out = {
      categories: (db.categories || []).map(function (c) {
        return { id: c.id, name: c.name, color: c.color };
      }),
      groups: (db.groups || []).map(function (g) {
        var variants = {};
        Object.keys(g.variants || {}).forEach(function (k) {
          var v = g.variants[k] || {};
          variants[k] = {
            file: v.file || "",
            path: v.path || "",
            resolution: v.resolution || "",
            fps: normFps(v),
            tech: v.tech || ""
          };
        });
        return {
          id: g.id,
          title: g.title || "",
          categoryId: g.categoryId || "",
          license: g.license || "",
          notes: g.notes || "",
          order: typeof g.order === "number" ? g.order : 0,
          variants: variants
        };
      }),
      settings: db.settings && typeof db.settings === "object" ? db.settings : {}
    };
    return out;
  }

  function stringifyDb(db) {
    return JSON.stringify(exportPayload(db), null, 2);
  }

  function normalizeDb(raw) {
    if (!raw || typeof raw !== "object") raw = {};
    var db = {
      categories: Array.isArray(raw.categories) ? raw.categories.map(function (c) {
        return {
          id: String(c.id || "").trim(),
          name: c.name || String(c.id || "Untitled"),
          color: c.color || UNCAT_COLOR
        };
      }).filter(function (c) { return c.id; }) : [],
      groups: [],
      settings: raw.settings && typeof raw.settings === "object" ? Object.assign({}, raw.settings) : {}
    };
    var seenCat = {};
    db.categories = db.categories.filter(function (c) {
      if (seenCat[c.id]) return false;
      seenCat[c.id] = true;
      return true;
    });
    var groups = Array.isArray(raw.groups) ? raw.groups : [];
    groups.forEach(function (g, i) {
      if (!g || !g.id) return;
      var variants = {};
      var src = g.variants && typeof g.variants === "object" ? g.variants : {};
      Object.keys(src).forEach(function (k) {
        var v = src[k] || {};
        variants[k] = {
          file: v.file || "",
          path: v.path || "",
          resolution: v.resolution || "",
          fps: normFps(v),
          tech: v.tech || ""
        };
      });
      db.groups.push({
        id: String(g.id),
        title: g.title || titleCaseSlug(String(g.id).replace(/^[a-z0-9]+-/, "")),
        categoryId: g.categoryId == null ? "" : String(g.categoryId),
        license: g.license == null ? "" : String(g.license),
        notes: g.notes == null ? "" : String(g.notes),
        order: typeof g.order === "number" ? g.order : i,
        variants: variants
      });
    });
    return db;
  }

    function isVideoFile(f) {
    if (!f || !f.name) return false;
    var n = String(f.name).toLowerCase();
    if (/\.(mp4|m4v|mov|webm)$/.test(n)) return true;
    return String(f.type || "").indexOf("video/") === 0;
  }

  function parseFilenameFromBase(file, base, categories) {
    var parts = String(base || "").split("-").filter(function (p) { return p.length; });
    var known = {};
    (categories || []).forEach(function (c) {
      if (c && c.id) known[String(c.id).toLowerCase()] = c.id;
    });

    var resIdx = -1;
    var resolution = "";
    var i;
    for (i = parts.length - 1; i >= 0; i--) {
      var tok = parts[i].toLowerCase();
      if (RES_TOKENS.indexOf(tok) !== -1 || /^[0-9]{3,4}p$/.test(tok)) {
        resIdx = i;
        resolution = tok;
        break;
      }
    }
    if (resIdx === -1) return null;

    var categoryId = "";
    var start = 0;
    if (parts.length && known[parts[0].toLowerCase()]) {
      categoryId = known[parts[0].toLowerCase()];
      start = 1;
    }

    var titleParts = parts.slice(start, resIdx);
    var after = parts.slice(resIdx + 1);
    var fps = 60;
    var techStart = 0;
    if (after.length) {
      var parsedFps = parseFpsToken(after[0]);
      if (parsedFps != null) {
        fps = parsedFps;
        techStart = 1;
      }
    }
    var titleSlug = (titleParts.join("-") || "untitled").toLowerCase();
    var tech = after.slice(techStart).join("-");
    var groupId = categoryId ? categoryId + "-" + titleSlug : titleSlug;
    return {
      categoryId: categoryId,
      titleSlug: titleSlug,
      title: titleCaseSlug(titleSlug),
      groupId: groupId,
      resolution: resolution,
      fps: fps,
      tech: tech,
      variantKey: makeVariantKey(resolution, fps, tech),
      file: file
    };
  }

  function parseFilename(filename, categories) {
    var file = String(filename || "").split(/[/\\]/).pop();
    var base = file.replace(/\.(mp4|m4v|mov|webm)$/i, "");
    var parsed = parseFilenameFromBase(file, base, categories);
    if (parsed) return parsed;
    if (/_/.test(base)) {
      parsed = parseFilenameFromBase(file, base.replace(/_/g, "-"), categories);
      if (parsed) return parsed;
    }
    return null;
  }

  function mergeDb(base, incoming) {
    var out = normalizeDb(base);
    var inc = incoming && typeof incoming === "object" ? incoming : {};
    var cats = Array.isArray(inc.categories) ? inc.categories : [];
    cats.forEach(function (c) {
      if (!c || !c.id) return;
      var id = String(c.id);
      var found = null;
      for (var i = 0; i < out.categories.length; i++) {
        if (out.categories[i].id === id) { found = out.categories[i]; break; }
      }
      if (found) {
        if (c.name) found.name = c.name;
        if (c.color) found.color = c.color;
      } else {
        out.categories.push({ id: id, name: c.name || id, color: c.color || UNCAT_COLOR });
      }
    });
    var groups = Array.isArray(inc.groups) ? inc.groups : [];
    groups.forEach(function (g) {
      if (!g || !g.id) return;
      var existing = null;
      for (var i = 0; i < out.groups.length; i++) {
        if (out.groups[i].id === g.id) { existing = out.groups[i]; break; }
      }
      if (!existing) {
        out.groups.push(normalizeDb({ categories: out.categories, groups: [g], settings: {} }).groups[0]);
        return;
      }
      if (g.title != null) existing.title = g.title;
      if (g.categoryId != null) existing.categoryId = g.categoryId;
      if (g.license != null) existing.license = g.license;
      if (g.notes != null) existing.notes = g.notes;
      if (typeof g.order === "number") existing.order = g.order;
      if (g.variants && typeof g.variants === "object") {
        Object.keys(g.variants).forEach(function (k) {
          var v = g.variants[k] || {};
          existing.variants[k] = Object.assign({}, existing.variants[k] || {}, {
            file: v.file != null ? v.file : (existing.variants[k] && existing.variants[k].file) || "",
            path: v.path != null ? v.path : (existing.variants[k] && existing.variants[k].path) || "",
            resolution: v.resolution != null ? v.resolution : (existing.variants[k] && existing.variants[k].resolution) || "",
            fps: v.fps != null ? Number(v.fps) : normFps(Object.assign({}, existing.variants[k] || {}, v)),
            tech: v.tech != null ? v.tech : (existing.variants[k] && existing.variants[k].tech) || ""
          });
        });
      }
    });
    if (inc.settings && typeof inc.settings === "object") {
      out.settings = Object.assign({}, out.settings, inc.settings);
    }
    return out;
  }

  function updateSavePill(flash) {
    if (!saveStatus) return;
    var dirty = stringifyDb(state.db) !== lastExportJson;
    var text = dirty
      ? "Autosaved locally · Export to update videos.json"
      : "Autosaved locally";
    saveStatus.textContent = text;
    saveStatus.className = "save-pill" + (dirty ? " dirty" : "") + (flash ? " flash" : "");
    if (flash) {
      saveStatus.textContent = "saved";
      saveStatus.className = "save-pill flash";
      clearTimeout(flashTimer);
      flashTimer = setTimeout(function () {
        saveStatus.textContent = text;
        saveStatus.className = "save-pill" + (dirty ? " dirty" : "");
      }, 900);
    }
  }

  function saveDb(flash) {
    try { localStorage.setItem(LS_KEY, stringifyDb(state.db)); } catch (err) {}
    updateSavePill(flash !== false);
  }

  var saveDbDebounced = debounce(function () { saveDb(true); }, 300);

  function relPath(file) {
    return (file.webkitRelativePath || file.relativePath || file.name || "").replace(/\\/g, "/");
  }

  function basename(p) {
    return String(p || "").split("/").pop();
  }

  function revokeAllUrls() {
    urlMap.forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (err) {}
    });
    urlMap.clear();
  }

  function urlFor(key, file) {
    if (urlMap.has(key)) return urlMap.get(key);
    var url = URL.createObjectURL(file);
    urlMap.set(key, url);
    return url;
  }

    function namesEqual(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
  }

  function getFileForVariant(v) {
    if (!v) return null;
    var path = (v.path || "").replace(/\\/g, "/");
    if (path && fileMap.has(path)) return fileMap.get(path);
    var name = v.file || basename(path);
    if (name && fileByName.has(name)) return fileByName.get(name);
    if (name && fileByName.has(name.toLowerCase())) return fileByName.get(name.toLowerCase());
    var found = null;
    fileMap.forEach(function (f, p) {
      if (found) return;
      var pn = String(p || "").replace(/\\/g, "/");
      var bn = basename(pn);
      if (path && (pn === path || pn.slice(-(path.length + 1)) === "/" + path)) found = f;
      else if (name && (namesEqual(bn, name) || namesEqual(f.name, name))) found = f;
    });
    return found;
  }

  function variantOnDisk(v) {
    return !!getFileForVariant(v);
  }

  function groupOnDisk(g) {
    if (!g || !g.variants) return false;
    var keys = Object.keys(g.variants);
    for (var i = 0; i < keys.length; i++) {
      if (variantOnDisk(g.variants[keys[i]])) return true;
    }
    return false;
  }

    function rememberFile(file) {
    var path = relPath(file) || file.name;
    fileMap.set(path, file);
    fileByName.set(file.name, file);
    fileByName.set(String(file.name).toLowerCase(), file);
    return path;
  }

  function upsertParsedGroup(parsed, path) {
    var group = null;
    for (var i = 0; i < state.db.groups.length; i++) {
      if (state.db.groups[i].id === parsed.groupId) { group = state.db.groups[i]; break; }
    }
    if (!group) {
      var maxOrder = -1;
      state.db.groups.forEach(function (g) { if (g.order > maxOrder) maxOrder = g.order; });
      group = {
        id: parsed.groupId,
        title: parsed.title,
        categoryId: parsed.categoryId,
        license: "",
        notes: "",
        order: maxOrder + 1,
        variants: {}
      };
      state.db.groups.push(group);
    }
    group.variants[parsed.variantKey] = {
      file: parsed.file,
      path: path,
      resolution: parsed.resolution,
      fps: parsed.fps != null ? parsed.fps : 60,
      tech: parsed.tech
    };
  }

  function matchExistingVariant(file, path) {
    var name = file.name;
    var groups = state.db.groups || [];
    for (var i = 0; i < groups.length; i++) {
      var vars = groups[i].variants || {};
      var keys = Object.keys(vars);
      for (var k = 0; k < keys.length; k++) {
        var v = vars[keys[k]];
        if (!v) continue;
        var vf = v.file || basename(v.path);
        var vp = (v.path || "").replace(/\\/g, "/");
        if (namesEqual(vf, name) || namesEqual(basename(vp), name)) {
          v.file = name;
          v.path = path;
          return true;
        }
        if (vp && (path === vp || path.slice(-(vp.length + 1)) === "/" + vp || vp.slice(-(path.length + 1)) === "/" + path)) {
          v.file = name;
          v.path = path;
          return true;
        }
      }
    }
    return false;
  }

  function upsertLooseFile(file, path) {
    if (matchExistingVariant(file, path)) return;
    var stem = String(file.name).replace(/\.[^.]+$/, "");
    var slug = stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clip";
    var groupId = slug;
    var group = null;
    for (var i = 0; i < state.db.groups.length; i++) {
      if (state.db.groups[i].id === groupId) { group = state.db.groups[i]; break; }
    }
    if (!group) {
      var maxOrder = -1;
      state.db.groups.forEach(function (g) { if (g.order > maxOrder) maxOrder = g.order; });
      group = {
        id: groupId,
        title: titleCaseSlug(slug),
        categoryId: "",
        license: "",
        notes: "",
        order: maxOrder + 1,
        variants: {}
      };
      state.db.groups.push(group);
    }
    var key = slug;
    var n = 2;
    while (group.variants[key]) { key = slug + "-" + n; n++; }
    group.variants[key] = {
      file: file.name,
      path: path,
      resolution: "",
      fps: 60,
      tech: ""
    };
  }

  function firstOnDiskGroupId() {
    var arr = (state.db.groups || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    for (var i = 0; i < arr.length; i++) {
      if (groupOnDisk(arr[i])) return arr[i].id;
    }
    return null;
  }

  function groupTitleSlug(group) {
    var id = String((group && group.id) || "");
    var cat = (group && group.categoryId) || "";
    if (cat && id.toLowerCase().indexOf(String(cat).toLowerCase() + "-") === 0) {
      return id.slice(cat.length + 1);
    }
    return id;
  }

  function slugifyTitleInput(raw) {
    var s = String(raw || "").trim().toLowerCase()
      .replace(/[_\s]+/g, "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!s) return "";
    if (RES_TOKENS.indexOf(s) !== -1 || /^[0-9]{3,4}p$/.test(s)) return "";
    if (parseFpsToken(s)) return "";
    return s;
  }

  function extOfName(name) {
    var m = String(name || "").match(/(\.[^.]+)$/);
    return m ? m[1] : ".mp4";
  }

  function dirOfPath(path) {
    var p = String(path || "").replace(/\\/g, "/");
    var i = p.lastIndexOf("/");
    return i === -1 ? "" : p.slice(0, i + 1);
  }

  function filenameForSlug(parsed, slug, ext) {
    var parts = [];
    if (parsed.categoryId) parts.push(parsed.categoryId);
    parts.push(slug);
    parts.push(parsed.resolution);
    if (parsed.fps != null && Math.abs(Number(parsed.fps) - 60) > 0.05) parts.push(formatFps(parsed.fps));
    if (parsed.tech) parts.push(parsed.tech);
    return parts.join("-") + ext;
  }

  function handleForPath(path, name) {
    path = String(path || "").replace(/\\/g, "/");
    if (path && handleMap.has(path)) return handleMap.get(path);
    if (name && handleMap.has(name)) return handleMap.get(name);
    var found = null;
    handleMap.forEach(function (rec, p) {
      if (found) return;
      if (namesEqual(p, path) || namesEqual(basename(p), name)) found = rec;
    });
    return found;
  }

  function refreshCanWrite() {
    var ok = false;
    handleMap.forEach(function (rec) {
      if (rec && rec.fileHandle && typeof rec.fileHandle.move === "function") ok = true;
    });
    state.canWrite = ok;
  }

  function queryDestExists(parentHandle, newName) {
    if (!parentHandle || typeof parentHandle.getFileHandle !== "function") {
      return Promise.resolve(!!(fileByName.has(newName) || fileByName.has(String(newName).toLowerCase())));
    }
    return parentHandle.getFileHandle(newName).then(function () { return true; }).catch(function () { return false; });
  }

  function buildRenamePlan(group, rawSlug) {
    var plan = { ok: false, error: "", items: [], newGroupId: "", newSlug: "" };
    if (!group) {
      plan.error = "No group selected.";
      return plan;
    }
    var newSlug = slugifyTitleInput(rawSlug);
    plan.newSlug = newSlug;
    if (!newSlug) {
      plan.error = "Enter a title slug (letters, digits, hyphens).";
      return plan;
    }
    var oldSlug = groupTitleSlug(group);
    if (oldSlug === newSlug) {
      plan.error = "That is already the filename title.";
      return plan;
    }
    plan.newGroupId = group.categoryId ? group.categoryId + "-" + newSlug : newSlug;
    var clash = false;
    (state.db.groups || []).forEach(function (other) {
      if (other && other.id === plan.newGroupId && other !== group) clash = true;
    });
    if (clash) {
      plan.error = "Another group already uses that name.";
      return plan;
    }
    var keys = Object.keys(group.variants || {});
    if (!keys.length) {
      plan.error = "No files in this group.";
      return plan;
    }
    var dests = {};
    var i;
    for (i = 0; i < keys.length; i++) {
      var v = group.variants[keys[i]];
      if (!v) continue;
      var name = v.file || basename(v.path);
      var parsed = parseFilename(name, state.db.categories);
      if (!parsed || !parsed.resolution) {
        plan.error = "Cannot parse “" + name + "” — need category-title-resolution.";
        return plan;
      }
      var newName = filenameForSlug(parsed, newSlug, extOfName(name));
      var oldPath = (v.path || name).replace(/\\/g, "/");
      var newPath = dirOfPath(oldPath) + newName;
      if (dests[newPath.toLowerCase()]) {
        plan.error = "Rename would collide: " + newName;
        return plan;
      }
      dests[newPath.toLowerCase()] = true;
      plan.items.push({
        key: keys[i],
        variant: v,
        oldName: name,
        newName: newName,
        oldPath: oldPath,
        newPath: newPath
      });
    }
    plan.ok = plan.items.length > 0;
    return plan;
  }

  function renderRenamePanel() {
    var hint = $("renameHint");
    var preview = $("renamePreview");
    var btn = $("btnRenameFiles");
    var input = $("fieldRenameSlug");
    var g = currentGroup();
    if (!hint || !btn || !input || !g) return;
    if (document.activeElement !== input) input.value = groupTitleSlug(g);
    var plan = buildRenamePlan(g, input.value);
    if (!state.canWrite) {
      hint.textContent = "Load the video folder with write access to rename the real files. Only the title slug changes — category and resolution stay.";
    } else {
      hint.textContent = "Renames the real files on disk. Only the title between the category prefix and the resolution changes.";
    }
    if (plan.items.length && plan.newSlug && plan.newSlug !== groupTitleSlug(g)) {
      preview.hidden = false;
      preview.innerHTML = plan.items.map(function (it) {
        return "<li><span class=\"rename-old\">" + esc(it.oldName) + "</span><span class=\"rename-arrow\"> → </span><span class=\"rename-new\">" + esc(it.newName) + "</span></li>";
      }).join("");
    } else {
      preview.hidden = true;
      preview.innerHTML = "";
    }
    btn.disabled = !plan.ok || !state.canWrite;
  }

  function renameGroupFiles() {
    var g = currentGroup();
    var input = $("fieldRenameSlug");
    var plan = buildRenamePlan(g, input && input.value);
    if (!plan.ok) {
      alert(plan.error || "Cannot rename.");
      return;
    }
    var onDisk = plan.items.filter(function (it) { return variantOnDisk(it.variant); });
    if (!onDisk.length) {
      alert("Load the video folder first so the files are on disk.");
      return;
    }
    var missing = onDisk.filter(function (it) {
      var rec = handleForPath(it.oldPath, it.oldName);
      return !rec || !rec.fileHandle || typeof rec.fileHandle.move !== "function";
    });
    if (missing.length) {
      alert("Chrome needs write access to rename files. Click Load video folder and allow editing the folder.");
      return;
    }
    var lines = plan.items.map(function (it) { return it.oldName + "  →  " + it.newName; }).join("\n");
    if (!confirm("Rename " + plan.items.length + " file" + (plan.items.length === 1 ? "" : "s") + " on disk?\n\n" + lines)) return;

    var chain = Promise.resolve();
    onDisk.forEach(function (it) {
      chain = chain.then(function () {
        if (namesEqual(it.oldName, it.newName)) return;
        var rec = handleForPath(it.oldPath, it.oldName);
        return queryDestExists(rec.parentHandle, it.newName).then(function (exists) {
          if (exists) return Promise.reject(new Error("A file named “" + it.newName + "” already exists."));
        });
      });
    });
    onDisk.forEach(function (it) {
      chain = chain.then(function () {
        var rec = handleForPath(it.oldPath, it.oldName);
        return rec.fileHandle.move(it.newName).then(function () {
          return rec.fileHandle.getFile();
        }).then(function (newFile) {
          try {
            Object.defineProperty(newFile, "webkitRelativePath", { value: it.newPath, configurable: true });
          } catch (err) {
            newFile.relativePath = it.newPath;
          }
          if (urlMap.has(it.oldPath)) {
            try { URL.revokeObjectURL(urlMap.get(it.oldPath)); } catch (err) {}
            urlMap.delete(it.oldPath);
          }
          fileMap.delete(it.oldPath);
          handleMap.delete(it.oldPath);
          fileByName.delete(it.oldName);
          fileByName.delete(String(it.oldName).toLowerCase());
          rememberFile(newFile);
          handleMap.set(it.newPath, rec);
          it.variant.file = it.newName;
          it.variant.path = it.newPath;
        });
      });
    });
    chain.then(function () {
      plan.items.forEach(function (it) {
        it.variant.file = it.newName;
        it.variant.path = it.newPath;
      });
      var oldId = g.id;
      var oldSlug = groupTitleSlug(g);
      if ((g.title || "") === titleCaseSlug(oldSlug)) g.title = titleCaseSlug(plan.newSlug);
      g.id = plan.newGroupId;
      if (state.selectedId === oldId) state.selectedId = g.id;
      saveDb(true);
      applySources(true);
      renderAll();
    }).catch(function (err) {
      alert(err && err.message ? err.message : "Could not rename files.");
      renderAll();
    });
  }

  function walkDirHandle(dirHandle, prefix) {
    prefix = prefix || "";
    var out = [];
    var iter = dirHandle.entries();
    function next() {
      return iter.next().then(function (step) {
        if (step.done) return out;
        var name = step.value[0];
        var handle = step.value[1];
        if (handle.kind === "file") {
          return handle.getFile().then(function (file) {
            try {
              Object.defineProperty(file, "webkitRelativePath", { value: prefix + name, configurable: true });
            } catch (err) {
              file.relativePath = prefix + name;
            }
            out.push({ file: file, fileHandle: handle, parentHandle: dirHandle });
            return next();
          });
        }
        if (handle.kind === "directory") {
          return walkDirHandle(handle, prefix + name + "/").then(function (nested) {
            out = out.concat(nested);
            return next();
          });
        }
        return next();
      });
    }
    return next();
  }

  function ingestDirectoryHandle(dirHandle) {
    var permP = Promise.resolve("granted");
    if (dirHandle && typeof dirHandle.requestPermission === "function") {
      permP = dirHandle.requestPermission({ mode: "readwrite" });
    }
    return permP.then(function (perm) {
      rootDirHandle = (perm && perm !== "granted") ? null : dirHandle;
      return walkDirHandle(dirHandle, "");
    }).then(function (entries) {
      scanEntries(entries);
    });
  }

  function scanEntries(entries) {
    var list = (entries || []).map(function (e) {
      if (e && e.file) return e;
      return { file: e, fileHandle: null, parentHandle: null };
    }).filter(function (e) { return isVideoFile(e.file); });

    revokeAllUrls();
    fileMap.clear();
    fileByName.clear();
    handleMap.clear();
    state.hasFolder = list.length > 0;

    list.forEach(function (e) {
      var path = rememberFile(e.file);
      if (e.fileHandle) handleMap.set(path, { fileHandle: e.fileHandle, parentHandle: e.parentHandle || null });
      var parsed = parseFilename(e.file.name, state.db.categories);
      if (parsed) upsertParsedGroup(parsed, path);
      else upsertLooseFile(e.file, path);
    });
    refreshCanWrite();

    var playId = state.selectedId;
    var cur = currentGroup();
    if (!playId || !cur || !groupOnDisk(cur)) playId = firstOnDiskGroupId();

    saveDb(true);
    if (playId) {
      // Re-pick A/B so we land on an on-disk variant, not a JSON-only 4k original.
      openGroup(playId, true);
    } else {
      renderAll();
      if (state.selectedId) applySources(true);
    }
    function kickPlay() {
      playBoth();
      videoA.removeEventListener("canplay", kickPlay);
      videoA.removeEventListener("loadeddata", kickPlay);
    }
    videoA.addEventListener("canplay", kickPlay);
    videoA.addEventListener("loadeddata", kickPlay);
    playBoth();
  }

  function scanFolder(files) {
    rootDirHandle = null;
    state.canWrite = false;
    scanEntries(Array.prototype.slice.call(files || []).map(function (file) {
      return { file: file, fileHandle: null, parentHandle: null };
    }));
  }

  function readAllEntries(reader) {
    return new Promise(function (resolve) {
      var all = [];
      function next() {
        reader.readEntries(function (batch) {
          if (!batch || !batch.length) return resolve(all);
          all = all.concat(Array.prototype.slice.call(batch));
          next();
        }, function () { resolve(all); });
      }
      next();
    });
  }

  function walkEntry(entry, prefix) {
    prefix = prefix || "";
    return new Promise(function (resolve) {
      if (!entry) return resolve([]);
      if (entry.isFile) {
        entry.file(function (file) {
          try {
            Object.defineProperty(file, "webkitRelativePath", { value: prefix + file.name, configurable: true });
          } catch (err) {
            file.relativePath = prefix + file.name;
          }
          resolve([file]);
        }, function () { resolve([]); });
        return;
      }
      if (entry.isDirectory) {
        readAllEntries(entry.createReader()).then(function (entries) {
          var nextPrefix = prefix + entry.name + "/";
          Promise.all(entries.map(function (e) { return walkEntry(e, nextPrefix); })).then(function (nested) {
            var flat = [];
            nested.forEach(function (arr) { flat = flat.concat(arr); });
            resolve(flat);
          });
        });
        return;
      }
      resolve([]);
    });
  }

  function filesFromDrop(dt) {
    var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items.map(function (it) {
      return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
    }).filter(Boolean);
    if (entries.length) {
      return Promise.all(entries.map(function (e) { return walkEntry(e, ""); })).then(function (nested) {
        var flat = [];
        nested.forEach(function (arr) { flat = flat.concat(arr); });
        if (flat.length) return flat;
        return Array.prototype.slice.call((dt && dt.files) || []);
      });
    }
    return Promise.resolve(Array.prototype.slice.call((dt && dt.files) || []));
  }

  function sortVariantKeys(group) {
    return Object.keys(group.variants || {}).sort(function (a, b) {
      var va = group.variants[a] || {};
      var vb = group.variants[b] || {};
      var d = rankRes(va.resolution) - rankRes(vb.resolution);
      if (d) return d;
      var fa = normFps(va) - normFps(vb);
      if (fa) return fa;
      if (!va.tech && vb.tech) return -1;
      if (va.tech && !vb.tech) return 1;
      return String(va.tech || "").localeCompare(String(vb.tech || ""));
    });
  }

  function pickDefaultAB(group) {
    var keys = sortVariantKeys(group);
    if (!keys.length) return { a: null, b: null };

    function onDisk(k) {
      return variantOnDisk(group.variants[k]);
    }

    var orig = [];
    var up = [];
    keys.forEach(function (k) {
      var v = group.variants[k];
      if (v && v.tech) up.push(k);
      else orig.push(k);
    });
    function byResDesc(a, b) {
      return rankRes(group.variants[b].resolution) - rankRes(group.variants[a].resolution);
    }
    orig.sort(byResDesc);
    up.sort(byResDesc);

    var origDisk = orig.filter(onDisk);
    var upDisk = up.filter(onDisk);
    var anyDisk = keys.filter(onDisk);

    // Prefer a file that is actually in the loaded folder so the player
    // does not land on "Not on disk" when a lower-res original is present.
    function prefer60(arr) {
      var hit = arr.filter(function (k) {
        return Math.abs(normFps(group.variants[k]) - 60) < 0.05;
      });
      return hit.length ? hit : arr;
    }
    var a = prefer60(origDisk)[0] || prefer60(anyDisk)[0] || prefer60(orig)[0] || keys[keys.length - 1];
    var b = null;
    var aRes = group.variants[a] ? group.variants[a].resolution : "";
    var aFps = group.variants[a] ? normFps(group.variants[a]) : 60;
    function sameFps(k) { return Math.abs(normFps(group.variants[k]) - aFps) < 0.05; }
    var upPool = upDisk.length ? upDisk : (anyDisk.length ? [] : up);
    if (upDisk.length) {
      var same = upDisk.filter(function (k) { return sameRank(group.variants[k].resolution, aRes) && sameFps(k); });
      if (!same.length) same = upDisk.filter(function (k) { return sameRank(group.variants[k].resolution, aRes); });
      b = (same.length ? same : upDisk)[0];
    } else if (origDisk.length > 1) {
      b = origDisk[0] === a ? origDisk[1] : origDisk[0];
    } else if (!anyDisk.length && up.length) {
      var same2 = up.filter(function (k) { return sameRank(group.variants[k].resolution, aRes); });
      b = (same2.length ? same2 : up)[0];
    } else if (!anyDisk.length && orig.length > 1) {
      b = orig[1];
    }
    if (b === a) {
      b = anyDisk.filter(function (k) { return k !== a; })[0] || null;
    }
    return { a: a, b: b };
  }

  function unusedVariantKey(group, used, preferUpscale) {
    var keys = sortVariantKeys(group);
    var pool = [];
    var i, k, v;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (used[k]) continue;
      v = group.variants[k];
      if (!v) continue;
      pool.push(k);
    }
    if (!pool.length) return keys[0] || null;
    pool.sort(function (a, b) {
      var va = group.variants[a] || {};
      var vb = group.variants[b] || {};
      var ua = va.tech ? 1 : 0;
      var ub = vb.tech ? 1 : 0;
      if (preferUpscale) return (ub - ua) || (rankRes(vb.resolution) - rankRes(va.resolution));
      return (ua - ub) || (rankRes(vb.resolution) - rankRes(va.resolution));
    });
    return pool[0];
  }

  function pickDefaultCD(group, keyA, keyB) {
    var used = {};
    if (keyA) used[keyA] = true;
    if (keyB) used[keyB] = true;
    var c = unusedVariantKey(group, used, false);
    if (c) used[c] = true;
    var d = unusedVariantKey(group, used, true);
    return { c: c, d: d };
  }

  function variantCount(g) {
    return Object.keys((g && g.variants) || {}).length;
  }

  function techLabel(tech) {
    return tech ? tech : "Original";
  }

  function clearLastPick() {
    lastPick.mode = "single";
    lastPick.compareCount = 2;
    lastPick.wipeAxis = "v";
    lastPick.fps = null;
    lastPick.resA = null;
    lastPick.techA = null;
    lastPick.resB = null;
    lastPick.techB = null;
    lastPick.resC = null;
    lastPick.techC = null;
    lastPick.resD = null;
    lastPick.techD = null;
  }

  function rememberSlot(key, resField, techField) {
    var g = currentGroup();
    var v = g && g.variants[key];
    if (!v) return;
    lastPick[resField] = v.resolution || "";
    lastPick[techField] = v.tech || "";
  }

  function rememberPick() {
    var g = currentGroup();
    if (!g) return;
    var va = g.variants[state.keyA];
    if (va) {
      lastPick.fps = normFps(va);
      lastPick.resA = va.resolution || "";
      lastPick.techA = va.tech || "";
    }
    rememberSlot(state.keyB, "resB", "techB");
    rememberSlot(state.keyC, "resC", "techC");
    rememberSlot(state.keyD, "resD", "techD");
  }

  function groupResList(group, fps) {
    var seen = {};
    var list = [];
    if (!group) return list;
    sortVariantKeys(group).forEach(function (k) {
      var v = group.variants[k];
      if (!v || !v.resolution) return;
      if (fps != null && Math.abs(normFps(v) - fps) > 0.05) return;
      if (seen[v.resolution]) return;
      seen[v.resolution] = true;
      list.push(v.resolution);
    });
    list.sort(function (a, b) { return rankRes(a) - rankRes(b); });
    return list;
  }

  function groupTechList(group, fps, res) {
    var seen = {};
    var list = [];
    if (!group) return list;
    sortVariantKeys(group).forEach(function (k) {
      var v = group.variants[k];
      if (!v) return;
      if (fps != null && Math.abs(normFps(v) - fps) > 0.05) return;
      if (res && v.resolution !== res) return;
      var t = v.tech || "";
      if (seen[t]) return;
      seen[t] = true;
      list.push(t);
    });
    list.sort(function (a, b) {
      if (!a && b) return -1;
      if (a && !b) return 1;
      return String(a).localeCompare(String(b));
    });
    return list;
  }

  function findVariantKey(group, res, fps, tech) {
    if (!group) return null;
    var keys = sortVariantKeys(group);
    var wantTech = tech || "";
    var exact = null;
    var ranked = null;
    var i;
    for (i = 0; i < keys.length; i++) {
      var v = group.variants[keys[i]];
      if (!v) continue;
      if (fps != null && Math.abs(normFps(v) - fps) > 0.05) continue;
      if ((v.tech || "") !== wantTech) continue;
      if (!res || v.resolution === res) {
        exact = keys[i];
        break;
      }
      if (!ranked && sameRank(v.resolution, res)) ranked = keys[i];
    }
    return exact || ranked;
  }

  function findBestAtResFps(group, res, fps, preferTech) {
    if (!group) return null;
    var keys = sortVariantKeys(group).filter(function (k) {
      var v = group.variants[k];
      if (!v) return false;
      if (fps != null && Math.abs(normFps(v) - fps) > 0.05) return false;
      if (res && v.resolution !== res && !sameRank(v.resolution, res)) return false;
      return true;
    });
    if (!keys.length) return null;
    function score(k) {
      var v = group.variants[k];
      var s = 0;
      if ((v.tech || "") === (preferTech || "")) s += 8;
      if (v.resolution === res) s += 4;
      if (!v.tech) s += 2;
      if (variantOnDisk(v)) s += 1;
      return s;
    }
    keys.sort(function (a, b) { return score(b) - score(a); });
    return keys[0];
  }

  function matchSlot(group, res, tech, fps, fallback) {
    if (!group) return fallback || null;
    if (res != null || tech != null) {
      var key = findVariantKey(group, res, fps, tech);
      if (key) return key;
      key = findBestAtResFps(group, res, fps, tech);
      if (key) return key;
      key = findVariantKey(group, null, fps, tech);
      if (key) return key;
      key = findBestAtResFps(group, null, fps, tech);
      if (key) return key;
    }
    return fallback || null;
  }

  function pickFpsForGroup(group, want) {
    var list = groupFpsList(group);
    if (!list.length) {
      var all = [];
      var seen = {};
      sortVariantKeys(group).forEach(function (k) {
        var f = normFps(group.variants[k]);
        var tag = formatFps(f);
        if (!seen[tag]) { seen[tag] = true; all.push(f); }
      });
      list = all;
    }
    if (!list.length) return want != null ? want : 60;
    var i;
    if (want != null) {
      for (i = 0; i < list.length; i++) if (Math.abs(list[i] - want) < 0.05) return list[i];
    }
    for (i = 0; i < list.length; i++) if (Math.abs(list[i] - 60) < 0.05) return list[i];
    return list[0];
  }

  function restoreState() {
    return {
      time: videoA.currentTime || 0,
      rate: state.rate,
      paused: videoA.paused
    };
  }

    function loadVariant(video, variant, restore) {
    restore = restore || { time: 0, rate: state.rate, paused: true };
    var file = getFileForVariant(variant);
    if (!file || !variant) {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      try { video.load(); } catch (err) {}
      return false;
    }
    var key = relPath(file) || variant.path || variant.file;
    var url = urlFor(key, file);
    var apply = function () {
      try { video.playbackRate = restore.rate || state.rate || 1; } catch (err) {}
      var t = restore.time;
      if (Number.isFinite(t) && t > 0) {
        try {
          var dur = video.duration;
          video.currentTime = Number.isFinite(dur) ? Math.min(t, Math.max(0, t)) : t;
        } catch (err) {}
      }
      if (!restore.paused) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
      updateTransport();
      updatePlayBtn();
    };
    if (video.getAttribute("src") === url && video.readyState >= 2) {
      apply();
      return true;
    }
    video.addEventListener("loadeddata", apply, { once: true });
    video.addEventListener("canplay", apply, { once: true });
    video.addEventListener("error", function () {
      try { console.warn("SR Video Lab: cannot play", variant.file || variant.path, video.error); } catch (err) {}
    }, { once: true });
    video.src = url;
    return true;
  }

  function unloadVideo(video, missingEl) {
    if (!video) return;
    try { video.pause(); } catch (err) {}
    video.removeAttribute("src");
    try { video.load(); } catch (err) {}
    if (missingEl) missingEl.hidden = true;
  }

  function muteFollower(video) {
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
  }

  function applySources(keepTime) {
    var g = currentGroup();
    var restore = keepTime ? restoreState() : { time: 0, rate: state.rate, paused: true };
    restore.rate = state.rate;
    videoA.muted = state.muted;
    muteFollower(videoB);
    muteFollower(videoC);
    muteFollower(videoD);
    if (!g) {
      unloadVideo(videoA, missingA);
      unloadVideo(videoB, missingB);
      unloadVideo(videoC, missingC);
      unloadVideo(videoD, missingD);
      updatePlayBtn();
      return;
    }
    missingA.hidden = loadVariant(videoA, g.variants[state.keyA], restore);
    if (!isCompare()) {
      unloadVideo(videoB, missingB);
      unloadVideo(videoC, missingC);
      unloadVideo(videoD, missingD);
    } else {
      missingB.hidden = loadVariant(videoB, g.variants[state.keyB], restore);
      if (isQuad()) {
        missingC.hidden = loadVariant(videoC, g.variants[state.keyC], restore);
        missingD.hidden = loadVariant(videoD, g.variants[state.keyD], restore);
      } else {
        unloadVideo(videoC, missingC);
        unloadVideo(videoD, missingD);
      }
    }
    updatePlayBtn();
    updateTransport();
    updateZoomUi();
  }

  function syncOne(video, t, force) {
    if (!video || !video.getAttribute("src") || video.readyState < 1) return;
    if (force || Math.abs((video.currentTime || 0) - t) > DRIFT) {
      try { video.currentTime = t; } catch (err) {}
    }
    if (video.playbackRate !== videoA.playbackRate) {
      try { video.playbackRate = videoA.playbackRate; } catch (err) {}
    }
  }

  function syncVideos(force) {
    if (!isCompare()) return;
    if (syncing && !force) return;
    syncing = true;
    var t = videoA.currentTime || 0;
    forEachCompareVideo(function (v) { syncOne(v, t, force); });
    setTimeout(function () { syncing = false; }, 80);
  }

  function playBoth() {
    var p = videoA.play();
    if (p && p.catch) p.catch(function () {});
    forEachCompareVideo(function (v) {
      var q = v.play();
      if (q && q.catch) q.catch(function () {});
    });
    updatePlayBtn();
  }

  function pauseBoth() {
    try { videoA.pause(); } catch (err) {}
    forEachCompareVideo(function (v) {
      try { v.pause(); } catch (err) {}
    });
    if (videoC) try { videoC.pause(); } catch (err) {}
    if (videoD) try { videoD.pause(); } catch (err) {}
    updatePlayBtn();
  }

  function playPause() {
    if (videoA.paused) playBoth();
    else pauseBoth();
  }

  function currentFrameDt() {
    var g = currentGroup();
    var v = g && g.variants[state.keyA];
    var fps = normFps(v);
    return fps > 0 ? 1 / fps : FRAME_DT;
  }

  function frameStep(dir) {
    pauseBoth();
    var dt = currentFrameDt() * dir;
    var t = (videoA.currentTime || 0) + dt;
    var dur = videoA.duration;
    if (Number.isFinite(dur)) t = Math.max(0, Math.min(dur, t));
    else t = Math.max(0, t);
    try { videoA.currentTime = t; } catch (err) {}
    forEachCompareVideo(function (v) {
      try { v.currentTime = t; } catch (err) {}
    });
    updateTransport();
  }

  function jumpSeconds(s) {
    var t = (videoA.currentTime || 0) + s;
    var dur = videoA.duration;
    if (Number.isFinite(dur)) t = Math.max(0, Math.min(dur, t));
    else t = Math.max(0, t);
    try { videoA.currentTime = t; } catch (err) {}
    forEachCompareVideo(function (v) {
      try { v.currentTime = t; } catch (err) {}
    });
    updateTransport();
  }

  function setRate(r) {
    state.rate = r;
    try { videoA.playbackRate = r; } catch (err) {}
    [videoB, videoC, videoD].forEach(function (v) {
      if (!v) return;
      try { v.playbackRate = r; } catch (err) {}
    });
    renderSpeeds();
  }

  function formatTime(t) {
    if (!Number.isFinite(t) || t < 0) return "–:––";
    var m = Math.floor(t / 60);
    var s = t - m * 60;
    var whole = Math.floor(s);
    var frac = Math.floor((s - whole) * 100);
    var ss = (whole < 10 ? "0" : "") + whole;
    var ff = (frac < 10 ? "0" : "") + frac;
    return m + ":" + ss + "." + ff;
  }

  function updatePlayBtn() {
    if (!btnPlay) return;
    btnPlay.textContent = videoA.paused ? "▶" : "❚❚";
    btnPlay.setAttribute("aria-label", videoA.paused ? "Play" : "Pause");
  }

  function updateMuteBtn() {
    if (!btnMute) return;
    btnMute.textContent = state.muted ? "🔇" : "🔊";
    btnMute.setAttribute("aria-pressed", state.muted ? "true" : "false");
    btnMute.classList.toggle("is-on", state.muted);
  }

  function updateTransport() {
    var dur = videoA.duration;
    var t = videoA.currentTime || 0;
    var ok = Number.isFinite(dur) && dur > 0;
    seek.disabled = !ok;
    if (ok && !seeking) {
      seek.max = String(dur);
      seek.value = String(t);
    }
    timeLabel.textContent = formatTime(t) + " / " + (ok ? formatTime(dur) : "–:––");
  }

  function setWipe(pct) {
    state.wipe = Math.max(0, Math.min(100, pct));
    picture.style.setProperty("--wipe", state.wipe + "%");
  }

  function setWipeAxis(axis) {
    state.wipeAxis = axis === "h" ? "h" : "v";
    lastPick.wipeAxis = state.wipeAxis;
    if (picture) picture.setAttribute("data-wipe", state.wipeAxis);
    renderWipeAxisTabs();
  }

  function renderWipeAxisTabs() {
    var wrap = $("wipeAxisTabs");
    if (wrap) wrap.style.display = state.mode === "wipe" ? "" : "none";
    var tabs = document.querySelectorAll("#wipeAxisTabs .tab");
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-axis") === state.wipeAxis);
    }
  }

  function formatZoom(z) {
    if (!Number.isFinite(z) || z <= 1.001) return "1×";
    if (Math.abs(z - Math.round(z)) < 0.05) return Math.round(z) + "×";
    return (Math.round(z * 10) / 10) + "×";
  }

  function canZoom() {
    return !!(picture && placeholder && placeholder.hidden && videoA && videoA.getAttribute("src"));
  }

  function zoomLayoutRect() {
    if (isSbsSolo()) return picture.getBoundingClientRect();
    return ((isQuad() || state.mode === "sbs") && paneA ? paneA : picture).getBoundingClientRect();
  }

  function zoomRectForPoint(clientX, clientY) {
    if (isSbsSolo()) return picture.getBoundingClientRect();
    var panes = isQuad()
      ? [paneA, paneB, paneC, paneD]
      : (state.mode === "sbs" ? [paneA, paneB] : null);
    if (panes) {
      var i, r;
      for (i = 0; i < panes.length; i++) {
        if (!panes[i]) continue;
        r = panes[i].getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return r;
      }
      return paneA ? paneA.getBoundingClientRect() : picture.getBoundingClientRect();
    }
    return picture.getBoundingClientRect();
  }

  function clampPan() {
    if (state.zoom <= 1.001) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      return;
    }
    var rect = zoomLayoutRect();
    if (!rect.width || !rect.height) return;
    var maxX = (rect.width * (state.zoom - 1)) / 2;
    var maxY = (rect.height * (state.zoom - 1)) / 2;
    state.panX = Math.max(-maxX, Math.min(maxX, state.panX));
    state.panY = Math.max(-maxY, Math.min(maxY, state.panY));
  }

  function applyZoom() {
    clampPan();
    var t = state.zoom <= 1.001
      ? "none"
      : "translate(" + state.panX + "px, " + state.panY + "px) scale(" + state.zoom + ")";
    if (videoA) videoA.style.transform = t;
    if (videoB) videoB.style.transform = t;
    if (videoC) videoC.style.transform = t;
    if (videoD) videoD.style.transform = t;
    if (picture) {
      picture.classList.toggle("is-zoomed", state.zoom > 1.001);
      if (state.zoom <= 1.001) picture.classList.remove("is-panning");
    }
    updateZoomUi();
  }

  function updateZoomUi() {
    var label = formatZoom(state.zoom);
    var ids = ["btnZoomReset", "btnZoomResetBar"];
    var i;
    for (i = 0; i < ids.length; i++) {
      var el = $(ids[i]);
      if (el) el.textContent = label;
    }
    var atMin = state.zoom <= ZOOM_MIN + 0.001;
    var atMax = state.zoom >= ZOOM_MAX - 0.001;
    var outIds = ["btnZoomOut", "btnZoomOutBar"];
    var inIds = ["btnZoomIn", "btnZoomInBar"];
    for (i = 0; i < outIds.length; i++) {
      if ($(outIds[i])) $(outIds[i]).disabled = atMin || !canZoom();
    }
    for (i = 0; i < inIds.length; i++) {
      if ($(inIds[i])) $(inIds[i]).disabled = atMax || !canZoom();
    }
    var hud = $("zoomHud");
    if (hud) hud.hidden = !(placeholder && placeholder.hidden);
    var canShot = canCaptureShot();
    var shotIds = ["btnShot", "btnShotHud"];
    for (i = 0; i < shotIds.length; i++) {
      if ($(shotIds[i])) $(shotIds[i]).disabled = !canShot;
    }
  }

  function zoomAt(clientX, clientY, factor) {
    if (!canZoom()) return;
    var rect = zoomRectForPoint(clientX, clientY);
    var cx = clientX - rect.left - rect.width / 2;
    var cy = clientY - rect.top - rect.height / 2;
    var oldZoom = state.zoom || 1;
    var next = oldZoom * factor;
    if (next < ZOOM_MIN) next = ZOOM_MIN;
    if (next > ZOOM_MAX) next = ZOOM_MAX;
    if (Math.abs(next - 1) < 0.02) next = 1;
    if (next <= 1) {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      applyZoom();
      return;
    }
    var contentX = (cx - state.panX) / oldZoom;
    var contentY = (cy - state.panY) / oldZoom;
    state.zoom = next;
    state.panX = cx - contentX * next;
    state.panY = cy - contentY * next;
    applyZoom();
  }

  function zoomBy(factor) {
    if (!picture) return;
    var rect = zoomLayoutRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  function resetZoom() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
  }

  function applyPaneVisibility() {
    var compare = isCompare();
    var quad = isQuad();
    if (paneB) paneB.hidden = !compare;
    if (paneC) paneC.hidden = !quad;
    if (paneD) paneD.hidden = !quad;
    if (wipeDivider) wipeDivider.hidden = state.mode !== "wipe";
    if (picture) {
      picture.setAttribute("data-mode", state.mode);
      picture.setAttribute("data-compare", quad ? "4" : "2");
      picture.setAttribute("data-wipe", state.wipeAxis === "h" ? "h" : "v");
      if (state.mode === "sbs" && state.sbsSolo) picture.setAttribute("data-sbs-solo", state.sbsSolo);
      else picture.removeAttribute("data-sbs-solo");
    }
  }

  function setMode(mode) {
    var g = currentGroup();
    var n = g ? variantCount(g) : 0;
    if ((mode === "wipe" || mode === "sbs") && n < 2) mode = "single";
    state.mode = mode;
    state.sbsSolo = null;
    if (mode === "sbs" && state.compareCount === 4) ensureCDKeys(g);
    applyPaneVisibility();
    var tabs = document.querySelectorAll("#modeTabs .tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-mode") === mode);
    }
    lastPick.mode = state.mode;
    rememberPick();
    applySources(true);
    applyZoom();
    renderFpsChips();
    renderSlotPickers();
  }

  function setCompareCount(n) {
    n = n === 4 ? 4 : 2;
    var g = currentGroup();
    if (n === 4 && (!g || variantCount(g) < 2)) n = 2;
    state.compareCount = n;
    lastPick.compareCount = n;
    if (n !== 4 && (state.sbsSolo === "C" || state.sbsSolo === "D")) state.sbsSolo = null;
    if (n === 4) {
      ensureCDKeys(g);
      if (state.mode === "single" || state.mode === "wipe") {
        setMode("sbs");
        return;
      }
    }
    applyPaneVisibility();
    applySources(true);
    applyZoom();
    renderAll();
  }

  function ensureCDKeys(g) {
    if (!g) return;
    var fps = pickFpsForGroup(g, lastPick.fps);
    var cd = pickDefaultCD(g, state.keyA, state.keyB);
    if (!state.keyC || !g.variants[state.keyC]) {
      state.keyC = matchSlot(g, lastPick.resC, lastPick.techC, fps, cd.c);
    }
    if (!state.keyD || !g.variants[state.keyD]) {
      state.keyD = matchSlot(g, lastPick.resD, lastPick.techD, fps, cd.d);
    }
  }

    function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function toggleFullscreen() {
    var fs = fsElement();
    if (fs === picture || fs === stage) {
      if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    var el = picture;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }

  function updatePlaceholder() {
    var g = currentGroup();
    if (!g) {
      placeholder.hidden = false;
      placeholder.querySelector(".ph-kicker").textContent = "No clip selected";
      placeholderBody.textContent = state.hasFolder
        ? "Select a group in the library."
        : "Load video folder to play. Metadata is already here.";
      updateZoomUi();
      return;
    }
    if (!state.hasFolder || !groupOnDisk(g)) {
      placeholder.hidden = false;
      placeholder.querySelector(".ph-kicker").textContent = g.title || "Clip";
      placeholderBody.textContent = "Load video folder to play. Metadata is already here.";
      updateZoomUi();
      return;
    }
    placeholder.hidden = true;
    updateZoomUi();
  }

  function openGroup(id, keepMode) {
    var prevId = state.selectedId;
    var g = null;
    for (var i = 0; i < state.db.groups.length; i++) {
      if (state.db.groups[i].id === id) { g = state.db.groups[i]; break; }
    }
    state.selectedId = g ? g.id : null;
    if (!g || g.id !== prevId) resetZoom();
    if (g) {
      var ab = pickDefaultAB(g);
      var fps = pickFpsForGroup(g, lastPick.fps);
      var hasMemory = lastPick.resA != null || lastPick.techA != null || lastPick.resB != null;
      if (hasMemory) {
        state.keyA = matchSlot(g, lastPick.resA, lastPick.techA, fps, ab.a);
        state.keyB = matchSlot(g, lastPick.resB, lastPick.techB, fps, ab.b);
        if (state.keyB && state.keyB === state.keyA && ab.b && ab.b !== state.keyA) {
          var bAlt = matchSlot(g, lastPick.resB, lastPick.techB, fps, null);
          state.keyB = (bAlt && bAlt !== state.keyA) ? bAlt : ab.b;
        }
      } else {
        state.keyA = ab.a;
        state.keyB = ab.b;
      }
      var cd = pickDefaultCD(g, state.keyA, state.keyB);
      state.keyC = matchSlot(g, lastPick.resC, lastPick.techC, fps, cd.c);
      state.keyD = matchSlot(g, lastPick.resD, lastPick.techD, fps, cd.d);
      if (variantCount(g) < 2) {
        state.mode = "single";
        state.compareCount = 2;
        state.sbsSolo = null;
      } else {
        if (lastPick.mode === "wipe" || lastPick.mode === "sbs") state.mode = lastPick.mode;
        state.compareCount = lastPick.compareCount === 4 ? 4 : 2;
        state.wipeAxis = lastPick.wipeAxis === "h" ? "h" : "v";
      }
      rememberPick();
    } else {
      state.keyA = null;
      state.keyB = null;
      state.keyC = null;
      state.keyD = null;
    }
    applySources(false);
    renderAll();
  }

  function groupMatchesSearch(g, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if ((g.title || "").toLowerCase().indexOf(q) !== -1) return true;
    if ((g.notes || "").toLowerCase().indexOf(q) !== -1) return true;
    if ((g.license || "").toLowerCase().indexOf(q) !== -1) return true;
    var vs = g.variants || {};
    var keys = Object.keys(vs);
    for (var i = 0; i < keys.length; i++) {
      var v = vs[keys[i]];
      if ((v.file || "").toLowerCase().indexOf(q) !== -1) return true;
      if ((v.path || "").toLowerCase().indexOf(q) !== -1) return true;
      if ((v.tech || "").toLowerCase().indexOf(q) !== -1) return true;
      if ((v.resolution || "").toLowerCase().indexOf(q) !== -1) return true;
      if (formatFps(normFps(v)).indexOf(q) !== -1) return true;
    }
    return false;
  }

  function filteredGroups() {
    var list = (state.db.groups || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
    return list.filter(function (g) {
      if (state.catFilter === "all") { /* ok */ }
      else if (state.catFilter === "") {
        if (g.categoryId) return false;
      } else if (g.categoryId !== state.catFilter) return false;
      return groupMatchesSearch(g, state.search);
    });
  }

  function renderCatChips() {
    var cats = state.db.categories || [];
    var counts = { all: state.db.groups.length, "": 0 };
    cats.forEach(function (c) { counts[c.id] = 0; });
    state.db.groups.forEach(function (g) {
      var id = g.categoryId || "";
      if (counts[id] == null) counts[id] = 0;
      counts[id]++;
    });
    var html = '<button type="button" class="filter' + (state.catFilter === "all" ? " is-on" : "") + '" data-cat="all"><span class="dot" style="--chip:#d8dce4"></span>All <span class="n">' + counts.all + "</span></button>";
    cats.forEach(function (c) {
      var on = state.catFilter === c.id ? " is-on" : "";
      html += '<button type="button" class="filter' + on + '" data-cat="' + esc(c.id) + '" style="--chip:' + esc(c.color) + '"><span class="dot"></span>' + esc(c.name) + ' <span class="n">' + (counts[c.id] || 0) + "</span></button>";
    });
    if (counts[""]) {
      var onU = state.catFilter === "" ? " is-on" : "";
      html += '<button type="button" class="filter' + onU + '" data-cat="" style="--chip:' + UNCAT_COLOR + '"><span class="dot"></span>Uncategorized <span class="n">' + counts[""] + "</span></button>";
    }
    catChips.innerHTML = html;
  }

  function renderLibrary() {
    renderCatChips();
    var groups = filteredGroups();
    if (!groups.length) {
      libraryList.innerHTML = '<div class="lib-empty">Load a folder of MP4s named category-title-resolution[-tech].mp4</div>';
      return;
    }
    var html = "";
    groups.forEach(function (g) {
      var cat = catById(g.categoryId);
      var keys = sortVariantKeys(g);
      var dots = keys.map(function (k) {
        var v = g.variants[k];
        return '<span class="vdot ' + (v.tech ? "up" : "orig") + '" title="' + esc(variantLabel(v)) + '"></span>';
      }).join("");
      var offline = groupOnDisk(g) ? "" : '<span class="offline">offline / select folder</span>';
      var on = g.id === state.selectedId ? " is-on" : "";
      html += '<button type="button" class="group' + on + '" draggable="true" data-id="' + esc(g.id) + '" role="listitem">' +
        '<span class="group-tick" style="--cat:' + esc(cat.color) + '"></span>' +
        '<span><span class="group-title">' + esc(g.title || g.id) + '</span>' +
        '<span class="group-sub">' + dots + offline + "</span></span>" +
        '<span class="group-n">' + keys.length + "</span></button>";
    });
    libraryList.innerHTML = html;
  }

  function renderCompareTabs() {
    var g = currentGroup();
    var n = g ? variantCount(g) : 0;
    var tabs = document.querySelectorAll("#modeTabs .tab");
    var i;
    for (i = 0; i < tabs.length; i++) {
      var m = tabs[i].getAttribute("data-mode");
      tabs[i].disabled = (m === "wipe" || m === "sbs") && n < 2;
      tabs[i].classList.toggle("is-on", m === state.mode);
    }
    var countWrap = $("countTabs");
    if (countWrap) countWrap.style.display = state.mode === "single" ? "none" : "";
    var countTabs = document.querySelectorAll("#countTabs .tab");
    var quadOn = isQuad();
    for (i = 0; i < countTabs.length; i++) {
      var c = Number(countTabs[i].getAttribute("data-count"));
      countTabs[i].classList.toggle("is-on", (c === 4) === quadOn);
      countTabs[i].disabled = c === 4 && n < 2;
    }
    var swap = $("btnSwap");
    if (swap) swap.disabled = !state.keyB;
    renderWipeAxisTabs();
    applyPaneVisibility();
  }

  function currentFps() {
    var g = currentGroup();
    var v = g && g.variants[state.keyA];
    return normFps(v);
  }

  function groupFpsList(group) {
    var seen = {};
    var list = [];
    if (!group) return list;
    sortVariantKeys(group).forEach(function (k) {
      var v = group.variants[k];
      if (state.hasFolder && !variantOnDisk(v)) return;
      var f = normFps(v);
      var tag = formatFps(f);
      if (!seen[tag]) {
        seen[tag] = true;
        list.push(f);
      }
    });
    list.sort(function (a, b) { return a - b; });
    return list;
  }

  function findVariantAtFps(group, fromKey, fps) {
    if (!group) return null;
    var src = group.variants[fromKey] || {};
    var keys = sortVariantKeys(group).filter(function (k) {
      return Math.abs(normFps(group.variants[k]) - fps) < 0.05;
    });
    if (!keys.length) return null;
    function score(k) {
      var v = group.variants[k];
      var s = 0;
      if (v.resolution === src.resolution) s += 4;
      if ((v.tech || "") === (src.tech || "")) s += 2;
      if (variantOnDisk(v)) s += 1;
      return s;
    }
    keys.sort(function (a, b) { return score(b) - score(a); });
    return keys[0];
  }

  function setFps(fps) {
    var g = currentGroup();
    if (!g) return;
    if (Math.abs(currentFps() - fps) < 0.05 &&
        !(isCompare() && state.keyB && Math.abs(normFps(g.variants[state.keyB]) - fps) > 0.05)) {
      renderFpsChips();
      return;
    }
    var a = findVariantAtFps(g, state.keyA, fps);
    if (a) state.keyA = a;
    ["B", "C", "D"].forEach(function (slot) {
      var cur = keyForSlot(slot);
      if (!cur) return;
      if (slot !== "B" && !isQuad()) return;
      if (slot === "B" && !isCompare()) return;
      var next = findVariantAtFps(g, cur, fps);
      if (next) setKeyForSlot(slot, next);
    });
    applySources(true);
    rememberPick();
    renderAll();
  }

  function renderFpsChips() {
    var el = $("fpsChips");
    if (!el) return;
    var g = currentGroup();
    if (!g) { el.innerHTML = ""; return; }
    var list = groupFpsList(g);
    var cur = currentFps();
    el.innerHTML = list.map(function (f) {
      var on = Math.abs(f - cur) < 0.05 ? " is-a" : "";
      return '<button type="button" class="vchip orig' + on + '" data-fps="' + f + '">' + esc(formatFps(f)) + "</button>";
    }).join("");
  }

  function renderChipRow(el, items, selected, kind, slotMark) {
    if (!el) return;
    var onCls = " is-a";
    if (slotMark === "B") onCls = " is-b";
    else if (slotMark === "C") onCls = " is-c";
    else if (slotMark === "D") onCls = " is-d";
    el.innerHTML = items.map(function (item) {
      var value = item.value;
      var lab = item.label;
      var cls = "vchip " + (item.up ? "up" : "orig");
      if (value === selected) cls += onCls;
      var attr = kind === "res" ? "data-res" : "data-tech";
      return '<button type="button" class="' + cls + '" ' + attr + '="' + esc(value) + '">' + esc(lab) + "</button>";
    }).join("");
  }

  function renderSlotPickers() {
    var g = currentGroup();
    renderCompareTabs();
    if (!g) {
      ["A", "B", "C", "D"].forEach(function (slot) {
        renderChipRow($("resChips" + slot), [], "", "res", slot);
        renderChipRow($("techChips" + slot), [], "", "tech", slot);
      });
      return;
    }
    var fps = currentFps();
    var resItems = groupResList(g, fps).map(function (r) {
      return { value: r, label: r, up: false };
    });
    function techItems(res, current) {
      var list = groupTechList(g, fps, res).map(function (t) {
        return { value: t, label: techLabel(t), up: !!t };
      });
      if (current != null && !list.some(function (it) { return it.value === current; })) {
        list.push({ value: current, label: techLabel(current), up: !!current });
      }
      return list;
    }
    ["A", "B", "C", "D"].forEach(function (slot) {
      var v = g.variants[keyForSlot(slot)] || {};
      var res = v.resolution || "";
      var tech = v.tech || "";
      var items = resItems.slice();
      if (res && !items.some(function (it) { return it.value === res; })) {
        items.push({ value: res, label: res, up: false });
      }
      renderChipRow($("resChips" + slot), items, res, "res", slot);
      renderChipRow($("techChips" + slot), techItems(res, tech), tech, "tech", slot);
    });
  }

  function renderSpeeds() {
    var el = $("speeds");
    if (!el) return;
    el.innerHTML = SPEEDS.map(function (s) {
      var on = s === state.rate ? " is-on" : "";
      var lab = s === 1 ? "1×" : String(s);
      return '<button type="button" class="spd' + on + '" data-rate="' + s + '" aria-label="Speed ' + s + '">' + lab + "</button>";
    }).join("");
  }

  function renderInspector() {
    var g = currentGroup();
    var empty = $("inspectorEmpty");
    var form = $("inspectorForm");
    if (!g) {
      empty.hidden = false;
      form.hidden = true;
      return;
    }
    empty.hidden = true;
    form.hidden = false;
    $("fieldTitle").value = g.title || "";
    $("fieldLicense").value = g.license || "";
    $("fieldNotes").value = g.notes || "";
    var sel = $("fieldCategory");
    var opts = '<option value="">Uncategorized</option>';
    (state.db.categories || []).forEach(function (c) {
      opts += '<option value="' + esc(c.id) + '"' + (c.id === g.categoryId ? " selected" : "") + ">" + esc(c.name) + "</option>";
    });
    sel.innerHTML = opts;
    sel.value = g.categoryId || "";
    renderRenamePanel();
    var keys = sortVariantKeys(g);
    var list = $("variantList");
    if (!keys.length) {
      list.innerHTML = '<li class="var-path">No variants recorded.</li>';
      return;
    }
    list.innerHTML = keys.map(function (k) {
      var v = g.variants[k];
      var on = variantOnDisk(v);
      var cls = "var-row" + (k === state.keyA ? " is-a" : "") +
        (isCompare() && k === state.keyB ? " is-b" : "") +
        (isQuad() && k === state.keyC ? " is-c" : "") +
        (isQuad() && k === state.keyD ? " is-d" : "");
      var tech = v.tech ? esc(v.tech) : "original";
      var techCls = v.tech ? "up" : "orig";
      return '<li><div class="' + cls + '" data-key="' + esc(k) + '" role="button" tabindex="0">' +
        '<div class="var-file">' + esc(v.file || basename(v.path) || k) + "</div>" +
        '<div class="var-path">' + esc(v.path || v.file || "") + "</div>" +
        '<div class="var-meta">' +
        '<span class="badge">' + esc(v.resolution || "") + "</span>" +
        '<span class="badge">' + esc(formatFps(normFps(v))) + "</span>" +
        '<span class="badge ' + techCls + '">' + tech + "</span>" +
        (on ? '<span class="badge place">in place</span>' : '<span class="badge off">offline</span>') +
        '<span class="slot-btns">' +
        '<button type="button" data-set="A" data-key="' + esc(k) + '" class="' + (k === state.keyA ? "is-on" : "") + '">A</button>' +
        '<button type="button" data-set="B" data-key="' + esc(k) + '" class="' + (k === state.keyB ? "is-on" : "") + '">B</button>' +
        '<button type="button" data-set="C" data-key="' + esc(k) + '" class="' + (k === state.keyC ? "is-on" : "") + '">C</button>' +
        '<button type="button" data-set="D" data-key="' + esc(k) + '" class="' + (k === state.keyD ? "is-on" : "") + '">D</button>' +
        "</span></div></div></li>";
    }).join("");
  }

  function renderCatModal() {
    var list = $("catEditList");
    var palHtml = PALETTE.map(function (c) {
      return '<button type="button" class="pal" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>';
    }).join("");
    list.innerHTML = (state.db.categories || []).map(function (c) {
      return '<li class="cat-edit" data-id="' + esc(c.id) + '">' +
        '<span class="swatch" style="background:' + esc(c.color) + '"></span>' +
        '<input type="text" class="cat-id" value="' + esc(c.id) + '" maxlength="8" aria-label="Category id" spellcheck="false">' +
        '<input type="text" class="cat-name" value="' + esc(c.name) + '" aria-label="Category name">' +
        '<input type="color" class="cat-color" value="' + esc(c.color) + '" aria-label="Category colour">' +
        '<button type="button" class="icon-btn cat-del" title="Delete" aria-label="Delete category">✕</button>' +
        "</li>";
    }).join("");
  }

  function renderAll() {
    renderLibrary();
    renderInspector();
    renderFpsChips();
    renderSlotPickers();
    renderSpeeds();
    updatePlaceholder();
    updateMuteBtn();
    updatePlayBtn();
    var gNow = currentGroup();
    if (labelA) labelA.textContent = "A · " + variantLabel(gNow && gNow.variants[state.keyA]);
    if (labelB) labelB.textContent = "B · " + variantLabel(gNow && gNow.variants[state.keyB]);
    if (labelC) labelC.textContent = "C · " + variantLabel(gNow && gNow.variants[state.keyC]);
    if (labelD) labelD.textContent = "D · " + variantLabel(gNow && gNow.variants[state.keyD]);
    setWipe(state.wipe);
    applyZoom();
    applyPaneVisibility();
    renderCompareTabs();
  }

  function updateSlotLabels(g) {
    g = g || currentGroup();
    if (labelA) labelA.textContent = "A · " + variantLabel(g && g.variants[state.keyA]);
    if (labelB) labelB.textContent = "B · " + variantLabel(g && g.variants[state.keyB]);
    if (labelC) labelC.textContent = "C · " + variantLabel(g && g.variants[state.keyC]);
    if (labelD) labelD.textContent = "D · " + variantLabel(g && g.variants[state.keyD]);
  }

  function setVariant(slot, key) {
    var g = currentGroup();
    if (!g || !g.variants[key]) return;
    setKeyForSlot(slot, key);
    if (slot === "B" && state.mode === "single") {
      setMode("wipe");
    } else if ((slot === "C" || slot === "D") && !isQuad()) {
      state.compareCount = 4;
      lastPick.compareCount = 4;
      if (state.mode === "single" || state.mode === "wipe") setMode("sbs");
      else {
        ensureCDKeys(g);
        applyPaneVisibility();
        applySources(true);
      }
    } else {
      applySources(true);
    }
    rememberPick();
    renderSlotPickers();
    renderInspector();
    updateSlotLabels(g);
  }

  function setSlotRes(slot, res) {
    var g = currentGroup();
    if (!g || !res) return;
    var cur = g.variants[keyForSlot(slot)] || {};
    var fps = currentFps();
    var next = findVariantKey(g, res, fps, cur.tech || "") || findBestAtResFps(g, res, fps, cur.tech || "");
    if (next) setVariant(slot, next);
  }

  function setSlotTech(slot, tech) {
    var g = currentGroup();
    if (!g) return;
    var cur = g.variants[keyForSlot(slot)] || {};
    var fps = currentFps();
    var next = findVariantKey(g, cur.resolution || "", fps, tech);
    if (next) setVariant(slot, next);
  }

  function swapAB() {
    if (!state.keyB) return;
    var ka = state.keyA;
    state.keyA = state.keyB;
    state.keyB = ka;
    if (isQuad() && state.keyC && state.keyD) {
      var kc = state.keyC;
      state.keyC = state.keyD;
      state.keyD = kc;
    }
    rememberPick();
    applySources(true);
    renderAll();
  }

  function canCaptureShot() {
    return !!(picture && placeholder && placeholder.hidden && videoA && videoA.getAttribute("src"));
  }

  function fileSafe(s) {
    return String(s || "")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "clip";
  }

  function stampNow() {
    var d = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  }

  function slotFileTag(v) {
    if (!v) return "none";
    return fileSafe(v.resolution || "clip") + "-" + fileSafe(techLabel(v.tech));
  }

  function zoomFileTag() {
    return fileSafe(String(formatZoom(state.zoom)).replace(/×/g, "x"));
  }

  function screenshotFilename() {
    var g = currentGroup();
    var name = fileSafe((g && g.title) || "clip");
    var va = g && g.variants[state.keyA];
    var vb = g && g.variants[state.keyB];
    var left = slotFileTag(va);
    var zoom = zoomFileTag();
    var ts = stampNow();
    if (isSbsSolo()) {
      var sv = g && g.variants[keyForSlot(state.sbsSolo)];
      return name + "-solo-" + state.sbsSolo + "-" + slotFileTag(sv) + "-" + zoom + "-" + ts + ".png";
    }
    if (isQuad()) {
      var vc = g && g.variants[state.keyC];
      var vd = g && g.variants[state.keyD];
      return name + "-A-" + left + "-B-" + slotFileTag(vb) + "-C-" + slotFileTag(vc) + "-D-" + slotFileTag(vd) + "-" + zoom + "-" + ts + ".png";
    }
    if (state.mode === "single" || !vb) return name + "-left-" + left + "-" + zoom + "-" + ts + ".png";
    return name + "-left-" + left + "-right-" + slotFileTag(vb) + "-" + zoom + "-" + ts + ".png";
  }

  function paneBoxCss(el, picRect) {
    if (!el) return { x: 0, y: 0, w: picRect.width, h: picRect.height };
    var r = el.getBoundingClientRect();
    return {
      x: r.left - picRect.left,
      y: r.top - picRect.top,
      w: r.width,
      h: r.height
    };
  }

  function drawVideoInPane(ctx, video, pane) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(pane.x, pane.y, pane.w, pane.h);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(pane.x, pane.y, pane.w, pane.h);
    var vw = video && video.videoWidth;
    var vh = video && video.videoHeight;
    if (video && vw && vh) {
      var cx = pane.x + pane.w / 2;
      var cy = pane.y + pane.h / 2;
      ctx.translate(cx + (state.panX || 0), cy + (state.panY || 0));
      ctx.scale(state.zoom || 1, state.zoom || 1);
      ctx.translate(-cx, -cy);
      var scale = Math.min(pane.w / vw, pane.h / vh);
      var dw = vw * scale;
      var dh = vh * scale;
      var dx = pane.x + (pane.w - dw) / 2;
      var dy = pane.y + (pane.h - dh) / 2;
      try { ctx.drawImage(video, dx, dy, dw, dh); } catch (err) {}
    }
    ctx.restore();
  }

  function drawShotLabel(ctx, text, x, y, align, color, fontPx) {
    ctx.save();
    ctx.font = "700 " + fontPx + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    var label = String(text || "").toUpperCase();
    var padX = Math.round(fontPx * 0.55);
    var padY = Math.round(fontPx * 0.32);
    var tw = ctx.measureText(label).width;
    var bw = tw + padX * 2;
    var bh = fontPx + padY * 2;
    var bx = x;
    if (align === "right") bx = x - bw;
    else if (align === "center") bx = x - bw / 2;
    ctx.fillStyle = "rgba(8,9,12,0.82)";
    ctx.strokeStyle = "#262b35";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, y, bw, bh, 3);
    else ctx.rect(bx, y, bw, bh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, bx + padX, y + padY);
    ctx.restore();
  }

  function exportScreenshot() {
    if (!canCaptureShot()) {
      alert("Load a video first, then capture a screenshot.");
      return;
    }
    var picRect = picture.getBoundingClientRect();
    var w = picRect.width;
    var h = picRect.height;
    if (!w || !h) return;
    var dpr = window.devicePixelRatio || 1;
    if (dpr > 2) dpr = 2;
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    var boxA = paneBoxCss(paneA, picRect);
    var boxB = paneBoxCss(paneB, picRect);
    var boxC = paneBoxCss(paneC, picRect);
    var boxD = paneBoxCss(paneD, picRect);
    var g = currentGroup();
    var va = g && g.variants[state.keyA];
    var vb = g && g.variants[state.keyB];
    var vc = g && g.variants[state.keyC];
    var vd = g && g.variants[state.keyD];
    var compare = isCompare();
    var quad = isQuad();

    var soloVid = { A: videoA, B: videoB, C: videoC, D: videoD };
    var soloVar = { A: va, B: vb, C: vc, D: vd };
    var soloColor = { A: "#6ea8fe", B: "#e8a838", C: "#5eead4", D: "#a78bfa" };
    var soloAlign = { A: "left", B: "right", C: "left", D: "right" };

    if (state.mode === "wipe") {
      drawVideoInPane(ctx, videoB, { x: 0, y: 0, w: w, h: h });
      ctx.save();
      ctx.beginPath();
      if (state.wipeAxis === "h") ctx.rect(0, 0, w, h * (state.wipe / 100));
      else ctx.rect(0, 0, w * (state.wipe / 100), h);
      ctx.clip();
      drawVideoInPane(ctx, videoA, { x: 0, y: 0, w: w, h: h });
      ctx.restore();
      ctx.fillStyle = "#f2f4f8";
      if (state.wipeAxis === "h") {
        var hy = h * (state.wipe / 100);
        ctx.fillRect(0, hy - 1, w, 2);
      } else {
        var wx = w * (state.wipe / 100);
        ctx.fillRect(wx - 1, 0, 2, h);
      }
    } else if (isSbsSolo()) {
      drawVideoInPane(ctx, soloVid[state.sbsSolo], { x: 0, y: 0, w: w, h: h });
    } else if (quad) {
      drawVideoInPane(ctx, videoA, boxA);
      drawVideoInPane(ctx, videoB, boxB);
      drawVideoInPane(ctx, videoC, boxC);
      drawVideoInPane(ctx, videoD, boxD);
    } else if (state.mode === "sbs") {
      drawVideoInPane(ctx, videoA, boxA);
      drawVideoInPane(ctx, videoB, boxB);
      ctx.fillStyle = "#262b35";
      ctx.fillRect(boxA.x + boxA.w, 0, Math.max(1, boxB.x - (boxA.x + boxA.w)), h);
    } else {
      drawVideoInPane(ctx, videoA, { x: 0, y: 0, w: w, h: h });
    }

    var fontPx = Math.max(24, Math.round(h * 0.032));
    var margin = Math.max(12, Math.round(fontPx * 0.45));
    var zoomPadY = Math.round(fontPx * 0.32);
    var zoomBh = fontPx + zoomPadY * 2;
    if (isSbsSolo()) {
      var labX = soloAlign[state.sbsSolo] === "right" ? w - margin : margin;
      drawShotLabel(ctx, state.sbsSolo + " · " + variantLabel(soloVar[state.sbsSolo]), labX, margin, soloAlign[state.sbsSolo], soloColor[state.sbsSolo], fontPx);
    } else if (quad) {
      drawShotLabel(ctx, "A · " + variantLabel(va), boxA.x + margin, boxA.y + margin, "left", "#6ea8fe", fontPx);
      drawShotLabel(ctx, "B · " + variantLabel(vb), boxB.x + boxB.w - margin, boxB.y + margin, "right", "#e8a838", fontPx);
      drawShotLabel(ctx, "C · " + variantLabel(vc), boxC.x + margin, boxC.y + margin, "left", "#5eead4", fontPx);
      drawShotLabel(ctx, "D · " + variantLabel(vd), boxD.x + boxD.w - margin, boxD.y + margin, "right", "#a78bfa", fontPx);
    } else {
      drawShotLabel(ctx, "A · " + variantLabel(va), margin, margin, "left", "#6ea8fe", fontPx);
      if (compare) {
        if (state.mode === "wipe" && state.wipeAxis === "h") {
          drawShotLabel(ctx, "B · " + variantLabel(vb), w - margin, h - margin - zoomBh, "right", "#e8a838", fontPx);
        } else {
          drawShotLabel(ctx, "B · " + variantLabel(vb), w - margin, margin, "right", "#e8a838", fontPx);
        }
      }
    }
    drawShotLabel(ctx, formatZoom(state.zoom), w / 2, h - margin - zoomBh, "center", "#d8dce4", fontPx);

    var filename = screenshotFilename();
    function fail() { alert("Could not capture this frame."); }
    if (!canvas.toBlob) {
      try {
        var url = canvas.toDataURL("image/png");
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) { fail(); return; }
      flashShotStatus(filename);
      return;
    }
    canvas.toBlob(function (blob) {
      if (!blob) { fail(); return; }
      downloadBlob(blob, filename);
      flashShotStatus(filename);
    }, "image/png");
  }

  function flashShotStatus(filename) {
    if (!saveStatus) return;
    saveStatus.textContent = "Screenshot · " + filename;
    saveStatus.className = "save-pill flash";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { updateSavePill(false); }, 1800);
  }

  function persistInspectorFields() {
    var g = currentGroup();
    if (!g) return;
    g.title = $("fieldTitle").value;
    g.categoryId = $("fieldCategory").value;
    g.license = $("fieldLicense").value;
    g.notes = $("fieldNotes").value;
    saveDbDebounced();
    renderLibrary();
  }

  function forgetGroupFiles(id) {
    var drop = [];
    fileMap.forEach(function (file, path) {
      var parsed = parseFilename(file.name, state.db.categories);
      if (parsed && parsed.groupId === id) drop.push(path);
    });
    drop.forEach(function (path) {
      var file = fileMap.get(path);
      fileMap.delete(path);
      handleMap.delete(path);
      if (file) {
        fileByName.delete(file.name);
        fileByName.delete(String(file.name).toLowerCase());
      }
      if (urlMap.has(path)) {
        try { URL.revokeObjectURL(urlMap.get(path)); } catch (err) {}
        urlMap.delete(path);
      }
    });
  }

  function deleteGroupMeta() {
    var g = currentGroup();
    if (!g) return;
    if (!confirm("Remove “" + (g.title || g.id) + "” from the library? Video files on disk are not deleted. Load the folder again to re-import them.")) return;
    var id = g.id;
    forgetGroupFiles(id);
    state.db.groups = state.db.groups.filter(function (x) { return x.id !== id; });
    if (state.selectedId === id) {
      state.selectedId = null;
      state.keyA = null;
      state.keyB = null;
      state.keyC = null;
      state.keyD = null;
    }
    saveDb(true);
    applySources(false);
    renderAll();
  }

  function reorderGroups(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    var arr = state.db.groups.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var fromIdx = -1, toIdx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === fromId) fromIdx = i;
      if (arr[i].id === toId) toIdx = i;
    }
    if (fromIdx < 0 || toIdx < 0) return;
    var moved = arr.splice(fromIdx, 1)[0];
    arr.splice(toIdx, 0, moved);
    arr.forEach(function (g, i) { g.order = i; });
    saveDb(true);
    renderLibrary();
  }

  function addCategory(id, name, color) {
    id = String(id || "").trim();
    if (!/^[A-Za-z0-9]+$/.test(id)) {
      alert("Category id must be letters or digits.");
      return false;
    }
    var exists = state.db.categories.some(function (c) { return c.id.toLowerCase() === id.toLowerCase(); });
    if (exists) {
      alert("That id is already in use.");
      return false;
    }
    state.db.categories.push({ id: id, name: name || id, color: color || UNCAT_COLOR });
    saveDb(true);
    renderCatModal();
    renderAll();
    return true;
  }

  function updateCategory(oldId, next) {
    var cat = null;
    for (var i = 0; i < state.db.categories.length; i++) {
      if (state.db.categories[i].id === oldId) { cat = state.db.categories[i]; break; }
    }
    if (!cat) return;
    if (next.id && next.id !== oldId) {
      if (!/^[A-Za-z0-9]+$/.test(next.id)) return;
      var clash = state.db.categories.some(function (c) { return c.id === next.id && c !== cat; });
      if (clash) {
        alert("That id is already in use.");
        renderCatModal();
        return;
      }
      state.db.groups.forEach(function (g) {
        if (g.categoryId === oldId) g.categoryId = next.id;
      });
      cat.id = next.id;
    }
    if (next.name != null) cat.name = next.name;
    if (next.color != null) cat.color = next.color;
    saveDbDebounced();
    renderAll();
  }

  function deleteCategory(id) {
    var cat = catById(id);
    if (!confirm("Delete category “" + cat.name + "”? Groups move to Uncategorized.")) return;
    state.db.groups.forEach(function (g) {
      if (g.categoryId === id) g.categoryId = "";
    });
    state.db.categories = state.db.categories.filter(function (c) { return c.id !== id; });
    if (state.catFilter === id) state.catFilter = "all";
    saveDb(true);
    renderCatModal();
    renderAll();
  }

  function stampBackupName() {
    return "videos-backup-" + stampNow() + ".json";
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  function downloadJsonText(text, filename) {
    downloadBlob(new Blob([text], { type: "application/json" }), filename || "videos.json");
  }

  function exportJson() {
    var text = stringifyDb(state.db);
    lastExportJson = text;
    downloadJsonText(text, "videos.json");
    updateSavePill(false);
    saveStatus.textContent = "Exported · videos.json";
    saveStatus.className = "save-pill flash";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { updateSavePill(false); }, 1200);
  }

  function clearAllData() {
    if (!confirm("Download a backup of the library, then clear all saved clip data?\n\nCategories are kept. Video files on disk are not deleted.")) return;
    downloadJsonText(stringifyDb(state.db), stampBackupName());
    var keptCats = clone((state.db && state.db.categories) || []);
    if (!keptCats.length) keptCats = clone(DEFAULT_DB.categories);
    var keptSettings = (state.db && state.db.settings && typeof state.db.settings === "object")
      ? clone(state.db.settings)
      : {};
    revokeAllUrls();
    fileMap.clear();
    fileByName.clear();
    handleMap.clear();
    rootDirHandle = null;
    state.hasFolder = false;
    state.canWrite = false;
    state.selectedId = null;
    state.keyA = null;
    state.keyB = null;
    state.keyC = null;
    state.keyD = null;
    state.mode = "single";
    state.compareCount = 2;
    state.catFilter = "all";
    state.search = "";
    state.rate = 1;
    state.muted = false;
    state.wipe = 50;
    state.wipeAxis = "v";
    state.sbsSolo = null;
    clearLastPick();
    resetZoom();
    var search = $("search");
    if (search) search.value = "";
    pauseBoth();
    state.db = normalizeDb({
      categories: keptCats,
      groups: [],
      settings: keptSettings
    });
    saveDb(true);
    applySources(false);
    renderAll();
    if (saveStatus) {
      saveStatus.textContent = "Cleared · backup downloaded";
      saveStatus.className = "save-pill flash";
    }
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { updateSavePill(false); }, 1600);
  }

  function importJsonFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var incoming = JSON.parse(String(reader.result || ""));
        state.db = mergeDb(state.db, incoming);
        saveDb(true);
        if (state.selectedId) {
          var still = state.db.groups.some(function (g) { return g.id === state.selectedId; });
          if (!still) state.selectedId = null;
        }
        renderAll();
        if (state.selectedId) applySources(true);
      } catch (err) {
        alert("Could not import that JSON file.");
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    $("btnLoadFolder").addEventListener("click", function () {
      if (typeof window.showDirectoryPicker === "function") {
        window.showDirectoryPicker({ mode: "readwrite" }).then(function (dir) {
          return ingestDirectoryHandle(dir);
        }).catch(function (err) {
          if (err && err.name === "AbortError") return;
          $("folderInput").click();
        });
        return;
      }
      $("folderInput").click();
    });
    $("folderInput").addEventListener("change", function (e) {
      scanFolder(e.target.files);
      e.target.value = "";
    });
    $("btnImport").addEventListener("click", function () { $("jsonInput").click(); });
    $("jsonInput").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      importJsonFile(f);
      e.target.value = "";
    });
    $("btnExport").addEventListener("click", exportJson);
    $("btnClearData").addEventListener("click", clearAllData);
    $("btnCategories").addEventListener("click", function () {
      renderCatModal();
      $("catModal").hidden = false;
    });
    $("catModal").addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute("data-close") === "modal") $("catModal").hidden = true;
    });
    $("catAddForm").addEventListener("submit", function (e) {
      e.preventDefault();
      if (addCategory($("newCatId").value, $("newCatName").value, $("newCatColor").value)) {
        $("newCatId").value = "";
        $("newCatName").value = "";
      }
    });
    $("catEditList").addEventListener("change", function (e) {
      var row = e.target.closest(".cat-edit");
      if (!row) return;
      var oldId = row.getAttribute("data-id");
      updateCategory(oldId, {
        id: row.querySelector(".cat-id").value.trim(),
        name: row.querySelector(".cat-name").value,
        color: row.querySelector(".cat-color").value
      });
      row.setAttribute("data-id", row.querySelector(".cat-id").value.trim() || oldId);
    });
    $("catEditList").addEventListener("click", function (e) {
      var del = e.target.closest(".cat-del");
      if (!del) return;
      var row = del.closest(".cat-edit");
      if (row) deleteCategory(row.getAttribute("data-id"));
    });

    $("search").addEventListener("input", function (e) {
      state.search = e.target.value;
      renderLibrary();
    });

    catChips.addEventListener("click", function (e) {
      var btn = e.target.closest(".filter");
      if (!btn) return;
      state.catFilter = btn.getAttribute("data-cat");
      if (state.catFilter === "all") state.catFilter = "all";
      renderLibrary();
    });

    libraryList.addEventListener("click", function (e) {
      var item = e.target.closest(".group");
      if (!item) return;
      openGroup(item.getAttribute("data-id"), true);
    });
    libraryList.addEventListener("dragstart", function (e) {
      var item = e.target.closest(".group");
      if (!item) return;
      state.draggingId = item.getAttribute("data-id");
      item.classList.add("is-drag");
      try { e.dataTransfer.setData("text/plain", state.draggingId); } catch (err) {}
      e.dataTransfer.effectAllowed = "move";
    });
    libraryList.addEventListener("dragend", function (e) {
      var item = e.target.closest(".group");
      if (item) item.classList.remove("is-drag");
      state.draggingId = null;
    });
    libraryList.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    libraryList.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var item = e.target.closest(".group");
      var toId = item ? item.getAttribute("data-id") : null;
      var fromId = state.draggingId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      reorderGroups(fromId, toId);
    });

    $("modeTabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab || tab.disabled) return;
      setMode(tab.getAttribute("data-mode"));
    });
    $("countTabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab || tab.disabled) return;
      setCompareCount(Number(tab.getAttribute("data-count")));
    });
    $("wipeAxisTabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab || tab.disabled) return;
      setWipeAxis(tab.getAttribute("data-axis"));
    });

    $("fpsChips").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-fps]");
      if (!chip) return;
      setFps(Number(chip.getAttribute("data-fps")));
    });

    $("slotPickers").addEventListener("click", function (e) {
      var chip = e.target.closest(".vchip");
      if (!chip) return;
      var pick = chip.closest(".slot-pick");
      var slot = pick && pick.getAttribute("data-slot");
      if (!slot) return;
      if (chip.hasAttribute("data-res")) setSlotRes(slot, chip.getAttribute("data-res"));
      else if (chip.hasAttribute("data-tech")) setSlotTech(slot, chip.getAttribute("data-tech") || "");
    });
    $("btnSwap").addEventListener("click", swapAB);

    $("speeds").addEventListener("click", function (e) {
      var b = e.target.closest(".spd");
      if (!b) return;
      setRate(Number(b.getAttribute("data-rate")));
    });

    btnPlay.addEventListener("click", playPause);
    $("btnPrevFrame").addEventListener("click", function () { frameStep(-1); });
    $("btnNextFrame").addEventListener("click", function () { frameStep(1); });
    btnMute.addEventListener("click", function () {
      state.muted = !state.muted;
      videoA.muted = state.muted;
      updateMuteBtn();
    });
    $("btnShot").addEventListener("click", exportScreenshot);
    if ($("btnShotHud")) $("btnShotHud").addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      exportScreenshot();
    });
    $("btnFs").addEventListener("click", toggleFullscreen);
    function onFsChange() {
      var on = fsElement() === picture || fsElement() === stage;
      document.documentElement.classList.toggle("is-fs", on);
      picture.classList.toggle("is-fs", on);
      applyZoom();
    }
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    window.addEventListener("resize", function () {
      if (state.zoom > 1) applyZoom();
    });

    function bindZoomBtn(id, fn) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    }
    bindZoomBtn("btnZoomIn", function () { zoomBy(ZOOM_STEP); });
    bindZoomBtn("btnZoomInBar", function () { zoomBy(ZOOM_STEP); });
    bindZoomBtn("btnZoomOut", function () { zoomBy(1 / ZOOM_STEP); });
    bindZoomBtn("btnZoomOutBar", function () { zoomBy(1 / ZOOM_STEP); });
    bindZoomBtn("btnZoomReset", resetZoom);
    bindZoomBtn("btnZoomResetBar", resetZoom);

    seek.addEventListener("input", function () {
      seeking = true;
      var t = Number(seek.value);
      try { videoA.currentTime = t; } catch (err) {}
      forEachCompareVideo(function (v) {
        try { v.currentTime = t; } catch (err) {}
      });
      updateTransport();
    });
    seek.addEventListener("change", function () { seeking = false; });

    picture.addEventListener("dblclick", function (e) {
      if (e.target === wipeDivider || (e.target && e.target.closest && e.target.closest(".wipe-divider"))) return;
      if (e.target && e.target.closest && e.target.closest(".zoom-hud")) return;
      if (state.zoom > 1.001) {
        resetZoom();
        return;
      }
      toggleFullscreen();
    });

    picture.addEventListener("wheel", function (e) {
      if (!canZoom()) return;
      if (e.target && e.target.closest && e.target.closest(".zoom-hud")) return;
      e.preventDefault();
      var factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });

    picture.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      if (state.zoom <= 1.001) return;
      if (e.target === wipeDivider || (e.target && e.target.closest && e.target.closest(".wipe-divider"))) return;
      if (e.target && e.target.closest && e.target.closest(".zoom-hud")) return;
      panDrag.on = true;
      panDrag.pointerId = e.pointerId;
      panDrag.sx = e.clientX;
      panDrag.sy = e.clientY;
      panDrag.ox = state.panX;
      panDrag.oy = state.panY;
      picture.classList.add("is-panning");
      try { picture.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    picture.addEventListener("pointermove", function (e) {
      if (!panDrag.on) return;
      state.panX = panDrag.ox + (e.clientX - panDrag.sx);
      state.panY = panDrag.oy + (e.clientY - panDrag.sy);
      applyZoom();
    });
    function endPan(e) {
      if (!panDrag.on) return;
      if (e && panDrag.pointerId && e.pointerId !== panDrag.pointerId) return;
      panDrag.on = false;
      picture.classList.remove("is-panning");
      try { picture.releasePointerCapture(panDrag.pointerId); } catch (err) {}
    }
    picture.addEventListener("pointerup", endPan);
    picture.addEventListener("pointercancel", endPan);
    picture.addEventListener("dragstart", function (e) { e.preventDefault(); });

    wipeDivider.addEventListener("pointerdown", function (e) {
      state.wiping = true;
      wipeDivider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wipeDivider.addEventListener("pointermove", function (e) {
      if (!state.wiping) return;
      var rect = picture.getBoundingClientRect();
      if (state.wipeAxis === "h") {
        if (!rect.height) return;
        setWipe(((e.clientY - rect.top) / rect.height) * 100);
      } else {
        if (!rect.width) return;
        setWipe(((e.clientX - rect.left) / rect.width) * 100);
      }
    });
    function endWipe(e) {
      state.wiping = false;
      try { wipeDivider.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    wipeDivider.addEventListener("pointerup", endWipe);
    wipeDivider.addEventListener("pointercancel", endWipe);

    videoA.addEventListener("timeupdate", function () {
      syncVideos(false);
      updateTransport();
    });
    videoA.addEventListener("seeked", function () { syncVideos(true); updateTransport(); });
    videoA.addEventListener("play", function () {
      forEachCompareVideo(function (v) {
        if (v.getAttribute("src") && v.paused) v.play().catch(function () {});
      });
      updatePlayBtn();
    });
    videoA.addEventListener("pause", function () {
      forEachCompareVideo(function (v) {
        if (!v.paused) {
          try { v.pause(); } catch (err) {}
        }
      });
      updatePlayBtn();
    });
    videoA.addEventListener("loadedmetadata", updateTransport);
    videoB.addEventListener("seeked", function () { syncing = false; });
    if (videoC) videoC.addEventListener("seeked", function () { syncing = false; });
    if (videoD) videoD.addEventListener("seeked", function () { syncing = false; });
    videoA.addEventListener("ratechange", function () {
      forEachCompareVideo(function (v) {
        try { v.playbackRate = videoA.playbackRate; } catch (err) {}
      });
    });
    videoA.addEventListener("ended", updatePlayBtn);

    $("fieldTitle").addEventListener("input", persistInspectorFields);
    $("fieldLicense").addEventListener("input", persistInspectorFields);
    $("fieldNotes").addEventListener("input", persistInspectorFields);
    $("fieldCategory").addEventListener("change", persistInspectorFields);
    $("btnDeleteGroup").addEventListener("click", deleteGroupMeta);
    $("fieldRenameSlug").addEventListener("input", renderRenamePanel);
    $("btnRenameFiles").addEventListener("click", renameGroupFiles);

    $("variantList").addEventListener("click", function (e) {
      var setBtn = e.target.closest("[data-set]");
      if (setBtn) {
        e.preventDefault();
        e.stopPropagation();
        setVariant(setBtn.getAttribute("data-set"), setBtn.getAttribute("data-key"));
        return;
      }
      var row = e.target.closest(".var-row");
      if (!row) return;
      var key = row.getAttribute("data-key");
      if (state.mode === "single") setVariant("A", key);
      else setVariant("A", key);
    });

    document.addEventListener("keydown", function (e) {
      if (isTypingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        playPause();
      } else if (e.code === "F8") {
        e.preventDefault();
        playBoth();
      } else if (e.code === "F9") {
        e.preventDefault();
        pauseBoth();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) jumpSeconds(-1);
        else frameStep(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) jumpSeconds(1);
        else frameStep(1);
      } else if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (state.mode !== "sbs") return;
        var numSlot = ({ "1": "A", "2": "B", "3": "C", "4": "D" })[e.key];
        if (sbsSoloOrder().indexOf(numSlot) === -1) return;
        e.preventDefault();
        toggleSbsSolo(numSlot);
      } else if (e.key === "a" || e.key === "A" || e.key === "b" || e.key === "B" || e.key === "c" || e.key === "C" || e.key === "d" || e.key === "D") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (state.mode !== "sbs") return;
        var letterSlot = e.key.toUpperCase();
        if (sbsSoloOrder().indexOf(letterSlot) === -1) return;
        e.preventDefault();
        toggleSbsSolo(letterSlot);
      } else if (e.key === "]" || e.code === "BracketRight") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (state.mode !== "sbs") return;
        e.preventDefault();
        cycleSbsSolo(1);
      } else if (e.key === "[" || e.code === "BracketLeft") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (state.mode !== "sbs") return;
        e.preventDefault();
        cycleSbsSolo(-1);
      } else if (e.key === "f" || e.key === "F") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "+" || e.key === "=" || e.code === "NumpadAdd") {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        zoomBy(ZOOM_STEP);
      } else if (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract") {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
      } else if (e.key === "0" || e.code === "Numpad0") {
        if (e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        resetZoom();
      } else if (e.key === "s" || e.key === "S") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        exportScreenshot();
      } else if (e.key === "Escape") {
        if (state.mode === "sbs" && state.sbsSolo) {
          e.preventDefault();
          setSbsSolo(null);
        }
        $("catModal").hidden = true;
      }
    });

    function isFileDrag(dt) {
      if (!dt) return false;
      var types = dt.types;
      if (!types) return false;
      for (var i = 0; i < types.length; i++) if (types[i] === "Files") return true;
      return false;
    }
    document.addEventListener("dragover", function (e) {
      if (state.draggingId || !isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      dropOverlay.hidden = false;
    });
    document.addEventListener("dragleave", function (e) {
      if (e.relatedTarget == null || e.target === document.documentElement) dropOverlay.hidden = true;
    });
    document.addEventListener("drop", function (e) {
      dropOverlay.hidden = true;
      if (state.draggingId || !isFileDrag(e.dataTransfer)) return;
      e.preventDefault();
      var items = e.dataTransfer && e.dataTransfer.items ? Array.prototype.slice.call(e.dataTransfer.items) : [];
      var handlePs = items.map(function (it) {
        if (it && typeof it.getAsFileSystemHandle === "function") {
          try { return it.getAsFileSystemHandle(); } catch (err) { return Promise.resolve(null); }
        }
        return Promise.resolve(null);
      });
      Promise.all(handlePs).then(function (handles) {
        var dirs = (handles || []).filter(function (h) { return h && h.kind === "directory"; });
        if (dirs.length === 1) return ingestDirectoryHandle(dirs[0]);
        return filesFromDrop(e.dataTransfer).then(function (files) { scanFolder(files); });
      }).catch(function () {
        filesFromDrop(e.dataTransfer).then(function (files) { scanFolder(files); });
      });
    });
  }

  function cacheDom() {
    videoA = $("videoA");
    videoB = $("videoB");
    videoC = $("videoC");
    videoD = $("videoD");
    paneA = $("paneA");
    paneB = $("paneB");
    paneC = $("paneC");
    paneD = $("paneD");
    missingA = $("missingA");
    missingB = $("missingB");
    missingC = $("missingC");
    missingD = $("missingD");
    labelA = $("labelA");
    labelB = $("labelB");
    labelC = $("labelC");
    labelD = $("labelD");
    picture = $("picture");
    stage = $("stage");
    placeholder = $("placeholder");
    placeholderBody = $("placeholderBody");
    wipeDivider = $("wipeDivider");
    seek = $("seek");
    timeLabel = $("timeLabel");
    btnPlay = $("btnPlay");
    btnMute = $("btnMute");
    saveStatus = $("saveStatus");
    libraryList = $("libraryList");
    catChips = $("catChips");
    dropOverlay = $("dropOverlay");
  }

  function loadInitialDb() {
    var db = clone(DEFAULT_DB);
    var fetchedSnap = stringifyDb(db);
    var p = Promise.resolve();
    try {
      p = fetch("./videos.json").then(function (res) {
        if (!res.ok) return null;
        return res.json();
      }).then(function (json) {
        if (json) {
          db = json;
          fetchedSnap = stringifyDb(normalizeDb(db));
        }
      }).catch(function () {});
    } catch (err) {}
    return p.then(function () {
      var fromLs = false;
      try {
        var raw = localStorage.getItem(LS_KEY);
        if (raw) {
          db = JSON.parse(raw);
          fromLs = true;
        }
      } catch (err) {}
      state.db = normalizeDb(db);
      lastExportJson = fetchedSnap;
      if (!fromLs) lastExportJson = stringifyDb(state.db);
    });
  }

  function init() {
    if (booted) return;
    booted = true;
    cacheDom();
    if (!videoA || !videoB || !videoC || !videoD) return;
    bindEvents();
    renderSpeeds();
    setWipe(50);
    loadInitialDb().then(function () {
      renderAll();
      updateSavePill(false);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
