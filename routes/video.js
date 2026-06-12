const express    = require("express");
const multer     = require("multer");
const path       = require("path");
const fs         = require("fs");
const { v4: uuidv4 } = require("uuid");
const ffmpeg     = require("fluent-ffmpeg");

const ffmpegInstaller  = require("@ffmpeg-installer/ffmpeg");
const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const BASE_URL = () => process.env.RAILWAY_PUBLIC_DOMAIN
  ? "https://" + process.env.RAILWAY_PUBLIC_DOMAIN
  : "http://localhost:" + (process.env.PORT || 4000);

// Compress with libx264 at the requested CRF, capping the resolution to a box
// (only ever downscaling). Done with the bundled ffmpeg — no external service,
// so it can't fail on credentials and reliably reduces file size.
function compressVideo(inputPath, outputPath, crf, maxDim) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .audioBitrate("128k")
      .outputOptions([
        "-crf", String(crf),
        "-preset", "veryfast",
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        // fit within maxDim×maxDim keeping aspect (downscale only), then force even dims
        "-vf", `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      ])
      .on("end",   () => resolve())
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// POST /api/video/compress
router.post("/compress", upload.single("file"), async function (req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const crf = parseInt(req.body.crf, 10) || 23;
  let maxDim;
  if      (crf <= 18) maxDim = 1920; // High quality
  else if (crf <= 23) maxDim = 1280; // Balanced
  else                maxDim = 854;  // Web optimized

  const inputPath    = req.file.path;
  const baseName     = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const originalSize = fs.statSync(inputPath).size;
  const outputName   = uuidv4() + ".mp4";
  const outputPath   = path.join(__dirname, "../output", outputName);

  console.log("Compressing:", req.file.originalname, "crf:", crf, "cap:", maxDim);

  try {
    await compressVideo(inputPath, outputPath, crf, maxDim);

    let compressedSize  = fs.statSync(outputPath).size;
    let servedName      = outputName;
    let servedFilename  = baseName + "-compressed.mp4";

    // Safety net: never hand back a file bigger than the original.
    if (compressedSize >= originalSize) {
      const origName = uuidv4() + path.extname(req.file.originalname);
      fs.copyFileSync(inputPath, path.join(__dirname, "../output", origName));
      try { fs.unlinkSync(outputPath); } catch (e) {}
      servedName     = origName;
      servedFilename = baseName + path.extname(req.file.originalname);
      compressedSize = originalSize;
    }

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    const savings = Math.max(0, (originalSize - compressedSize) / originalSize * 100).toFixed(1);

    res.json({
      success: true,
      originalSize,
      compressedSize,
      savings: parseFloat(savings),
      downloadUrl:      BASE_URL() + "/download/" + servedName,
      downloadFilename: servedFilename,
    });
  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    console.error("Compression error:", err.message);
    res.status(500).json({ error: "Compression failed: " + err.message });
  }
});

// POST /api/video/extract-audio
router.post("/extract-audio", upload.single("file"), function (req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath  = req.file.path;
  const baseName   = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const outputName = uuidv4() + ".mp3";
  const outputPath = path.join(__dirname, "../output", outputName);

  ffmpeg(inputPath)
    .noVideo()
    .audioCodec("libmp3lame")
    .audioBitrate("192k")
    .on("end", function () {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.json({
        success: true,
        downloadUrl:      BASE_URL() + "/download/" + outputName,
        downloadFilename: baseName + ".mp3",
      });
    })
    .on("error", function (err) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      console.error("Audio extraction error:", err.message);
      res.status(500).json({ error: "Audio extraction failed: " + err.message });
    })
    .save(outputPath);
});

module.exports = router;
