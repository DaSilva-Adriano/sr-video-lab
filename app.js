/* SR Video Lab — vanilla file:// app. Chrome only. Videos never copied. */
(function () {
  "use strict";

  var LS_KEY = "sr-video-lab-db";
  var FRAME_DT = 1 / 24;
  var DRIFT = 0.08;
  var SPEEDS = [0.25, 0.5, 1, 1.5, 2];
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

  var videoA, videoB, paneA, paneB, missingA, missingB, labelA, labelB;
  var picture, stage, placeholder, placeholderBody, wipeDivider;
  var seek, timeLabel, btnPlay, btnMute, saveStatus;
  var libraryList, catChips, variantChips, selectA, selectB, dropOverlay;

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
    keyA: null,
    keyB: null,
    rate: 1,
    wipe: 50,
    muted: false,
    hasFolder: false,
    draggingId: null,
    wiping: false,
    canWrite: false
  };

  var lastExportJson = "";
  var saveTimer = 0;
  var flashTimer = 0;
  var seeking = false;
  var syncing = false;
  var booted = false;

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

  function variantCount(g) {
    return Object.keys((g && g.variants) || {}).length;
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

  function applySources(keepTime) {
    var g = currentGroup();
    var restore = keepTime ? restoreState() : { time: 0, rate: state.rate, paused: true };
    restore.rate = state.rate;
    videoA.muted = state.muted;
    videoB.muted = true;
    videoB.defaultMuted = true;
    if (!g) {
      videoA.removeAttribute("src");
      videoB.removeAttribute("src");
      try { videoA.load(); videoB.load(); } catch (err) {}
      missingA.hidden = true;
      missingB.hidden = true;
      updatePlayBtn();
      return;
    }
    var va = g.variants[state.keyA];
    var vb = g.variants[state.keyB];
    var okA = loadVariant(videoA, va, restore);
    missingA.hidden = okA;
    if (state.mode === "single") {
      missingB.hidden = true;
      videoB.removeAttribute("src");
      try { videoB.load(); } catch (err) {}
    } else {
      var okB = loadVariant(videoB, vb, restore);
      missingB.hidden = okB;
    }
    updatePlayBtn();
    updateTransport();
  }

  function syncVideos(force) {
    if (state.mode === "single") return;
    if (!videoB.getAttribute("src")) return;
    if (videoB.readyState < 1) return;
    if (syncing && !force) return;
    var a = videoA.currentTime || 0;
    if (force || Math.abs((videoB.currentTime || 0) - a) > DRIFT) {
      syncing = true;
      try { videoB.currentTime = a; } catch (err) {}
      setTimeout(function () { syncing = false; }, 80);
    }
    if (videoB.playbackRate !== videoA.playbackRate) {
      try { videoB.playbackRate = videoA.playbackRate; } catch (err) {}
    }
  }

  function playBoth() {
    var p = videoA.play();
    if (p && p.catch) p.catch(function () {});
    if (state.mode !== "single" && videoB.getAttribute("src")) {
      var q = videoB.play();
      if (q && q.catch) q.catch(function () {});
    }
    updatePlayBtn();
  }

  function pauseBoth() {
    try { videoA.pause(); } catch (err) {}
    try { videoB.pause(); } catch (err) {}
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
    if (state.mode !== "single") {
      try { videoB.currentTime = t; } catch (err) {}
    }
    updateTransport();
  }

  function jumpSeconds(s) {
    var t = (videoA.currentTime || 0) + s;
    var dur = videoA.duration;
    if (Number.isFinite(dur)) t = Math.max(0, Math.min(dur, t));
    else t = Math.max(0, t);
    try { videoA.currentTime = t; } catch (err) {}
    if (state.mode !== "single") {
      try { videoB.currentTime = t; } catch (err) {}
    }
    updateTransport();
  }

  function setRate(r) {
    state.rate = r;
    try { videoA.playbackRate = r; } catch (err) {}
    try { videoB.playbackRate = r; } catch (err) {}
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

  function setMode(mode) {
    var g = currentGroup();
    var n = g ? variantCount(g) : 0;
    if ((mode === "wipe" || mode === "sbs") && n < 2) mode = "single";
    state.mode = mode;
    picture.setAttribute("data-mode", mode);
    paneB.hidden = mode === "single";
    wipeDivider.hidden = mode !== "wipe";
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-mode") === mode);
    }
    var bWrap = $("abB");
    if (bWrap) bWrap.style.display = mode === "single" ? "none" : "";
    applySources(true);
    renderFpsChips();
    renderVariantChips();
    renderAbSelects();
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
      return;
    }
    if (!state.hasFolder || !groupOnDisk(g)) {
      placeholder.hidden = false;
      placeholder.querySelector(".ph-kicker").textContent = g.title || "Clip";
      placeholderBody.textContent = "Load video folder to play. Metadata is already here.";
      return;
    }
    placeholder.hidden = true;
  }

  function openGroup(id, keepMode) {
    var g = null;
    for (var i = 0; i < state.db.groups.length; i++) {
      if (state.db.groups[i].id === id) { g = state.db.groups[i]; break; }
    }
    state.selectedId = g ? g.id : null;
    if (g) {
      var ab = pickDefaultAB(g);
      state.keyA = ab.a;
      state.keyB = ab.b;
      if (!keepMode) {
        if (variantCount(g) < 2 && (state.mode === "wipe" || state.mode === "sbs")) state.mode = "single";
      }
    } else {
      state.keyA = null;
      state.keyB = null;
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

  function fillSelect(sel, group, current) {
    var keys = sortVariantKeys(group);
    sel.innerHTML = keys.map(function (k) {
      var v = group.variants[k];
      return '<option value="' + esc(k) + '"' + (k === current ? " selected" : "") + ">" + esc(variantLabel(v)) + "</option>";
    }).join("");
    sel.disabled = !keys.length;
  }

  function renderAbSelects() {
    var g = currentGroup();
    if (!g) {
      selectA.innerHTML = "";
      selectB.innerHTML = "";
      selectA.disabled = true;
      selectB.disabled = true;
      return;
    }
    fillSelect(selectA, g, state.keyA);
    fillSelect(selectB, g, state.keyB);
    var n = variantCount(g);
    selectB.disabled = n < 2 || state.mode === "single";
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var m = tabs[i].getAttribute("data-mode");
      tabs[i].disabled = (m === "wipe" || m === "sbs") && n < 2;
    }
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
        !(state.mode !== "single" && state.keyB && Math.abs(normFps(g.variants[state.keyB]) - fps) > 0.05)) {
      renderFpsChips();
      return;
    }
    var a = findVariantAtFps(g, state.keyA, fps);
    if (a) state.keyA = a;
    if (state.mode !== "single" && state.keyB) {
      var b = findVariantAtFps(g, state.keyB, fps);
      if (b) state.keyB = b;
    }
    applySources(true);
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

  function renderVariantChips() {
    var g = currentGroup();
    if (!g) { variantChips.innerHTML = ""; return; }
    var fpsA = currentFps();
    var keys = sortVariantKeys(g).filter(function (k) {
      return Math.abs(normFps(g.variants[k]) - fpsA) < 0.05;
    });
    variantChips.innerHTML = keys.map(function (k) {
      var v = g.variants[k];
      var cls = "vchip " + (v.tech ? "up" : "orig");
      if (k === state.keyA) cls += " is-a";
      if (state.mode !== "single" && k === state.keyB) cls += " is-b";
      var slot = "";
      if (k === state.keyA) slot += '<span class="slot">A</span>';
      if (state.mode !== "single" && k === state.keyB) slot += '<span class="slot">B</span>';
      return '<button type="button" class="' + cls + '" data-key="' + esc(k) + '">' + esc(variantLabel(v, { hideFps: true })) + slot + "</button>";
    }).join("");
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
      var cls = "var-row" + (k === state.keyA ? " is-a" : "") + (state.mode !== "single" && k === state.keyB ? " is-b" : "");
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
    renderVariantChips();
    renderAbSelects();
    renderSpeeds();
    updatePlaceholder();
    updateMuteBtn();
    updatePlayBtn();
    labelA.textContent = "A · " + variantLabel(currentGroup() && currentGroup().variants[state.keyA]);
    labelB.textContent = "B · " + variantLabel(currentGroup() && currentGroup().variants[state.keyB]);
    setWipe(state.wipe);
    var n = currentGroup() ? variantCount(currentGroup()) : 0;
    picture.setAttribute("data-mode", state.mode);
    paneB.hidden = state.mode === "single";
    wipeDivider.hidden = state.mode !== "wipe";
    var bWrap = $("abB");
    if (bWrap) bWrap.style.display = state.mode === "single" ? "none" : "";
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var m = tabs[i].getAttribute("data-mode");
      tabs[i].classList.toggle("is-on", m === state.mode);
      tabs[i].disabled = (m === "wipe" || m === "sbs") && n < 2;
    }
  }

  function setVariant(slot, key) {
    var g = currentGroup();
    if (!g || !g.variants[key]) return;
    if (slot === "B") {
      state.keyB = key;
      if (state.mode === "single") setMode("wipe");
      else applySources(true);
    } else {
      state.keyA = key;
      applySources(true);
    }
    renderVariantChips();
    renderAbSelects();
    renderInspector();
    labelA.textContent = "A · " + variantLabel(g.variants[state.keyA]);
    labelB.textContent = "B · " + variantLabel(g.variants[state.keyB]);
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

  function exportJson() {
    var text = stringifyDb(state.db);
    lastExportJson = text;
    var blob = new Blob([text], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "videos.json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
    updateSavePill(false);
    saveStatus.textContent = "Exported · videos.json";
    saveStatus.className = "save-pill flash";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { updateSavePill(false); }, 1200);
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

    $("fpsChips").addEventListener("click", function (e) {
      var chip = e.target.closest("[data-fps]");
      if (!chip) return;
      setFps(Number(chip.getAttribute("data-fps")));
    });

    variantChips.addEventListener("click", function (e) {
      var chip = e.target.closest(".vchip");
      if (!chip) return;
      var key = chip.getAttribute("data-key");
      if (e.shiftKey && state.mode !== "single") setVariant("B", key);
      else setVariant("A", key);
    });

    selectA.addEventListener("change", function () { setVariant("A", selectA.value); });
    selectB.addEventListener("change", function () { setVariant("B", selectB.value); });

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
    $("btnFs").addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", function () {
      var on = fsElement() === picture || fsElement() === stage;
      document.documentElement.classList.toggle("is-fs", on);
      picture.classList.toggle("is-fs", on);
    });
    document.addEventListener("webkitfullscreenchange", function () {
      var on = fsElement() === picture || fsElement() === stage;
      document.documentElement.classList.toggle("is-fs", on);
      picture.classList.toggle("is-fs", on);
    });

    seek.addEventListener("input", function () {
      seeking = true;
      var t = Number(seek.value);
      try { videoA.currentTime = t; } catch (err) {}
      if (state.mode !== "single") {
        try { videoB.currentTime = t; } catch (err) {}
      }
      updateTransport();
    });
    seek.addEventListener("change", function () { seeking = false; });

    picture.addEventListener("dblclick", function (e) {
      if (e.target === wipeDivider || (e.target && e.target.closest && e.target.closest(".wipe-divider"))) return;
      toggleFullscreen();
    });

    wipeDivider.addEventListener("pointerdown", function (e) {
      state.wiping = true;
      wipeDivider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    wipeDivider.addEventListener("pointermove", function (e) {
      if (!state.wiping) return;
      var rect = picture.getBoundingClientRect();
      if (!rect.width) return;
      setWipe(((e.clientX - rect.left) / rect.width) * 100);
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
      if (state.mode !== "single" && videoB.getAttribute("src") && videoB.paused) {
        videoB.play().catch(function () {});
      }
      updatePlayBtn();
    });
    videoA.addEventListener("pause", function () {
      if (state.mode !== "single" && !videoB.paused) {
        try { videoB.pause(); } catch (err) {}
      }
      updatePlayBtn();
    });
    videoA.addEventListener("loadedmetadata", updateTransport);
    videoB.addEventListener("seeked", function () { syncing = false; });
    videoA.addEventListener("ratechange", function () {
      if (state.mode !== "single") {
        try { videoB.playbackRate = videoA.playbackRate; } catch (err) {}
      }
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
      } else if (e.key === "f" || e.key === "F") {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "Escape") {
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
    paneA = $("paneA");
    paneB = $("paneB");
    missingA = $("missingA");
    missingB = $("missingB");
    labelA = $("labelA");
    labelB = $("labelB");
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
    variantChips = $("variantChips");
    selectA = $("selectA");
    selectB = $("selectB");
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
    if (!videoA || !videoB) return;
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
