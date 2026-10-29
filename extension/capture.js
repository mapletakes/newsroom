// "Archive this page": captures the page as the reader's browser has it —
// rendered by its own scripts, signed in, past any paywall the reader has
// access to — for The Broadside to freeze into a public snapshot
// (app/api/archive/capture on the server does the rest).
//
// Injected into the tab by background.js only when the reader picks "Archive
// this page". It changes nothing on the live page: everything happens on a
// copy. Because the result is published, the copy is cleaned of the
// reader's own details before it leaves the browser:
//  - scripts go (they carry session data), except JSON-LD article metadata;
//  - account menus, avatars and sign-in widgets outside the article go;
//  - email addresses outside the article, and any words the reader listed
//    in Options (their name, say), are replaced;
//  - attributes that name users, sessions or tokens are dropped.
// That's best effort: a publisher can still hide a subscriber id somewhere
// invisible, which is why the extension opens the snapshot for a look.

function broadsideCapture(doc, scrubTerms) {
  var win = doc.defaultView;
  var live = [];
  function mark(el, name, value) {
    el.setAttribute(name, value);
    live.push([el, name]);
  }

  // The image each <img> actually shows, after srcset and lazy loading.
  doc.querySelectorAll('img').forEach(function (img) {
    if (img.currentSrc && !/^data:/.test(img.currentSrc)) mark(img, 'data-broadside-src', img.currentSrc);
  });

  // Stylesheets as the browser holds them: this picks up rules scripts
  // inserted (CSS-in-JS leaves its <style> tags empty) and the text of
  // cross-origin sheets the page was allowed to read. Sheets the browser
  // won't let us read stay as <link>s for the server to fetch.
  var sheets = [];
  Array.prototype.forEach.call(doc.styleSheets, function (sheet) {
    try {
      var css = Array.prototype.map.call(sheet.cssRules, function (r) { return r.cssText; }).join('\n');
      if (sheet.ownerNode && sheet.ownerNode.setAttribute) {
        mark(sheet.ownerNode, 'data-broadside-sheet', String(sheets.length));
        sheets.push(css);
      }
    } catch {
      /* cross-origin sheet without CORS: left for the server */
    }
  });
  var adopted = '';
  try {
    adopted = Array.prototype.map.call(doc.adoptedStyleSheets || [], function (s) {
      return Array.prototype.map.call(s.cssRules, function (r) { return r.cssText; }).join('\n');
    }).join('\n');
  } catch {
    /* not supported */
  }

  var root = doc.documentElement.cloneNode(true);
  live.forEach(function (pair) { pair[0].removeAttribute(pair[1]); });

  root.querySelectorAll('[data-broadside-sheet]').forEach(function (el) {
    var style = doc.createElement('style');
    style.textContent = sheets[Number(el.getAttribute('data-broadside-sheet'))];
    if (el.tagName === 'LINK') style.setAttribute('data-href', el.href);
    var media = el.getAttribute('media');
    var flipped = /media\s*=/.test(el.getAttribute('onload') || '');
    if (media && media !== 'all' && !flipped) style.setAttribute('media', media);
    el.replaceWith(style);
  });
  if (adopted) {
    var extra = doc.createElement('style');
    extra.textContent = adopted;
    (root.querySelector('head') || root).appendChild(extra);
  }

  // What the reader saw ran with scripts, so <noscript> fallbacks weren't
  // showing; and scripts are where pages keep session and account data.
  root.querySelectorAll('noscript').forEach(function (el) { el.remove(); });
  root.querySelectorAll('script').forEach(function (el) {
    if ((el.getAttribute('type') || '').toLowerCase() !== 'application/ld+json') el.remove();
  });

  var inArticle = function (el) { return !!el.closest('article, main, [role="main"]'); };
  var ACCOUNT_UI = [
    '[class*="account" i]', '[id*="account" i]', '[class*="user-menu" i]', '[class*="usermenu" i]',
    '[class*="avatar" i]', '[class*="profile-menu" i]', '[class*="logged-in" i]', '[class*="signin" i]',
    '[class*="sign-in" i]', '[class*="login" i]', '[aria-label*="account" i]', '[data-testid*="account" i]',
    '[data-testid*="user" i]', '[data-testid*="profile" i]',
  ].join(',');
  root.querySelectorAll(ACCOUNT_UI).forEach(function (el) {
    if (!inArticle(el) && el !== root && el.tagName !== 'BODY' && el.tagName !== 'HEAD') el.remove();
  });

  var PRIVATE_ATTR = /(user|email|account|subscriber|session|token|customer|member)/i;
  root.querySelectorAll('*').forEach(function (el) {
    Array.prototype.slice.call(el.attributes).forEach(function (a) {
      if (/^data-/.test(a.name) && PRIVATE_ATTR.test(a.name)) el.removeAttribute(a.name);
    });
  });
  root.querySelectorAll('meta').forEach(function (m) {
    if (PRIVATE_ATTR.test(m.getAttribute('name') || '') || PRIVATE_ATTR.test(m.getAttribute('property') || '')) m.remove();
  });

  var EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
  var terms = (scrubTerms || []).map(function (t) { return String(t).trim(); }).filter(function (t) { return t.length >= 3; });
  var termRe = terms.length
    ? new RegExp(terms.map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'gi')
    : null;
  var walker = doc.createTreeWalker(root, win ? win.NodeFilter.SHOW_TEXT : 4);
  var texts = [];
  for (var n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  texts.forEach(function (t) {
    var v = t.nodeValue;
    if (termRe) v = v.replace(termRe, '[removed]');
    if (t.parentElement && !inArticle(t.parentElement)) v = v.replace(EMAIL, '[email removed]');
    if (v !== t.nodeValue) t.nodeValue = v;
  });
  if (termRe) {
    root.querySelectorAll('*').forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (termRe.test(a.value)) el.setAttribute(a.name, a.value.replace(termRe, '[removed]'));
        termRe.lastIndex = 0;
      });
    });
  }

  return {
    url: doc.location ? doc.location.href : '',
    title: doc.title,
    html: '<!DOCTYPE html>\n' + root.outerHTML,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { broadsideCapture: broadsideCapture };
}

// As an injected script, the value of this last expression is what
// chrome.scripting.executeScript hands back to background.js.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
typeof document !== 'undefined' && typeof module === 'undefined'
  ? broadsideCapture(document, globalThis.__broadsideScrubTerms || [])
  : null;
