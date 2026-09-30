const CACHE='dtz-speaking-v1.3.0';
const STATIC=[
  '/',
  '/index.html',
  '/styles.css?v=1.3.0',
  '/app.js?v=1.3.0',
  '/realtime.js?v=1.3.0',
  '/manifest.webmanifest',
  '/data/photoTasks.json',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/photos/dtz_01_schule.jpg',
  '/assets/photos/dtz_02_kindergarten.jpg',
  '/assets/photos/dtz_03_einkaufen.jpg',
  '/assets/photos/dtz_04_arzt.jpg',
  '/assets/photos/dtz_05_apotheke.jpg',
  '/assets/photos/dtz_06_arbeit.jpg',
  '/assets/photos/dtz_07_buero.jpg',
  '/assets/photos/dtz_08_wohnen.jpg',
  '/assets/photos/dtz_09_umzug.jpg',
  '/assets/photos/dtz_10_bus_bahn.jpg',
  '/assets/photos/dtz_11_bahnhof.jpg',
  '/assets/photos/dtz_12_verkehr.jpg',
  '/assets/photos/dtz_13_familie.jpg',
  '/assets/photos/dtz_14_freizeit.jpg',
  '/assets/photos/dtz_15_sport.jpg',
  '/assets/photos/dtz_16_park.jpg',
  '/assets/photos/dtz_17_restaurant.jpg',
  '/assets/photos/dtz_18_nachbarschaft.jpg',
  '/assets/photos/dtz_19_behoerde.jpg',
  '/assets/photos/dtz_20_post_paket.jpg',
  '/assets/photos/dtz_21_reise.jpg',
  '/assets/photos/dtz_22_feier.jpg',
  '/assets/photos/dtz_23_handwerker.jpg',
  '/assets/photos/dtz_24_telefon.jpg',
  '/assets/photos/dtz_25_ausflug.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request){
  try{
    const response=await fetch(request);
    if(response.ok){ const cache=await caches.open(CACHE); cache.put(request,response.clone()); }
    return response;
  }catch{
    return (await caches.match(request)) || (await caches.match('/index.html'));
  }
}

async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached) return cached;
  const response=await fetch(request);
  if(response.ok){ const cache=await caches.open(CACHE); cache.put(request,response.clone()); }
  return response;
}

self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.pathname.startsWith('/api/')) return;
  const ext=url.pathname.split('.').pop()?.toLowerCase();
  if(['jpg','jpeg','png','svg','webp'].includes(ext)) event.respondWith(cacheFirst(event.request));
  else event.respondWith(networkFirst(event.request));
});
