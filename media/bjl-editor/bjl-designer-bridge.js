/**
 * BJL Designer Bridge — connects the SithasoBJLDesigner web component
 * to the VS Code extension host via postMessage.
 */
(function () {
  'use strict';

  function debug(msg) {
    console.log('[BJL Bridge] ' + msg);
  }

  window.onerror = function (message, source, lineno, colno, error) {
    debug('GLOBAL ERROR: ' + message + ' at ' + source + ':' + lineno);
    console.error('[BJL Bridge] Global error:', message, error);
    return false;
  };
  window.addEventListener('unhandledrejection', function (event) {
    debug('UNHANDLED REJECTION: ' + (event.reason && event.reason.message ? event.reason.message : event.reason));
    console.error('[BJL Bridge] Unhandled rejection:', event.reason);
  });

  var vscode;
  try {
    vscode = acquireVsCodeApi();
    debug('VS Code API acquired');
  } catch (e) {
    debug('FATAL: Failed to acquire VS Code API: ' + e.message);
    return;
  }

  function getVsCodeTheme() {
    var bg = getComputedStyle(document.body).getPropertyValue('--vscode-editor-background').trim();
    if (!bg) return 'dark';
    var hex = bg.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    var r = parseInt(hex.substring(0,2), 16);
    var g = parseInt(hex.substring(2,4), 16);
    var b = parseInt(hex.substring(4,6), 16);
    var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance < 0.5 ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  var designer = document.getElementById('designer');
  if (!designer) {
    debug('FATAL: #designer element not found');
    vscode.postMessage({ type: 'error', message: 'Designer element not found' });
    return;
  }
  debug('Designer element found');

  var DesignerClass = customElements.get('bjl-designer');
  if (!DesignerClass) {
    debug('FATAL: customElements.get("bjl-designer") returned undefined. SithasoBJLDesigner.js may have failed to load or threw during execution.');
    vscode.postMessage({ type: 'error', message: 'Designer custom element not defined' });
    return;
  }
  debug('Custom element bjl-designer is registered');

  if (!(designer instanceof DesignerClass)) {
    debug('WARNING: Designer element is NOT an instance of SithasoBJLDesigner. Forcing upgrade...');
    try {
      customElements.upgrade(designer);
    } catch (e) {
      debug('ERROR: customElements.upgrade failed: ' + e.message);
    }
  }
  if (typeof designer.refresh !== 'function') {
    debug('FATAL: designer.refresh is not a function. The custom element was not properly upgraded.');
    vscode.postMessage({ type: 'error', message: 'Designer custom element not properly upgraded' });
    return;
  }
  debug('Designer has refresh() method');

  if (!window.SithasoLib || !window.SithasoLib.Engine) {
    debug('FATAL: window.SithasoLib.Engine is not defined. SithasoLayoutEngine.js may have failed to load.');
    vscode.postMessage({ type: 'error', message: 'Layout engine not loaded' });
    return;
  }
  debug('SithasoLib.Engine is available');

  // Prevent the designer from restoring any stale draft from localStorage
  // before the extension host sends the actual file data.
  localStorage.removeItem('bjl_draft');
  designer._restoreDraft = function () {};

  var engine = designer.engine || new window.SithasoLib.Engine();
  designer.engine = engine;
  debug('Engine initialized');

  if (!designer.querySelector('.designer-container')) {
    debug('Designer internal DOM missing, calling render()...');
    if (typeof designer.render === 'function') {
      designer.render();
    }
  }
  if (!designer.querySelector('.designer-container')) {
    debug('FATAL: Designer still has no internal DOM after render()');
    vscode.postMessage({ type: 'error', message: 'Designer failed to render' });
    return;
  }
  debug('Designer internal DOM present');

  applyTheme(getVsCodeTheme());
  debug('Theme applied: ' + getVsCodeTheme());

  vscode.postMessage({ type: 'ready' });
  debug('Sent ready to extension');

  window.addEventListener('message', function (event) {
    var message = event.data;
    debug('Received message: ' + (message.type || 'unknown'));

    switch (message.type) {
      case 'loadFile':
        (async function () {
          try {
            var layout;
            if (message.fileType === 'binary') {
              var raw = atob(message.fileData);
              var bytes = new Uint8Array(raw.length);
              for (var i = 0; i < raw.length; i++) { bytes[i] = raw.charCodeAt(i); }
              var converter = new BJLConverter();
              layout = await converter.convertBjlToJsonFromBytes(bytes);
            } else {
              layout = JSON.parse(message.fileData);
            }
            if (typeof designer.clearState === 'function') {
              designer.clearState();
            }
            engine.layout = layout;
            engine.syncVariantBoundsFromLayout();
            designer._currentFilename = message.fileName || 'layout.bjl';
            var titleEl = designer.querySelector('#toolbarTitle');
            if (titleEl) { titleEl.innerText = designer._currentFilename; }
            designer.refresh();
            designer._updateOutline();
            debug('File loaded: ' + designer._currentFilename + ', layout keys: ' + Object.keys(layout || {}).join(','));
          } catch (err) {
            debug('ERROR loading file: ' + (err.message || err));
            console.error('[BJL Bridge] Failed to load file:', err);
            vscode.postMessage({ type: 'showError', text: 'Failed to load layout: ' + (err.message || err) });
          }
        })();
        break;

      case 'saveComplete':
        var saveStatus = designer.querySelector('#saveStatus');
        if (saveStatus) {
          saveStatus.textContent = 'Saved';
          setTimeout(function () { saveStatus.style.opacity = '0.3'; }, 2000);
        }
        break;

      case 'revert':
        if (message.fileData) {
          (async function () {
            try {
              var layout2;
              if (message.fileType === 'binary') {
                var raw2 = atob(message.fileData);
                var bytes2 = new Uint8Array(raw2.length);
                for (var j = 0; j < raw2.length; j++) { bytes2[j] = raw2.charCodeAt(j); }
                layout2 = await new BJLConverter().convertBjlToJsonFromBytes(bytes2);
              } else {
                layout2 = JSON.parse(message.fileData);
              }
              if (typeof designer.clearState === 'function') {
                designer.clearState();
              }
              engine.layout = layout2;
              engine.syncVariantBoundsFromLayout();
              designer.refresh();
              designer._updateOutline();
            } catch (err2) {
              debug('ERROR reverting file: ' + (err2.message || err2));
              console.error('[BJL Bridge] Failed to revert:', err2);
            }
          })();
        }
        break;

      case 'themeChanged':
        applyTheme(message.theme || 'dark');
        break;

      case 'error':
        console.error('[BJL Bridge] Extension error:', message.message);
        break;
    }
  });

  debug('Bridge initialized successfully');
})();
