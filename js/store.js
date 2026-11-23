/* QalaAccess AI — report storage (localStorage) + simple change events. */
(function () {
  "use strict";
  var KEY = "qalaaccess.reports.v2"; // v2: all reports verified
  var listeners = [];
  var memory = null; // fallback if localStorage is unavailable

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* private mode etc. */ }
    if (memory) return memory;
    return clone(window.QA_SEED_REPORTS || []);
  }

  function save(list) {
    memory = list;
    try { localStorage.setItem(KEY, JSON.stringify(list)); }
    catch (e) {
      // Usually: storage full because of photos. Retry without photos.
      try {
        localStorage.setItem(KEY, JSON.stringify(list.map(function (r) { var c = Object.assign({}, r); delete c.photo; return c; })));
      } catch (e2) { /* keep in memory only */ }
    }
    listeners.forEach(function (fn) { fn(list); });
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  var Store = {
    all: function () { return load(); },
    add: function (r) {
      var list = load();
      r.id = "r-" + Date.now().toString(36);
      r.status = "verified"; // prototype decision: user reports are shown as verified immediately
      r.sample = false;
      r.created = today();
      r.checked = today();
      list.push(r);
      save(list);
      return r;
    },
    setStatus: function (id, status) {
      var list = load();
      list.forEach(function (r) {
        if (r.id === id) { r.status = status; r.checked = status === "reported" ? undefined : today(); }
      });
      save(list);
    },
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      memory = null;
      save(clone(window.QA_SEED_REPORTS || []));
    },
    onChange: function (fn) { listeners.push(fn); }
  };

  window.QA = window.QA || {};
  window.QA.Store = Store;
})();
