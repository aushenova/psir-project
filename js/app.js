/* QalaAccess AI — app shell: navigation, settings, shared helpers. */
(function () {
  "use strict";
  var QA = window.QA;
  var G = window.QA_GRAPH;

  QA.router = new QA.Router(G, window.QA_DEMO_ATTRIBUTES || []);
  QA.landmarks = window.QA_LANDMARKS;

  // ---------- helpers ----------
  QA.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  QA.fmtM = function (m) { return m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m"; };
  QA.fmtLL = function (lat, lng) { return lat.toFixed(5) + ", " + lng.toFixed(5); };
  QA.STATUS = {
    verified: { label: "Verified", sym: "✓", desc: "Shown on the map and used by the route planner" },
    reported: { label: "Reported", sym: "?", desc: "Submitted" },
    rejected: { label: "Rejected", sym: "✕", desc: "Not used" }
  };
  QA.statusBadge = function (st) {
    var s = QA.STATUS[st] || { label: "Unknown", sym: "–" };
    return '<span class="badge ' + (QA.STATUS[st] ? st : "unknown") + '"><span aria-hidden="true">' + s.sym + "</span> " + s.label + "</span>";
  };
  QA.sourceBadge = function (r) {
    return r.sample
      ? '<span class="badge sample">Synthetic sample</span>'
      : '<span class="badge">Community report</span>';
  };
  QA.reportIcon = function (r, selected) {
    var cat = QA.REPORT_CATEGORIES[r.category] || QA.REPORT_CATEGORIES.other;
    var st = QA.STATUS[r.status] ? r.status : "reported";
    return L.divIcon({
      className: "",
      html: '<div class="qa-marker ' + st + (selected ? " selected" : "") + '" style="position:relative">' + cat.icon +
        '<span class="st">' + QA.STATUS[st].sym + "</span></div>",
      iconSize: [32, 32], iconAnchor: [16, 16]
    });
  };
  QA.reportPopup = function (r) {
    var cat = QA.REPORT_CATEGORIES[r.category] || QA.REPORT_CATEGORIES.other;
    var whys = Object.keys(cat.why).map(function (k) {
      return "<li>" + (QA.PREFERENCES[k] ? "<strong>" + QA.esc(QA.PREFERENCES[k]) + ":</strong> " : "") + QA.esc(cat.why[k]) + "</li>";
    }).join("");
    return '<div style="max-width:260px"><strong style="font-size:1rem">' + cat.icon + " " + QA.esc(cat.label) + "</strong><br>" +
      QA.statusBadge(r.status) + " " + QA.sourceBadge(r) +
      (r.description ? "<p style='margin:.4rem 0'>" + QA.esc(r.description) + "</p>" : "") +
      (r.photo ? '<img src="' + r.photo + '" alt="Photo attached to the report" style="max-width:100%;border-radius:8px">' : "") +
      "<p style='margin:.4rem 0 .2rem'><strong>Why it is a barrier:</strong></p><ul style='padding-left:1rem;margin:0'>" + whys + "</ul>" +
      "<p class='muted' style='margin:.4rem 0 0;font-size:.8rem'>Reported " + QA.esc(r.created) + "</p></div>";
  };
  QA.drawReportMarkers = function (layer) {
    layer.clearLayers();
    QA.Store.all().forEach(function (r) {
      if (r.status === "rejected") return;
      var cat = QA.REPORT_CATEGORIES[r.category] || QA.REPORT_CATEGORIES.other;
      L.marker([r.lat, r.lng], { icon: QA.reportIcon(r), title: cat.label, alt: cat.label, keyboard: true, zIndexOffset: 300 })
        .bindPopup(QA.reportPopup(r)).addTo(layer);
    });
  };
  QA.pinIcon = function (letter, cls) {
    return L.divIcon({ className: "", html: '<div class="pin ' + cls + '"><span>' + letter + "</span></div>", iconSize: [34, 34], iconAnchor: [17, 34] });
  };
  QA.nearestLandmark = function (lat, lng) {
    var best = null, bd = Infinity;
    QA.landmarks.forEach(function (l) {
      var d = QA.haversine([lat, lng], [l.lat, l.lng]);
      if (d < bd) { bd = d; best = l; }
    });
    return { landmark: best, distance: bd };
  };

  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  var BASEMAPS = {
    "OpenStreetMap": { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM_ATTR },
    "OpenStreetMap France": { url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", maxNative: 19, attribution: OSM_ATTR + ', tiles by <a href="https://www.openstreetmap.fr/">OSM France</a>' },
    "Esri Streets": { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", maxNative: 19, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community" }
  };
  QA.baseChoice = function () {
    var c = null;
    try { c = localStorage.getItem("qalaaccess.basemap"); } catch (e) {}
    return BASEMAPS[c] ? c : "OpenStreetMap";
  };

  // Base map + pilot-area outline.
  var B = G.meta.bbox;
  QA.pilotBounds = L.latLngBounds([B[0], B[1]], [B[2], B[3]]);
  QA.makeMap = function (id, opts) {
    var map = L.map(id, Object.assign({ zoomControl: true, minZoom: 13, maxZoom: 19, keyboard: true }, opts || {}));
    // Several base maps: if one tile server blocks the page (e.g. "Access blocked"),
    // the user can switch in the top-right "Map style" control. The choice is remembered.
    var bases = {};
    Object.keys(BASEMAPS).forEach(function (name) {
      var b = BASEMAPS[name];
      bases[name] = L.tileLayer(b.url, { maxZoom: 19, maxNativeZoom: b.maxNative || 19, attribution: b.attribution, referrerPolicy: "strict-origin-when-cross-origin" });
    });
    var chosen = QA.baseChoice();
    bases[chosen].addTo(map);
    L.control.layers(bases, null, { position: "topright", collapsed: true }).addTo(map);
    map.on("baselayerchange", function (ev) {
      try { localStorage.setItem("qalaaccess.basemap", ev.name); } catch (e) {}
      // keep all maps on the same style
      QA.maps.forEach(function (m) {
        if (m === map || !m._qaBases) return;
        Object.keys(m._qaBases).forEach(function (n) { if (m.hasLayer(m._qaBases[n])) m.removeLayer(m._qaBases[n]); });
        m._qaBases[ev.name].addTo(m);
      });
    });
    map._qaBases = bases;
    var lc = map.getContainer().querySelector(".leaflet-control-layers-toggle");
    if (lc) { lc.setAttribute("aria-label", "Map style"); lc.setAttribute("title", "Map style (switch if the map does not load)"); lc.setAttribute("role", "button"); }
    L.rectangle(QA.pilotBounds, { color: "#0b1f3a", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
    map.fitBounds(QA.pilotBounds, { padding: [10, 10] });
    map.setMaxBounds(QA.pilotBounds.pad(0.6));
    return map;
  };
  QA.fillLandmarkSelect = function (sel, placeholder) {
    sel.innerHTML = '<option value="">' + QA.esc(placeholder) + "</option>" +
      QA.landmarks.map(function (l) { return '<option value="' + l.id + '">' + QA.esc(l.name) + "</option>"; }).join("");
  };

  // ---------- single-page navigation ----------
  // All sections live on one long page. Interactive sections register a hook
  // that builds their map once the page has loaded.
  QA.pageHooks = {};
  QA.go = function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: QA.reducedMotion() ? "auto" : "smooth", block: "start" });
    var hook = QA.pageHooks[id];
    if (hook) hook(false);
  };

  // Highlight the section currently on screen in the sticky menu.
  function watchSections() {
    var links = Array.prototype.slice.call(document.querySelectorAll("#toc a[href^='#']"));
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var sections = Object.keys(byId).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    function update() {
      var y = window.scrollY + 140, current = null;
      sections.forEach(function (sec) { if (sec.offsetTop <= y) current = sec.id; });
      links.forEach(function (a) {
        var on = a.getAttribute("href") === "#" + current;
        a.classList.toggle("active", on);
        if (on) {
          a.setAttribute("aria-current", "true");
          var row = a.parentNode;
          if (row.scrollWidth > row.clientWidth) row.scrollLeft = a.offsetLeft - 40;
        } else a.removeAttribute("aria-current");
      });
    }
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  // ---------- display settings ----------
  function setting(btnId, cls, key) {
    var btn = document.getElementById(btnId);
    var on = false;
    try { on = localStorage.getItem(key) === "1"; } catch (e) {}
    function apply() {
      document.documentElement.classList.toggle(cls, on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    btn.addEventListener("click", function () {
      on = !on;
      try { localStorage.setItem(key, on ? "1" : "0"); } catch (e) {}
      apply();
      setTimeout(function () { (QA.maps || []).forEach(function (m) { m.invalidateSize(); }); }, 50);
    });
    apply();
  }
  setting("largeTextBtn", "large-text", "qalaaccess.largetext");
  // Respect the operating-system "reduce motion" setting.
  QA.reducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  };

  document.getElementById("osmDate").textContent = (G.meta.osmTimestamp || "").slice(0, 10);

  QA.maps = [];
  document.addEventListener("DOMContentLoaded", function () {
    Object.keys(QA.pageHooks).forEach(function (id) { QA.pageHooks[id](true); });
    watchSections();
  });
})();
