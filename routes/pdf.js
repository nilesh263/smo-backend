const express = require("express");
const multer  = require("multer");
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
    file.mimetype === "application/pdf" ? cb(null, true) : cb(new Error("PDF files only"));
  },
});

// ── POST /api/pdf/compress ────────────────────────────────────
// Note: Real PDF compression requires Ghostscript installed.
// This returns a mock response for now — Phase 2 wires Ghostscript.
router.post("/compress", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const inputPath  = req.file.path;
  const outputName = `${uuidv4()}.pdf`;
  const outputPath = path.join(__dirname, "../output", outputName);

  try {
    // For now: copy the file (Ghostscript integration comes in Phase 2)
    fs.copyFileSync(inputPath, outputPath);
    fs.unlinkSync(inputPath);

    const originalSize   = req.file.size;
    const compressedSize = fs.statSync(outputPath).size;

    res.json({
      success:      true,
      originalName: req.file.originalname,
      originalSize,
      compressedSize,
      savings:      0,
      note:         "Ghostscript compression coming in Phase 2",
      downloadUrl:  `http://localhost:4000/output/${outputName}`,
    });
  } catch (err) {
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
