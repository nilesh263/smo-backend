require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");
const https   = require("https");
const http    = require("http");

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: "*" }));
app.use(express.json());

["uploads","output"].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Dump ALL env var names
app.get("/debug-env", (req, res) => {
  const allKeys = Object.keys(process.env).sort();
  res.json({
    total_vars: allKeys.length,
    all_keys: allKeys,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "MISSING",
    CLOUDINARY_API_KEY:    process.env.CLOUDINARY_API_KEY    || "MISSING",
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ? "SET" : "MISSING",
  });
});

// Thumbnail proxy
app.get("/api/proxy/thumbnail", function(req, res) {
  var imageUrl = String(req.query.url || "");
  if (!imageUrl) return res.status(400).send("No URL");
  if (imageUrl.indexOf("img.youtube.com") === -1) return res.status(403).send("Not allowed");
  var client = imageUrl.startsWith("https") ? https : http;
  client.get(imageUrl, function(imgRes) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", 'attachment; filename="thumbnail.jpg"');
    res.setHeader("Access-Control-Allow-Origin", "*");
    imgRes.pipe(res);
  }).on("error", function(err) { res.status(500).send(err.message); });
});

app.get("/download/:filename", (req, res) => {
  const filePath = path.join(__dirname, "output", req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.filename}"`);
  res.setHeader("Content-Type", "application/octet-stream");
  res.sendFile(filePath);
});

app.use("/output", express.static(path.join(__dirname, "output")));

app.use("/api/image",      require("./routes/image"));
app.use("/api/video",      require("./routes/video"));
app.use("/api/gif",        require("./routes/gif"));
app.use("/api/pdf",        require("./routes/pdf"));
app.use("/api/downloader", require("./routes/downloader"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

setInterval(() => {
  const dir = path.join(__dirname, "output");
  fs.readdirSync(dir).forEach(file => {
    const fp = path.join(dir, file);
    try { if (Date.now() - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp); } catch(e) {}
  });
}, 900000);

app.listen(PORT, () => {
  console.log(`\n🚀 Backend running at http://localhost:${PORT}`);
});