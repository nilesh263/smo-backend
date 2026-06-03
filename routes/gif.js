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

router.post("/compress", upload.single("file"), function(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  var scale = req.body.scale || "0.75";
  var inputPath = req.file.path;
  var outputName = uuidv4() + ".gif";
  var outputPath = path.join(__dirname, "../output", outputName);
  var originalSize = fs.statSync(inputPath).size;
  var baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));

  ffmpeg(inputPath)
    .outputOption("-vf", "scale=iw*" + scale + ":ih*" + scale + ":flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer")
    .format("gif")
    .on("end", function() {
      var compressedSize = fs.statSync(outputPath).size;
      var savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.json({ success:true, originalSize, compressedSize, savings:parseFloat(savings), downloadUrl:BASE_URL()+"/download/"+outputName, downloadFilename:baseName+"-compressed.gif" });
    })
    .on("error", function(err) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

router.post("/resize", upload.single("file"), function(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  var width = req.body.width || "480";
  var height = req.body.height || "270";
  var inputPath = req.file.path;
  var outputName = uuidv4() + ".gif";
  var outputPath = path.join(__dirname, "../output", outputName);
  var baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));

  ffmpeg(inputPath)
    .outputOption("-vf", "scale="+width+":"+height+":flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse")
    .format("gif")
    .on("end", function() {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.json({ success:true, downloadUrl:BASE_URL()+"/download/"+outputName, downloadFilename:baseName+"-"+width+"x"+height+".gif" });
    })
    .on("error", function(err) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

router.post("/video2gif", upload.single("file"), function(req, res) {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  var fps = req.body.fps || "10";
  var width = req.body.width || "320";
  var inputPath = req.file.path;
  var outputName = uuidv4() + ".gif";
  var outputPath = path.join(__dirname, "../output", outputName);
  var baseName = path.basename(req.file.originalname, path.extname(req.file.originalname));

  ffmpeg(inputPath)
    .outputOption("-vf", "fps="+fps+",scale="+width+":-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse")
    .outputOption("-t", "8")
    .format("gif")
    .on("end", function() {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.json({ success:true, downloadUrl:BASE_URL()+"/download/"+outputName, downloadFilename:baseName+".gif" });
    })
    .on("error", function(err) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      res.status(500).json({ error: err.message });
    })
    .save(outputPath);
});

module.exports = router;
