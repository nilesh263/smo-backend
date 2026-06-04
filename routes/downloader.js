const express = require("express");
const { exec } = require("child_process");
const path    = require("path");
const fs      = require("fs");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const isWindows = process.platform === "win32";
const YTDLP  = isWindows 
  ? "C:\\Users\\Admin\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe"
  : "yt-dlp";
const FFMPEG = isWindows
  ? "C:\\Users\\Admin\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe"
  : "ffmpeg";

// TEMP diagnostic — yt-dlp availability/version on the host
router.get("/diag", function(req, res) {
  exec(`"${YTDLP}" --version`, { timeout: 15000 }, function(err, stdout, stderr) {
    res.json({
      ytdlp_path: YTDLP,
      version: (stdout || "").trim() || null,
      error: err ? (stderr || err.message || "").slice(0, 400) : null,
    });
  });
});

// Get video info
router.post("/info", function(req, res) {
  var url = req.body.url;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  var cmd = `"${YTDLP}" --dump-json --no-playlist "${url}"`;
  console.log("Fetching info:", url);

  exec(cmd, { timeout: 30000 }, function(err, stdout, stderr) {
    if (err) {
      console.error("yt-dlp error:", stderr);
      return res.status(500).json({ error: "Could not fetch video info. Check URL.", detail: (stderr || err.message || "").slice(0, 600) });
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

  if (isAudio) {
    // Extract audio as MP3
    cmd = `"${YTDLP}" -f bestaudio --extract-audio --audio-format mp3 --audio-quality 192k --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else if (format === "best_aac") {
    // Best video + re-encode audio to AAC so it plays on all devices
    cmd = `"${YTDLP}" -f "bestvideo+bestaudio/best" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v copy -c:a aac -b:a 192k" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else if (format === "worst") {
    cmd = `"${YTDLP}" -f "worstvideo+worstaudio/worst" --merge-output-format mp4 --postprocessor-args "ffmpeg:-c:v copy -c:a aac -b:a 128k" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
  } else {
    cmd = `"${YTDLP}" -f "best" --ffmpeg-location "${FFMPEG}" -o "${outputTemplate}" --no-playlist "${url}"`;
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
      downloadUrl:      "http://localhost:4000/download/" + filename,
      downloadFilename: isAudio ? "audio.mp3" : "video." + ext,
      size,
    });
  });
});

module.exports = router;
