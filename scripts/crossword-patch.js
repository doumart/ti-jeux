// Runs in MAIN world at document_start on www.nytimes.com
// Intercepts crossword.* scripts and patches the modal reducer to skip the "Start" modal.
(function () {
  'use strict';

  function patchCrossword(text) {
    // Original modal reducer case:
    //   case vt: return { name: t.payload.name, config: t.payload.config || null, isClosing: !1 }
    // Patched: if payload.name === "Start", return existing state (e) unchanged.
    const patched = text.replace(
      /(case \w+:)\s*return\s*\{\s*name:\s*t\.payload\.name,\s*config:\s*t\.payload\.config\s*\|\|\s*null,\s*isClosing:\s*!1\s*\}/,
      '$1if(t.payload.name==="Start"){return e}return{name:t.payload.name,config:t.payload.config||null,isClosing:!1}'
    );
    if (patched === text) {
      console.warn('[tijeux] crossword patch: pattern not found — script may have changed');
    } else {
      console.log('[tijeux] crossword patch: applied successfully');
    }
    return patched;
  }

  function isCrosswordSrc(src) {
    return typeof src === 'string' && /crossword\./.test(src);
  }

  // Fetch, patch, and re-insert the script element with inline content.
  // Returns true if the script was intercepted.
  function interceptScript(scriptEl, parentNode, insertRef) {
    const src = scriptEl.getAttribute('src') || '';
    if (!isCrosswordSrc(src)) return false;

    // Remove src so the browser never fetches the original.
    scriptEl.removeAttribute('src');

    fetch(src)
      .then((r) => r.text())
      .then((text) => {
        scriptEl.textContent = patchCrossword(text);
        if (insertRef) {
          origInsertBefore.call(parentNode, scriptEl, insertRef);
        } else {
          origAppendChild.call(parentNode, scriptEl);
        }
      })
      .catch((err) => {
        console.error('[tijeux] crossword patch: fetch failed', err);
        // Restore original src and insert anyway so the page doesn't break.
        scriptEl.setAttribute('src', src);
        origAppendChild.call(parentNode, scriptEl);
      });

    return true;
  }

  const origAppendChild = Node.prototype.appendChild;
  const origInsertBefore = Node.prototype.insertBefore;

  // Override appendChild — catches dynamically injected scripts (e.g. webpack chunk loader).
  Node.prototype.appendChild = function (node) {
    if (node && node.nodeName === 'SCRIPT' && interceptScript(node, this, null)) {
      return node;
    }
    return origAppendChild.call(this, node);
  };

  // Override insertBefore — some loaders use this instead.
  Node.prototype.insertBefore = function (node, ref) {
    if (node && node.nodeName === 'SCRIPT' && interceptScript(node, this, ref)) {
      return node;
    }
    return origInsertBefore.call(this, node, ref);
  };

  // MutationObserver fallback — catches scripts added by the HTML parser,
  // which bypasses appendChild. For large remote scripts the download
  // is still in-flight when this fires, so removal prevents execution.
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeName !== 'SCRIPT') continue;
        const src = node.getAttribute('src') || '';
        if (!isCrosswordSrc(src)) continue;

        const parent = node.parentNode;
        const next = node.nextSibling;
        parent.removeChild(node);
        node.removeAttribute('src');

        fetch(src)
          .then((r) => r.text())
          .then((text) => {
            node.textContent = patchCrossword(text);
            if (next) {
              origInsertBefore.call(parent, node, next);
            } else {
              origAppendChild.call(parent, node);
            }
          })
          .catch((err) => {
            console.error('[tijeux] crossword patch: fetch failed', err);
            node.setAttribute('src', src);
            origAppendChild.call(parent, node);
          });
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  console.log('[tijeux] crossword patch: initialized');
})();
