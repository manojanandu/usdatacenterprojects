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

// Module-level CSS cache — survives across requests within the same Worker instance
let _cssCache = null;

async function getTemplate(name, request, env) {
  const url = new URL(`/${name}`, request.url);
  const res = await env.ASSETS.fetch(new Request(url.toString()));
  if (!res.ok) throw new Error(`Template ${name} not found`);
  let html = await res.text();

  // Inline /styles.css to eliminate the critical request chain
  if (html.includes('href="/styles.css"')) {
    if (_cssCache === null) {
      const cssUrl = new URL('/styles.css', request.url);
      const cssRes = await env.ASSETS.fetch(new Request(cssUrl.toString()));
      _cssCache = cssRes.ok ? await cssRes.text() : '';
    }
    if (_cssCache) {
      html = html.replace('<link rel="stylesheet" href="/styles.css">', `<style>${_cssCache}</style>`);
    }
  }

  return html;
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
  const metaTitle = article.meta?.title || article.title;
  const metaDesc = article.meta?.description || '';

  if (article.image?.full) {
    html = html.replace('</head>',
      `  <link rel="preload" as="image" href="${escAttr(article.image.full)}" fetchpriority="high">\n</head>`);
  }

  html = injectHead(html, {
    title: metaTitle,
    description: metaDesc,
    canonical,
    keywords: article.meta?.keywords || '',
    ogType: 'article',
    jsonLd: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      headline: article.title,
      description: metaDesc,
      datePublished: article.createdAt,
      dateModified: article.updatedAt || article.createdAt,
      url: canonical,
      keywords: Array.isArray(article.tags) ? article.tags.join(', ') : '',
      author: {
        '@type': 'Organization',
        name: 'US Data Center Projects',
        url: 'https://usdatacenterprojects.com'
      },
      publisher: {
        '@type': 'Organization',
        name: 'US Data Center Projects',
        url: 'https://usdatacenterprojects.com',
        logo: {
          '@type': 'ImageObject',
          url: 'https://usdatacenterprojects.com/Logo.svg',
          width: 260,
          height: 60
        }
      },
      ...(article.image?.full ? {
        image: {
          '@type': 'ImageObject',
          url: article.image.full,
          width: 1200,
          height: 675
        }
      } : {})
    })
  });

  const recent = (data.articles || [])
    .filter(a => a.pageURL !== article.pageURL)
    .slice(0, 5);

  html = html.replace('</body>', `<script>window.__ARTICLE__=${safeJson(article)};window.__RECENT__=${safeJson(recent)};</script>\n</body>`);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600'
    }
  });
}

async function handleHome(request, env) {
  const data = await fetchArticles(env);
  let html = await getTemplate('data-center-news.html', request, env);

  // Preload the hero (first article) LCP image before JS runs
  const heroImgFull = data.articles?.[0]?.image?.full;
  if (heroImgFull) {
    html = html.replace('</head>',
      `  <link rel="preload" as="image" href="${escAttr(heroImgFull)}" fetchpriority="high">\n</head>`);
  }

  html = html.replace('</body>', `<script>window.__NEWS_DATA__=${safeJson(data)};</script>\n</body>`);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300'
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
  const metaTitle = `${state} Data Center News | Projects, Permits & Construction Updates`;
  const metaDesc = `Latest data center construction news and project intelligence for ${state} — permit filings, contractor activity, MW capacity, and developer updates. Track every active data center project in ${state}.`;
  const metaKeywords = `${state} data center news, ${state} data center projects, ${state} data center construction, data center permits ${state}`;

  html = injectHead(html, {
    title: metaTitle,
    description: metaDesc,
    canonical,
    keywords: metaKeywords,
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

function escXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function handleNewsSitemap(request, env) {
  const data = await fetchArticles(env);
  const origin = new URL(request.url).origin;
  const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;

  const items = (data.articles || [])
    .filter(a => a.createdAt && new Date(a.createdAt).getTime() >= twoDaysAgo)
    .map(a => {
      const slug = stateToSlug(a.region || '');
      const pubDate = a.createdAt || '';
      return `  <url>
    <loc>${origin}/${slug}/${a.pageURL}</loc>
    <news:news>
      <news:publication>
        <news:name>US Data Center Projects</news:name>
        <news:language>en</news:language>
      </news:publication>
      <news:publication_date>${escXml(pubDate)}</news:publication_date>
      <news:title>${escXml(a.meta?.title || a.title)}</news:title>
    </news:news>
  </url>`;
    });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${items.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=300' }
  });
}

async function handleRSS(request, env) {
  const data = await fetchArticles(env);
  const origin = new URL(request.url).origin;

  const articles = (data.articles || [])
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);

  const items = articles.map(a => {
    const slug = stateToSlug(a.region || '');
    const link = `${origin}/${slug}/${a.pageURL}`;
    const pubDate = a.createdAt ? new Date(a.createdAt).toUTCString() : '';
    const description = (a.meta?.description || a.description || '').slice(0, 300);
    return `    <item>
      <title>${escXml(a.meta?.title || a.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escXml(description)}</description>
      ${a.region ? `<category>${escXml(a.region)}</category>` : ''}
    </item>`;
  });

  const lastBuildDate = articles[0]?.createdAt
    ? new Date(articles[0].createdAt).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>US Data Center Projects</title>
    <link>${origin}</link>
    <description>Breaking news and daily intelligence on US data center construction across all 50 states.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml;charset=UTF-8', 'Cache-Control': 'public, max-age=300' }
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

    // Redirect www → non-www (301 permanent) so only one version gets indexed
    if (url.hostname === 'www.usdatacenterprojects.com') {
      const canonical = new URL(request.url);
      canonical.hostname = 'usdatacenterprojects.com';
      return Response.redirect(canonical.toString(), 301);
    }

    if (url.pathname === '/sitemap.xml') {
      return handleSitemap(request, env);
    }

    if (url.pathname === '/news-sitemap.xml') {
      return handleNewsSitemap(request, env);
    }

    if (url.pathname === '/rss.xml') {
      return handleRSS(request, env);
    }

    // Root → news hub (homepage)
    if (url.pathname === '/' || url.pathname === '') {
      return handleHome(request, env);
    }

    // Projects tracker
    if (url.pathname === '/us-data-center-project-tracker') {
      const html = await getTemplate('us-data-center-project-tracker.html', request, env);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=3600' } });
    }

    // About page
    if (url.pathname === '/about') {
      const html = await getTemplate('about.html', request, env);
      return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'public, max-age=3600' } });
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
