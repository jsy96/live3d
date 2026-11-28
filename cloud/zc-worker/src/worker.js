// zc.leige.online — Cloudflare Worker fronting the CloudBase-hosted pet page.
//
// The pet site lives in Tencent CloudBase static hosting under /pet/ on its
// default test domain (which browsers greet with a "risk reminder"
// interstitial — that domain is not meant for sharing). This Worker gives the
// pet its own clean domain at the root: everything is proxied same-origin, so
// the page, its /pet/-absolute asset URLs, live.json and the PWA bits all
// work unchanged, and the underlying origin never appears in the page.
//
// Path mapping:
//   /            ->  <origin>/pet/     (the pet at the domain root)
//   /pet/...     ->  <origin>/pet/...  (passthrough for the page's absolute refs)
//   anything else -> <origin>/pet/<it>
//
// Caching: big binaries (models/animations/icons/fonts) cache at the edge for
// 10 minutes, the versioned bundle/styles for a day; JSON state and HTML are
// always fetched fresh so redeploys and live.json updates show immediately.

const ORIGIN = 'https://ajmj-d2g1eishpbe7677fe-1301305388.tcloudbaseapp.com';
const PET = '/pet';

// Extensions safe to edge-cache without a version marker (content-addressed
// enough for a toy: a replaced model shows within 10 minutes). js/css carry
// ?v= version queries, so they cache for a day too.
const LONG_CACHE = /\.(png|ico|jpe?g|webp|woff2?|ttf|js|css)$/i;
const SHORT_CACHE = /\.(vrm|vrma|glb)$/i;
const NEVER_CACHE = /(\.json$|index\.html$|cdn-config|^\/pet\/?$|^\/?$)/i;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname;
    if (path === PET) path = PET + '/';
    const upstreamPath =
      path === PET + '/' || path.startsWith(PET + '/') ? path : PET + path;
    const target = ORIGIN + upstreamPath + url.search;

    // TCB's own edge caches by URL — index.html's URL never changes, so a
    // redeployed page could serve stale HTML (with its old ?v= asset refs)
    // indefinitely. Bust the ORIGIN url for never-cache paths (the query is
    // ignored by static hosting but gives every request a fresh cache key).
    const originUrl = NEVER_CACHE.test(path) ? ORIGIN + upstreamPath + (url.search || `?_=${Date.now()}`) : target;

    const cacheKey = new Request(target, { method: 'GET' });
    const cache = caches.default;

    let cf;
    if (LONG_CACHE.test(path)) cf = { cacheTtl: 86400, cacheEverything: true };
    else if (SHORT_CACHE.test(path)) cf = { cacheTtl: 600, cacheEverything: true };

    if (request.method === 'GET' && cf) {
      const hit = await cache.match(cacheKey);
      if (hit) return hit;
    }

    // Header hygiene for the origin subrequest (learned the hard way):
    //   - Sec-Fetch-* browser hints make the TCB test-domain edge serve its
    //     "risk reminder" interstitial — strip them (UA alone is innocent).
    //   - Without an Accept header TCB answers Content-Disposition:
    //     attachment (browsers download instead of rendering) — keep Accept.
    //   - Accept-Encoding must NOT be forwarded (Workers manages it).
    const PASS_HEADERS = ['accept', 'accept-language', 'range', 'if-none-match', 'if-modified-since', 'user-agent'];
    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const v = request.headers.get(name);
      if (v) headers.set(name, v);
    }
    const init = {
      method: request.method,
      headers,
      body: /^GET$|^HEAD$/.test(request.method) ? undefined : request.body,
      redirect: 'follow',
    };
    if (NEVER_CACHE.test(path)) init.cache = 'no-store';
    else if (cf) init.cf = cf;

    let res;
    try {
      res = await fetch(originUrl, init);
    } catch (err) {
      return new Response(`origin unreachable: ${err.message}`, { status: 502 });
    }

    // Normalize the origin response: TCB's test-domain edge labels everything
    // Content-Disposition: attachment (browsers would download instead of
    // rendering the page) — these are web assets, never downloads.
    const clean = (r) => {
      const out = new Response(r.body, r);
      out.headers.delete('Content-Disposition');
      if (out.headers.get('Content-Type')?.startsWith('text/html')) {
        out.headers.set('Content-Type', 'text/html; charset=utf-8');
      }
      return out;
    };

    // Cache only plain 200s (not redirects/partials with varying Range keys).
    if (request.method === 'GET' && cf && res.status === 200) {
      const cached = clean(res);
      cached.headers.set('Cache-Control', 'public, max-age=' + (LONG_CACHE.test(path) ? 86400 : 600));
      await cache.put(cacheKey, cached.clone());
      return cached;
    }
    return clean(res);
  },
};
