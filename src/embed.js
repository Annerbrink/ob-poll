'use strict';

/**
 * The "just a link" embedding path. Some newsroom CMSs only let editors paste a
 * URL, not an <iframe>. This builds:
 *   - a canonical poll page at /p/<id> that carries oEmbed discovery + Open Graph
 *     tags, so pasting that one link works whether the CMS auto-discovers oEmbed,
 *     unfurls the link into a card, or just keeps it as a hyperlink; and
 *   - the oEmbed payload that endpoint returns — the same iframe the author can
 *     also copy by hand, so the old manual embed keeps working unchanged.
 */

const PROVIDER_NAME = 'Ölandsbladet 1 X 2';
const WIDGET_WIDTH = 520;
const WIDGET_HEIGHT = 460;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function fixtureTitle(poll) {
  return poll.homeTeam + ' – ' + poll.awayTeam;
}

/** Poll id from a canonical link (/p/<id>) or the raw widget URL (?poll=<id>). */
function pollIdFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const canonical = url.pathname.match(/^\/p\/([^/]+)\/?$/);
    if (canonical) return decodeURIComponent(canonical[1]);
    if (url.pathname === '/widget.html') return url.searchParams.get('poll') || null;
    return null;
  } catch (error) {
    return null;
  }
}

function originOf(urlString, fallback) {
  try {
    return new URL(urlString).origin;
  } catch (error) {
    return fallback;
  }
}

/**
 * The iframe (plus the tiny auto-height script) that actually renders the poll.
 * The script refines the height when the host keeps it; if a strict CMS strips
 * it, the fixed height still shows the whole card.
 */
function embedHtml(origin, poll, width) {
  const src = origin + '/widget.html?poll=' + encodeURIComponent(poll.id);
  const title = escapeHtml('1 X 2: ' + fixtureTitle(poll));
  const maxWidth = width || WIDGET_WIDTH;
  return (
    '<iframe src="' + escapeHtml(src) + '" title="' + title + '" ' +
    'style="width:100%;max-width:' + maxWidth + 'px;height:' + WIDGET_HEIGHT + 'px;border:0" ' +
    'loading="lazy"></iframe>' +
    '<script>window.addEventListener("message",function(e){' +
    'if(!e.data||e.data.type!=="ob-poll:height")return;' +
    'document.querySelectorAll("iframe").forEach(function(f){' +
    'if(f.contentWindow===e.source){f.style.height=e.data.height+"px";}});});</' + 'script>'
  );
}

/** The oEmbed "rich" payload a consumer gets back for a poll link. */
function oembedPayload(origin, poll, options) {
  const opts = options || {};
  let width = WIDGET_WIDTH;
  if (opts.maxwidth > 0) width = Math.min(width, opts.maxwidth);
  let height = WIDGET_HEIGHT;
  if (opts.maxheight > 0) height = Math.min(height, opts.maxheight);

  return {
    version: '1.0',
    type: 'rich',
    provider_name: PROVIDER_NAME,
    provider_url: origin,
    title: fixtureTitle(poll),
    width: width,
    height: height,
    html: embedHtml(origin, poll, width)
  };
}

/** The page an editor links to; carries oEmbed discovery + OG and shows the poll. */
function pollPageHtml(origin, poll) {
  const title = escapeHtml(fixtureTitle(poll));
  const pageUrl = origin + '/p/' + encodeURIComponent(poll.id);
  const oembedUrl = origin + '/api/oembed?url=' + encodeURIComponent(pageUrl) + '&format=json';
  const description = 'Vem vinner? Rösta i vår 1 X 2-omröstning.';

  return [
    '<!doctype html>',
    '<html lang="sv">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>' + title + ' – tippa matchen</title>',
    '<link rel="alternate" type="application/json+oembed" href="' + escapeHtml(oembedUrl) + '" title="' + title + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="' + escapeHtml(PROVIDER_NAME) + '">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    '<meta property="og:url" content="' + escapeHtml(pageUrl) + '">',
    '<meta name="twitter:card" content="summary">',
    '</head>',
    '<body style="margin:0;background:transparent">',
    embedHtml(origin, poll),
    '</body>',
    '</html>'
  ].join('\n');
}

module.exports = {
  pollIdFromUrl,
  originOf,
  embedHtml,
  oembedPayload,
  pollPageHtml,
  PROVIDER_NAME,
  WIDGET_WIDTH,
  WIDGET_HEIGHT
};
