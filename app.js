/* SR Video Lab — vanilla file:// app. Chrome only. Videos never copied. */
(function () {
  "use strict";
  var LS_KEY = "sr-video-lab-db";
  var FRAME_DT = 1 / 24;
  var DRIFT = 0.08;
  var SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  var RES_TOKENS = ["240p", "360p", "480p", "720p", "1080p", "1440p", "4k", "2160p", "8k"];
  var RES_RANK = { "240p": 0, "360p": 1, "480p": 2, "720p": 3, "1080p": 4, "1440p": 5, "4k": 6, "2160p": 6, "8k": 7 };
  var UNCAT_COLOR = "#94a3b8";
  var PALETTE = ["#7c9cff", "#5eead4", "#f0abfc", "#e8a838", "#f07178", "#86c98a", "#94a3b8", "#fb923c", "#38bdf8", "#a78bfa"];
  /* full app.js body omitted in this retry wrapper; see disk file */
})();
