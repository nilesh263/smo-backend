const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg  = require("fluent-ffmpeg");

const ffmpegInstaller  = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

const BASE_URL = () => process.env.RAILWAY_PUBLIC_DOMAIN
  ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
  : "http://localhost:" + (process.env.PORT || 4000);

/**
 * Build a GIF using a memory-safe TWO-PASS palette workflow.
 *
 * The old single-pass `split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`
 * filter buffers EVERY decoded frame in RAM (the split branch waits for the
 * whole palette to be generated), which OOM-crashes the container on large
 * GIFs. Two-pass avoids this: pass 1 streams the input to build a tiny
 * palette PNG; pass 2 re-reads the input and applies that palette
 * frame-by-frame. Peak memory stays flat regardless of GIF size.
 *
 * @param {string}   inputPath   uploaded source file
 * @param {string}   outputPath  destination .gif
 * @param {string}   vf          scale/fps filter chain applied before palette
 *                               (e.g. "scale=iw*0.75:ih*0.75:flags=lanczos")
 * @param {object}   opts        { duration?: number, maxColors?: number, dither?: string }
 * @param {function} done        callback(err)
 */
function buildGif(inputPath, outputPath, vf, opts, done) {
  opts = opts || {};
  const maxColors  = opts.maxColors || 256;
  const dither     = opts.dither    || "bayer";
  const palettePath = outputPath.replace(/\.gif$/i, "") + "-palette.png";

  const cleanupPalette = () => {
    try { if (fs.existsSync(palettePath)) fs.unlinkSync(palettePath); } catch (e) {}
  };

  // ---- Pass 1: generate palette (low memory, streaming) ----
  const pass1 = ffmpeg(inputPath);
  if (opts.duration) pass1.outputOptions(["-t", String(opts.duration)]);
  pass1
    .outputOptions(["-vf", vf + ",palettegen=stats_mode=diff:max_colors=" + maxColors])
    .on("error", function (err) { cleanupPalette(); done(err); })
    .on("end", function () {
      // ---- Pass 2: apply palette ----
      const pass2 = ffmpeg(inputPath).input(palettePath);
      if (opts.duration) pass2.outputOptions(["-t", String(opts.duration)]);
      pass2
        .complexFilter([
          "[0:v]" + vf + "[x]",
          "[x][1:v]paletteuse=dither=" + dither,
        ])
        .outputOptions(["-f", "gif"])
        .on("error", function (err) { cleanupPalette(); done(err); })
        .on("end",   function ()    { cleanupPalette(); done(null); })
        .save(outputPath);
    })
    .save(palettePath);
}

router.post("/compress", upload.single("file"), function (req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const scale        = req.body.scale || "0.75";
  const inputPath    = req.file.path;
  const outputName   = uuidv4() + ".gif";
  const outputPath   = path.join(__dirname, "../output", outputName);
  const originalSize = fs.statSync(inputPath).size;
  const baseName     = path.basename(req.file.originalname, path.extname(req.file.originalname));

  const vf = "scale=iw*" + scale + ":ih*" + scale + ":flags=lanczos";

  buildGif(inputPath, outputPath, vf, { maxColors: 128, dither: "bayer" }, function (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (err) return res.status(500).json({ error: err.message });
    const compressedSize = fs.statSync(outputPath).size;
    const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
    res.json({
      success: true, originalSize, compressedSize, savings: parseFloat(savings),
      downloadUrl: BASE_URL() + "/download/" + outputName,
      downloadFilename: baseName + "-compressed.gif",
    });
  });
});

router.post("/resize", upload.single("file"), function (req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const width      = req.body.width  || "480";
  const height     = req.body.height || "270";
  const inputPath  = req.file.path;
  const outputName = uuidv4() + ".gif";
  const outputPath = path.join(__dirname, "../output", outputName);
  const baseName   = path.basename(req.file.originalname, path.extname(req.file.originalname));

  const vf = "scale=" + width + ":" + height + ":flags=lanczos";

  buildGif(inputPath, outputPath, vf, {}, function (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      success: true,
      downloadUrl: BASE_URL() + "/download/" + outputName,
      downloadFilename: baseName + "-" + width + "x" + height + ".gif",
    });
  });
});

router.post("/video2gif", upload.single("file"), function (req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fps        = req.body.fps   || "10";
  const width      = req.body.width || "320";
  const inputPath  = req.file.path;
  const outputName = uuidv4() + ".gif";
  const outputPath = path.join(__dirname, "../output", outputName);
  const baseName   = path.basename(req.file.originalname, path.extname(req.file.originalname));

  const vf = "fps=" + fps + ",scale=" + width + ":-1:flags=lanczos";

  buildGif(inputPath, outputPath, vf, { duration: 8 }, function (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (err) return res.status(500).json({ error: err.message });
    res.json({
      success: true,
      downloadUrl: BASE_URL() + "/download/" + outputName,
      downloadFilename: baseName + ".gif",
    });
  });
});

module.exports = router;
