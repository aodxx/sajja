/* Service Worker — ทำให้ออฟไลน์ 100% (cache-first) */
const CACHE = "sajja-v5";
const BASE = './';
const ASSETS = [
  BASE, BASE + 'index.html', BASE + 'manifest.webmanifest', BASE + 'css/app.css',
  BASE + 'icons/icon.svg', BASE + 'vendor/xlsx.full.min.js', BASE + 'data/sample-data.json',
  BASE + 'js/app.js', BASE + 'js/util.js', BASE + 'js/db.js', BASE + 'js/calc.js',
  BASE + 'js/crypto.js', BASE + 'js/sync.js', BASE + 'js/fileio.js',
  BASE + 'js/ui-dashboard.js', BASE + 'js/ui-members.js', BASE + 'js/ui-savings.js',
  BASE + 'js/ui-loans.js', BASE + 'js/ui-welfare.js', BASE + 'js/ui-dividend.js',
  BASE + 'js/ui-reports.js', BASE + 'js/ui-settings.js', BASE + 'js/ui-audit.js',
  BASE + 'js/ui-login.js', BASE + 'js/receipt.js', BASE + 'js/ui-payday.js', BASE + 'js/ui-verify.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // ทุกการเขียนข้อมูลเป็น API (ตอน sync) ไม่ใช่ fetch ของ app
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // ปล่อย GitHub API ผ่านไปตรง ๆ
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) =>
      hit ||
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(BASE + 'index.html'))    // offline fallback
    )
  );
});
