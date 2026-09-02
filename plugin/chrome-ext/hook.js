/* document_start: keep the real Discord webpack require (not the polyfill instance). */
(function () {
  if (window.__deckscordWpHook) return;
  window.__deckscordWpHook = 1;

  function steal(req) {
    if (!req || typeof req !== "function" || !req.c) return;
    if (req.p && req.p !== "/assets/") return;
    var n = 0;
    for (var k in req.c) n++;
    if (!window.__deckscordReq || n >= (window.__deckscordReqN || 0)) {
      window.__deckscordReq = req;
      window.__deckscordReqN = n;
    }
  }

  function trap(arr) {
    if (!arr || arr.__dsTrap) return arr;
    arr.__dsTrap = 1;
    var inner = arr.push.bind(arr);
    function wrapped() {
      try {
        var d = arguments[0];
        if (d && typeof d[2] === "function") {
          var prev = d[2];
          d[2] = function (req) {
            try { steal(req); } catch (eS) {}
            return prev.apply(this, arguments);
          };
        }
      } catch (eW) {}
      return inner.apply(null, arguments);
    }
    try {
      Object.defineProperty(arr, "push", {
        configurable: true,
        get: function () { return wrapped; },
        set: function (fn) {
          if (typeof fn === "function") inner = fn;
          try { inner([[Symbol.for("ds")], {}, function (req) { steal(req); }]); } catch (eI) {}
        }
      });
    } catch (eD) {
      arr.push = wrapped;
    }
    return arr;
  }

  var cur;
  try {
    Object.defineProperty(window, "webpackChunkdiscord_app", {
      configurable: true,
      enumerable: true,
      get: function () { return cur; },
      set: function (v) { cur = trap(v); }
    });
  } catch (e0) {}
  if (window.webpackChunkdiscord_app) trap(window.webpackChunkdiscord_app);
})();
