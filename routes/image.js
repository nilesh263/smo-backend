const express = require("express");
const multer  = require("multer");
const sharp   = require("sharp");
const path    = require("path");
const fs      = require("fs");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg","image/png","image/webp","image/avif","image/gif","image/tiff","image/bmp"];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error("Invalid file type"));
  },
});

router.post("/compress", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  // Parse all settings from request
  const mode      = req.body.mode      || "balanced";
  const format    = req.body.format    || "webp";
  const quality   = parseInt(req.body.quality) || 82;
  const stripMeta = req.body.stripMeta !== "false";

  console.log(`Compressing: mode=${mode} format=${format} quality=${quality} stripMeta=${stripMeta}`);

  const inputPath  = req.file.path;
  const ext        = format === "original" ? path.extname(req.file.originalname).slice(1) : format;
  const outputName = `${uuidv4()}.${ext}`;
  const outputPath = path.join(__dirname, "../output", outputName);

  try {
    const originalSize = fs.statSync(inputPath).size;
    let pipeline       = sharp(inputPath);

    // Strip metadata if enabled
    if (stripMeta) {
      pipeline = pipeline.withMetadata({});
    }

    // Apply format + quality — quality is ALWAYS used directly
    if (format === "webp") {
      pipeline = pipeline.webp({
        quality:  mode === "lossless" ? 100 : quality,
        lossless: mode === "lossless",
        effort:   6,
        smartSubsample: true,
      });
    } else if (format === "avif") {
      pipeline = pipeline.avif({
        quality: mode === "lossless" ? 100 : Math.max(1, quality - 15),
        effort:  5,
        chromaSubsampling: "4:2:0",
      });
    } else if (format === "jpg") {
      pipeline = pipeline.jpeg({
        quality:     mode === "lossless" ? 100 : quality,
        progressive: true,
        mozjpeg:     true,
        chromaSubsampling: quality < 70 ? "4:2:0" : "4:4:4",
      });
    } else if (format === "png") {
      pipeline = pipeline.png({
        compressionLevel: mode === "lossless" ? 9 : Math.round((100 - quality) / 11),
        palette:          quality < 90,
        quality:          quality,
        effort:           7,
      });
    } else {
      pipeline = pipeline.webp({ quality, effort: 6 });
    }

    await pipeline.toFile(outputPath);

    const compressedSize = fs.statSync(outputPath).size;
    const savings        = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

    fs.unlinkSync(inputPath);

    const originalBaseName = path.basename(req.file.originalname, path.extname(req.file.originalname));

    console.log(`Done: ${originalSize} → ${compressedSize} bytes (${savings}% saved)`);

    res.json({
      success:          true,
      originalName:     req.file.originalname,
      outputName:       `${originalBaseName}-compressed.${ext}`,
      originalSize,
      compressedSize,
      savings:          parseFloat(savings),
      format:           ext,
      quality,
      downloadUrl:      `http://localhost:4000/download/${outputName}`,
      downloadFilename: `${originalBaseName}-compressed.${ext}`,
    });

  } catch (err) {
    if (fs.existsSync(inputPath))  fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    console.error("Compression error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
