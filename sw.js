const CACHE='dtz-speaking-v1.0.0';
const STATIC=[
  '/', '/index.html', '/styles.css?v=1.0.0', '/app.js?v=1.0.0', '/realtime.js?v=1.0.0', '/manifest.webmanifest',
  '/assets/icon-192.png','/assets/icon-512.png',
  '/assets/school_family.jpg','/assets/supermarket_family.jpg','/assets/family_home.jpg'
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
