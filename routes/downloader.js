const express = require("express");
const { exec } = require("child_process");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const isWindows = process.platform === "win32";
const YTDLP  = isWindows
  ? "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe"
  : path.join(__dirname, "..", "bin", "yt-dlp");
// Use the npm-bundled ffmpeg binary (works on every host, no system install needed)
const FFMPEG = require("@ffmpeg-installer/ffmpeg").path;

const BASE_URL = () => process.env.RAILWAY_PUBLIC_DOMAIN
  ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
  : "http://localhost:" + (process.env.PORT || 4000);

// Newer yt-dlp needs a JavaScript runtime to solve YouTube's challenges.
// Reuse the Node binary we're already running on (no extra download), and allow
// fetching the challenge-solver component so more/higher formats are available.
const JS_ARGS = `--js-runtimes "node:${process.execPath}" --remote-components ejs:github`;

// YouTube blocks datacenter IPs with a bot check. Passing cookies from a
// logged-in (throwaway) account bypasses it. Cookies are provided via env var
// so they're never committed. We accept either base64 (YTDLP_COOKIES_B64,
// preferred) or raw text (YTDLP_COOKIES), and auto-detect which one was pasted
// so it works even if the user mixes them up.

// A Netscape cookie file has the header comment and/or tab-separated rows.
function looksLikeCookieFile(text) {
  if (!text) return false;
  return /# ?(Netscape |HTTP )?Cookie File/i.test(text)
      || /\t(TRUE|FALSE)\t/i.test(text)
      || (text.indexOf("\t") !== -1 && /youtube|google/i.test(text));
}

// Return valid cookie-file text from the env (decoding base64 if needed), or null.
function resolveCookieContent() {
  const b64 = process.env.YTDLP_COOKIES_B64;
  const raw = process.env.YTDLP_COOKIES;
  // 1) try base64-decoding either var
  for (const v of [b64, raw]) {
    if (!v) continue;
    try {
      const dec = Buffer.from(v.replace(/\s+/g, ""), "base64").toString("utf8");
      if (looksLikeCookieFile(dec)) return dec;
    } catch (e) {}
  }
  // 2) try the value verbatim (pasted as raw cookies.txt)
  for (const v of [raw, b64]) {
    if (looksLikeCookieFile(v)) return v;
  }
  return null;
}

let _cookiesState = null; // null=unchecked, false=none, string=path
function cookiesArg() {
  if (_cookiesState === false) return "";
  if (typeof _cookiesState === "string") return `--cookies "${_cookiesState}"`;

  const content = resolveCookieContent();
  if (!content) {
    if (process.env.YTDLP_COOKIES_B64 || process.env.YTDLP_COOKIES) {
      console.error("[downloader] Cookies env is set but is not valid base64 OR raw Netscape cookies.");
    }
    _cookiesState = false;
    return "";
  }

  try {
    const p = path.join(os.tmpdir(), "yt-cookies.txt");
    fs.writeFileSync(p, content, { mode: 0o600 });
    _cookiesState = p;
    console.log("[downloader] Using YouTube cookies from env at", p);
    return `--cookies "${p}"`;
  } catch (e) {
    console.error("[downloader] Failed to write cookies file:", e.message);
    _cookiesState = false;
    return "";
  }
}

// Get video info
router.post("/info", function(req, res) {
  var url = req.body.url;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  var cmd = `"${YTDLP}" ${cookiesArg()} ${JS_ARGS} --dump-json --no-playlist "${url}"`;
  console.log("Fetching info:", url);

  exec(cmd, { timeout: 30000 }, function(err, stdout, stderr) {
    if (err) {
      console.error("yt-dlp error:", stderr);
      return res.status(500).json({ error: "Could not fetch video info. Check URL." });
    }
    try {
      var info = JSON.parse(stdout);
      res.json({
        title:     info.title,
        thumbnail: info.thumbnail,
        duration:  info.duration,
        uploader:  info.uploader || "Unknown",
        platform:  info.extractor_key,
        formats: [
          { id:"best_aac",   label:"Best Quality (HD)",   desc:"Best video + AAC audio — plays everywhere ⭐" },
          { id:"best",       label:"Good Quality",         desc:"Best single file format" },
          { id:"worst",      label:"Small Size",           desc:"Lowest resolution, smallest file" },
          { id:"bestaudio",  label:"Audio Only (MP3)",     desc:"Extract audio as MP3 · 192kbps" },
        ]
      });
    } catch(e) {
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

// Download video
router.post("/download", function(req, res) {
  var url    = req.body.url;
  var format = req.body.format || "best_aac";
  if (!url) return res.status(400).json({ error: "No URL provided" });

  var outputDir      = path.join(__dirname, "../output");
  var outputName     = uuidv4();
  var outputTemplate = path.join(outputDir, outputName + ".%(ext)s");
  var isAudio        = format === "bestaudio";
  var cmd;

  var ck = cookiesArg();
  if (isAudio) {
    // Extract audio as MP3
    cmd = `"${YTDLP}" ${ck} ${JS_ARGS} -f bestaudio --extract-audio --audio-format mp3 --audio-quality 192k --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else if (format === "best_aac") {
    // Best video + re-encode audio to AAC so it plays on all devices
    cmd = `"${YTDLP}" ${ck} ${JS_ARGS} -f "bestvideo+bestaudio/best" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v copy -c:a aac -b:a 192k" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else if (format === "worst") {
    cmd = `"${YTDLP}" ${ck} ${JS_ARGS} -f "worstvideo+worstaudio/worst" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v copy -c:a aac -b:a 128k" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else {
    cmd = `"${YTDLP}" ${ck} ${JS_ARGS} -f "best" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  }

  console.log("Downloading:", url, "format:", format);

  exec(cmd, { timeout: 300000, maxBuffer: 1024 * 1024 * 10 }, function(err, stdout, stderr) {
    if (err) {
      console.error("Download error:", stderr);
      return res.status(500).json({ error: "Download failed: " + (stderr || err.message).slice(0,300) });
    }

    // Find output file
    var files = fs.readdirSync(outputDir).filter(function(f) { return f.startsWith(outputName); });
    if (!files.length) return res.status(500).json({ error: "Output file not found" });

    var outFile  = path.join(outputDir, files[0]);
    var size     = fs.statSync(outFile).size;
    var ext      = files[0].split(".").pop();
    var filename = files[0];

    console.log("Downloaded:", filename, "size:", size);

    res.json({
      success:          true,
      downloadUrl:      BASE_URL() + "/download/" + filename,
      downloadFilename: isAudio ? "audio.mp3" : "video." + ext,
      size,
    });
  });
});

module.exports = router;
