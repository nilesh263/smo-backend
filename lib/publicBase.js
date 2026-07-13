// Build the public base URL from the INCOMING request, so download links point
// at whatever host the user actually reached us on — a Cloudflare tunnel domain,
// a Railway domain, or localhost — instead of a hardcoded localhost that only
// works on the same machine as the backend.
module.exports = function publicBase(req) {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0].trim();
  if (!host) {
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return "https://" + process.env.RAILWAY_PUBLIC_DOMAIN;
    return "http://localhost:" + (process.env.PORT || 4000);
  }
  const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return proto + "://" + host;
};
