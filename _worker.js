const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","Washington D.C.","West Virginia","Wisconsin","Wyoming"
];

function stateToSlug(state) {
  return state.toLowerCase().replace(/\.\s*/g, '').replace(/\s+/g, '-');
}

const SLUG_TO_STATE = Object.fromEntries(US_STATES.map(s => [stateToSlug(s), s]));

function escAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\/script>/gi, '<\\/script>');
}

async function fetchArticles(env) {
  const apiUrl = env.API_URL;
  if (!apiUrl) throw new Error('API_URL environment variable is not set in Cloudflare');

  const cache = caches.default;
  const cacheReq = new Request(apiUrl);

  const hit = await cache.match(cacheReq);
  if (hit) return hit.json();

  const res = await fetch(apiUrl);
  if (!res.ok) throw new Error(`Railway API responded ${res.status}`);
  const data = await res.json();

  await cache.put(cacheReq, new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
  }));
  return data;
}

async function getTemplate(name, request, env) {
  const url = new URL(`/${name}`, request.url);
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) throw new Error(`Template ${name} not found`);
  return res.text();
}

function injectHead(html, { title, description, canonical, keywords = '', ogType = 'website', jsonLd = '' }) {
  html = html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title id="page-title">${escAttr(title)}</title>`);
  html = html.replace(/<meta\s+name="description"[^>]*>/i,
    `<meta name="description" id="page-desc" content="${escAttr(description)}">`);

  const tags = [
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(description)}">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:type" content="${ogType || 'website'}">`,
    keywords ? `<meta name="keywords" content="${escAttr(keywords)}">` : '',
    jsonLd ? `<script type="application/ld+json">${jsonLd.replace(/<\/script>/gi, '<\\/script>')}</script>` : '',
  ].filter(Boolean).join('\n  ');

  return html.replace('</head>', `  ${tags}\n</head>`);
}

async function handleArticle(stateSlug, pageURL, request, env) {
  const state = SLUG_TO_STATE[stateSlug.toLowerCase()];
  if (!state) return new Response('Not found', { status: 404 });

  const data = await fetchArticles(env);
  const article = data.articles?.find(a =>
    a.region?.toLowerCase() === state.toLowerCase() && a.pageURL === pageURL
  );
  if (!article) return new Response('Article not found', { status: 404 });

  let html = await getTemplate('news.html', request, env);
  const origin = new URL(request.url).origin;
  const canonical = `${origin}/${stateSlug}/${pageURL}`;
  const metaTitle = (article.meta?.title || article.title) + ' | US Data Center Projects';
  const metaDesc = article.meta?.description || '';

  html = injectHead(html, {
    title: metaTitle,
    description: metaDesc,
    canonical,
    keywords: article.meta?.keywords || '',
    ogType: 'article',
    jsonLd: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.title,
      description: metaDesc,
      datePublished: article.createdAt,
      keywords: Array.isArray(article.tags) ? article.tags.join(', ') : '',
      publisher: { '@type': 'Organization', name: 'US Data Center Projects' }
    })
  });

  html = html.replace('</body>', `<script>window.__ARTICLE__=${safeJson(article)};</script>\n</body>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}

async function handleState(stateSlug, request, env) {
  const state = SLUG_TO_STATE[stateSlug.toLowerCase()];
  if (!state) return null;

  const data = await fetchArticles(env);
  const articles = data.articles?.filter(a =>
    a.region?.toLowerCase() === state.toLowerCase()
  ) || [];

  let html = await getTemplate('state.html', request, env);
  const origin = new URL(request.url).origin;
  const canonical = `${origin}/${stateSlug}`;
  const metaTitle = `${state} Data Center News & Projects | US Data Center Projects`;
  const metaDesc = `Latest data center construction news, project updates, and developments across ${state}. Track ${state}'s full data center pipeline.`;

  html = injectHead(html, {
    title: metaTitle,
    description: metaDesc,
    canonical,
    ogType: 'website'
  });

  html = html.replace('</body>', `<script>window.__STATE__=${safeJson({ state, articles })};</script>\n</body>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=1800, s-maxage=1800'
    }
  });
}

async function handleSitemap(request, env) {
  const data = await fetchArticles(env);
  const origin = new URL(request.url).origin;

  const articleUrls = (data.articles || []).map(a => {
    const slug = stateToSlug(a.region || '');
    const date = a.createdAt ? a.createdAt.split('T')[0] : '';
    return `  <url><loc>${origin}/${slug}/${a.pageURL}</loc><lastmod>${date}</lastmod><priority>0.8</priority></url>`;
  });

  const stateSet = new Set((data.articles || []).map(a => a.region).filter(Boolean));
  const stateUrls = [...stateSet].map(s =>
    `  <url><loc>${origin}/${stateToSlug(s)}</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${origin}/us-data-center-project-tracker</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>${origin}/about</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>
${stateUrls.join('\n')}
${articleUrls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(request, env);
    }

    // Proxy news API — keeps credentials server-side
    if (url.pathname === '/api/news') {
      try {
        const data = await fetchArticles(env);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // Root → news hub (homepage)
    if (url.pathname === '/' || url.pathname === '') {
      return env.ASSETS.fetch(new Request(new URL('/data-center-news.html', request.url).toString()));
    }

    // Projects tracker
    if (url.pathname === '/us-data-center-project-tracker') {
      return env.ASSETS.fetch(new Request(new URL('/us-data-center-project-tracker.html', request.url).toString()));
    }

    // About page
    if (url.pathname === '/about') {
      return env.ASSETS.fetch(new Request(new URL('/about.html', request.url).toString()));
    }

    // Legacy /news → redirect to homepage
    if (url.pathname === '/news') {
      return Response.redirect(new URL('/', request.url).toString(), 301);
    }

    // Legacy alias → redirect to homepage
    if (url.pathname === '/united-states-data-center-news') {
      return Response.redirect(new URL('/', request.url).toString(), 301);
    }

    // Static assets first
    try {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    } catch {}

    const parts = url.pathname.split('/').filter(Boolean);

    try {
      if (parts.length === 2) {
        return handleArticle(parts[0], decodeURIComponent(parts[1]), request, env);
      }
      if (parts.length === 1) {
        const res = await handleState(parts[0], request, env);
        if (res) return res;
      }
    } catch (err) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }

    return new Response('Not found', { status: 404 });
  }
};
