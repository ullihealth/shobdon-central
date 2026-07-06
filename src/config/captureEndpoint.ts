// Remote capture log (Cloudflare Worker + KV) - lets a capture run on ATC PC2
// be viewed from any browser afterward. See worker/ at the project root.
//
// The key is a shared secret, not a security boundary: this is a static SPA,
// so anything sent from the browser is necessarily visible in the deployed
// bundle. It only needs to keep the log off search engines, not withstand
// anyone who reads this file.
export const CAPTURE_LOG_URL =
  'https://shobdon-central-capture.jeffthompson.workers.dev/?key=49f761797d8e1fe76898e079b997980f'
