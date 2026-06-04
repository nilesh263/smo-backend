// Downloads the standalone yt-dlp_linux binary into ./bin/yt-dlp at install time.
// Runs from package.json "postinstall" so it works regardless of the Railway
// builder (Nixpacks or Railpack). The *_linux build is a self-contained
// PyInstaller binary — it does NOT require Python on the host.
// Skipped on Windows, where local dev uses a system-installed yt-dlp.

const fs    = require("fs");
const path  = require("path");
const https = require("https");

if (process.platform === "win32") {
  console.log("[setup-ytdlp] Windows detected — skipping download (local dev uses system yt-dlp).");
  process.exit(0);
}

const BIN_DIR = path.join(__dirname, "..", "bin");
const DEST    = path.join(BIN_DIR, "yt-dlp");
const URL     = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

function download(url, dest, redirects = 0) {
  if (redirects > 10) return Promise.reject(new Error("Too many redirects"));
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { "User-Agent": "smo-backend" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(dest, () => {});
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error("HTTP " + res.statusCode));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

(async () => {
  try {
    if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });
    console.log("[setup-ytdlp] Downloading latest yt-dlp_linux ...");
    await download(URL, DEST);
    fs.chmodSync(DEST, 0o755);
    const mb = (fs.statSync(DEST).size / 1024 / 1024).toFixed(1);
    console.log(`[setup-ytdlp] Installed yt-dlp at ${DEST} (${mb} MB)`);
  } catch (e) {
    // Non-fatal: don't break the whole deploy. The /diag route + downloader
    // error will surface a clear message if the binary is missing.
    console.error("[setup-ytdlp] FAILED to download yt-dlp:", e.message);
    process.exit(0);
  }
})();
