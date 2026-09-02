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
SEE_FULL_FILE_ON_DISK
