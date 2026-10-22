// Keeps the demo API on Render awake. The free instance sleeps after 15 idle
// minutes, and GitHub Actions runs scheduled workflows hours apart, so the ping
// runs here, on a Cloudflare cron trigger every 10 minutes.
const HEALTH_URL = "https://incident-sense-api.onrender.com/api/health";

export default {
  async scheduled(_controller, _env, ctx) {
    ctx.waitUntil(
      fetch(HEALTH_URL, { headers: { "User-Agent": "incident-sense-keep-awake" } }).then(
        (response) => console.log(`health ${response.status}`),
        (error) => console.log(`health failed: ${error}`),
      ),
    );
  },
};
