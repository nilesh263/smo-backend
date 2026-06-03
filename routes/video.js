const express    = require("express");
const multer     = require("multer");
const path       = require("path");
const fs         = require("fs");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "../uploads")),
  filename:    (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

function getCloudinary() {
  const cloudinary = require("cloudinary").v2;
  console.log("Cloudinary config check:");
  console.log("  CLOUD_NAME:", process.env.CLOUDINARY_CLOUD_NAME ? "SET" : "MISSING");
  console.log("  API_KEY:",    process.env.CLOUDINARY_API_KEY    ? "SET" : "MISSING");
  console.log("  API_SECRET:", process.env.CLOUDINARY_API_SECRET ? "SET" : "MISSING");

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  return cloudinary;
}

// POST /api/video/compress
router.post("/compress", upload.single("file"), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  var cloudinary = getCloudinary();
  var crf        = req.body.crf || "23";
  var quality    = crf <= 18 ? 90 : crf <= 23 ? 70 : 50;
  var inputPath  = req.file.path;
  var baseName   = path.basename(req.file.originalname, path.extname(req.file.originalname));
  var originalSize = fs.statSync(inputPath).size;

  console.log("Uploading to Cloudinary:", req.file.originalname);

  try {
    var result = await cloudinary.uploader.upload(inputPath, {
      resource_type: "video",
      folder:        "smo-videos",
      eager: [
        { quality: quality, format: "mp4", video_codec: "h264" }
      ],
      eager_async: false,
    });

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

    var compressedUrl  = result.eager[0].secure_url;
    var compressedSize = result.eager[0].bytes || Math.round(originalSize * (quality/100));
    var savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

    res.json({
      success: true,
      originalSize, compressedSize,
      savings: parseFloat(savings),
      downloadUrl:      compressedUrl,
      downloadFilename: baseName + "-compressed.mp4",
    });

  } catch(err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    console.error("Cloudinary error:", err.message);
    res.status(500).json({ error: "Compression failed: " + err.message });
  }
});

// POST /api/video/extract-audio
router.post("/extract-audio", upload.single("file"), async function(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  var cloudinary = getCloudinary();
  var inputPath  = req.file.path;
  var baseName   = path.basename(req.file.originalname, path.extname(req.file.originalname));

  try {
    var result = await cloudinary.uploader.upload(inputPath, {
      resource_type: "video",
      folder:        "smo-videos",
      eager: [{ format: "mp3" }],
      eager_async: false,
    });

    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

    res.json({
      success: true,
      downloadUrl:      result.eager[0].secure_url,
      downloadFilename: baseName + ".mp3",
    });

  } catch(err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
