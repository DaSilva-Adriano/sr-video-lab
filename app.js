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
    wiping: false
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
    return parts.join(" \u00b7 ") || "original";
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
      ? "Autosaved locally \u00b7 Export to update videos.json"
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

  function scanFolder(files) {
    var list = Array.prototype.slice.call(files || []).filter(isVideoFile);

    revokeAllUrls();
    fileMap.clear();
    fileByName.clear();
    state.hasFolder = list.length > 0;

    list.forEach(function (file) {
      var path = rememberFile(file);
      var parsed = parseFilename(file.name, state.db.categories);
      if (parsed) upsertParsedGroup(parsed, path);
      else upsertLooseFile(file, path);
    });

    var playId = state.selectedId;
    var cur = currentGroup();
    if (!playId || !cur || !groupOnDisk(cur)) playId = firstOnDiskGroupId();

    saveDb(true);
    if (playId) {
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
