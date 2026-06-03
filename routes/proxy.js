const express = require("express");
const https   = require("https");
const http    = require("http");

const router = express.Router();

router.get("/thumbnail", function(req, res) {
  var imageUrl = req.query.url;

  if (!imageUrl) {
    return res.status(400).send("No URL provided");
  }

  if (imageUrl.indexOf("img.youtube.com") === -1) {
    return res.status(403).send("Only YouTube thumbnails allowed");
  }

  var client = imageUrl.indexOf("https") === 0 ? https : http;

  var request = client.get(imageUrl, function(imgRes) {
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", "attachment; filename=\"thumbnail.jpg\"");
    res.setHeader("Access-Control-Allow-Origin", "*");
    imgRes.pipe(res);
  });

  request.on("error", function(err) {
    res.status(500).send("Error: " + err.message);
  });
});

module.exports = router;
