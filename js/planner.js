/* QalaAccess AI — Accessible Route Planner page. */
(function () {
  "use strict";
  var QA = window.QA, R = QA.router, esc = QA.esc;
  var map, layers, reportLayer, markers = {}, pickMode = null;
  var pts = { A: null, B: null };
  var lastPlan = null, dirty = false;
  var MAX_SNAP = 150; // metres from the pilot network

  var $ = function (id) { return document.getElementById(id); };
  var startSel = $("startSelect"), endSel = $("endSelect");
  QA.fillLandmarkSelect(startSel, "— Choose a start —");
  QA.fillLandmarkSelect(endSel, "— Choose a destination —");

  function prefs() {
    var p = {};
    document.querySelectorAll('input[name="pref"]').forEach(function (c) { p[c.value] = c.checked; });
    return p;
  }

  function setPoint(which, lat, lng, label, fromSelect) {
    var snap = R.nearestNode([lat, lng]);
    pts[which] = { lat: lat, lng: lng, label: label, node: snap.node, snapDist: snap.distance };
    if (!fromSelect) {
      var sel = which === "A" ? startSel : endSel;
      var match = QA.landmarks.filter(function (l) { return l.name === label; })[0];
      sel.value = match ? match.id : "";
    }
    drawPins();
    var msg = which === "A" ? "Start" : "Destination";
    if (snap.distance > MAX_SNAP) {
      status("warn", msg + " is " + Math.round(snap.distance) + " m from the nearest mapped footpath — outside the pilot network. Please choose a point inside the dashed pilot area.");
    } else {
      status("", msg + " set: " + label + ".");
    }
  }

  function drawPins() {
    if (!map) return;
    ["A", "B"].forEach(function (k) {
      if (markers[k]) { map.removeLayer(markers[k]); markers[k] = null; }
      var p = pts[k];
      if (p) {
        markers[k] = L.marker([p.lat, p.lng], {
          icon: QA.pinIcon(k, k === "A" ? "a" : "b"), draggable: true, keyboard: true,
          title: (k === "A" ? "Start: " : "Destination: ") + p.label, alt: (k === "A" ? "Start A" : "Destination B")
        }).addTo(map);
        markers[k].on("dragend", function (ev) {
          var ll = ev.target.getLatLng();
          setPoint(k, ll.lat, ll.lng, "Map point " + QA.fmtLL(ll.lat, ll.lng));
        });
      }
    });
  }

  function status(kind, text) {
    $("plannerStatus").innerHTML = text ? '<div class="notice ' + (kind || "info") + '" style="margin:0">' + esc(text) + "</div>" : "";
  }

  function setPick(mode) {
    pickMode = pickMode === mode ? null : mode;
    $("pickA").setAttribute("aria-pressed", pickMode === "A" ? "true" : "false");
    $("pickB").setAttribute("aria-pressed", pickMode === "B" ? "true" : "false");
    if (map) map.getContainer().style.cursor = pickMode ? "crosshair" : "";
    $("pickHint").textContent = pickMode
      ? "Now click the map to place " + (pickMode === "A" ? "the start (A)." : "the destination (B).")
      : "Tip: choose from the lists, or press a “Click map” button and click anywhere in the pilot area.";
  }

  startSel.addEventListener("change", function () {
    var l = QA.landmarks.filter(function (x) { return x.id === startSel.value; })[0];
    if (l) setPoint("A", l.lat, l.lng, l.name, true); else { pts.A = null; drawPins(); }
  });
  endSel.addEventListener("change", function () {
    var l = QA.landmarks.filter(function (x) { return x.id === endSel.value; })[0];
    if (l) setPoint("B", l.lat, l.lng, l.name, true); else { pts.B = null; drawPins(); }
  });
  $("pickA").addEventListener("click", function () { setPick("A"); });
  $("pickB").addEventListener("click", function () { setPick("B"); });
  $("swapBtn").addEventListener("click", function () {
    var t = pts.A; pts.A = pts.B; pts.B = t;
    var v = startSel.value; startSel.value = endSel.value; endSel.value = v;
    drawPins();
    if (lastPlan) find();
  });
  $("clearBtn").addEventListener("click", function () {
    pts.A = pts.B = null; startSel.value = endSel.value = "";
    drawPins(); if (layers) layers.clearLayers(); lastPlan = null;
    status("", "");
    $("routeResult").innerHTML = '<h3 style="margin-top:0">Route explanation</h3><p class="muted">Cleared. Choose A and B to plan a new route.</p>';
  });

  document.querySelectorAll('input[name="pref"]').forEach(function (c) {
    c.addEventListener("change", function () { if (lastPlan) find(); });
  });
  function drawReports() { if (reportLayer) QA.drawReportMarkers(reportLayer); }
  QA.Store.onChange(function () {
    drawReports();
    if (lastPlan) { find(); status("info", "Route recalculated with the latest reported barriers."); }
  });

  $("findBtn").addEventListener("click", function () { find(true); });

  // ---------- route calculation ----------
  function find(focusResult) {
    if (!pts.A || !pts.B) { status("warn", "Please choose both a start (A) and a destination (B)."); return; }
    if (pts.A.snapDist > MAX_SNAP || pts.B.snapDist > MAX_SNAP) { status("warn", "One of the points is outside the pilot network. Choose a point inside the dashed area."); return; }
    if (pts.A.node === pts.B.node) { status("warn", "Start and destination are the same place."); return; }
    var p = prefs();
    var reports = QA.Store.all();
    var plan = R.plan(pts.A.node, pts.B.node, p, reports);
    // Same calculation without any reported barriers, to explain what the reports changed.
    if (plan.anyPref && reports.length) plan.baseline = R.plan(pts.A.node, pts.B.node, p, []);
    lastPlan = { plan: plan };
    QA.lastRoutes = { shortest: plan.shortest && plan.shortest.coords, accessible: plan.anyPref && plan.accessible ? plan.accessible.coords : null };
    if (QA.refreshReportMap) QA.refreshReportMap();
    dirty = false;
    draw(plan);
    render(plan);
    status("", "");
    if (focusResult === true) $("routeResult").focus({ preventScroll: false });
  }

  function draw(plan) {
    layers.clearLayers();
    var s = plan.shortest, a = plan.accessible;
    var same = s && a && sameRoute(s, a);
    if (s) {
      L.polyline(s.coords, { color: "#ffffff", weight: 9, opacity: .9 }).addTo(layers);
      L.polyline(s.coords, { color: "#6b7280", weight: 5, dashArray: "10 8", opacity: .95 })
        .bindTooltip("Shortest route: " + QA.fmtM(s.length)).addTo(layers);
      s.stairs.forEach(function (e) {
        var g = e.g[Math.floor(e.g.length / 2)];
        L.marker(g, { icon: L.divIcon({ className: "", html: '<div class="qa-marker" style="border-color:#9b1c1c;width:26px;height:26px;font-size:13px">🪜</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), title: "Stairs (OpenStreetMap)", alt: "Stairs" })
          .bindPopup("<strong>Stairs</strong><br>Source: OpenStreetMap (way " + e.osm + ")<br>Segment " + e.id).addTo(layers);
      });
    }
    if (a && plan.anyPref) {
      L.polyline(a.coords, { color: "#ffffff", weight: 11, opacity: .9 }).addTo(layers);
      L.polyline(a.coords, { color: "#0f766e", weight: 6, opacity: same ? .85 : 1 })
        .bindTooltip("Preference-aware route: " + QA.fmtM(a.length)).addTo(layers);
    }
    // issues on routes (crossings with problems / reports)
    var seenIssue = {};
    if (plan.anyPref) {
      [s, a].forEach(function (rt) { (rt ? rt.issues : []).forEach(function (it) {
        if (seenIssue[it.edge.id]) return; seenIssue[it.edge.id] = 1;
        if (it.edge.type !== "crossing") return;
        var g = it.edge.g[Math.floor(it.edge.g.length / 2)];
        L.marker(g, { icon: L.divIcon({ className: "", html: '<div class="qa-marker" style="border-color:#c27a00;width:24px;height:24px;font-size:12px">⚠</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), title: "Issue on route", alt: "Issue on route" })
          .bindPopup("<strong>" + (it.edge.type === "crossing" ? "Pedestrian crossing" : "Path segment") + "</strong><ul style='padding-left:1rem;margin:.3rem 0'>" +
            it.reasons.map(function (r) { return "<li><strong>" + esc(r.title) + ".</strong> " + esc(r.why) + "</li>"; }).join("") + "</ul>" +
            (it.edge.demo ? "<span class='badge sample'>Synthetic demo attribute</span>" : "")).addTo(layers);
      }); });
    }
    var all = (s ? s.coords : []).concat(a ? a.coords : []);
    if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [40, 40], animate: !QA.reducedMotion() });
  }

  function sameRoute(x, y) {
    if (x.segments.length !== y.segments.length) return false;
    for (var i = 0; i < x.segments.length; i++) if (x.segments[i] !== y.segments[i]) return false;
    return true;
  }

  function aggregate(issues) {
    var m = {};
    issues.forEach(function (it) {
      it.reasons.forEach(function (r) {
        m[r.title] = m[r.title] || { text: r.title, why: r.why, count: 0, blocked: !!r.blocked };
        m[r.title].count++;
      });
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return (b.blocked - a.blocked) || (b.count - a.count); });
  }

  function issueList(issues, empty) {
    var agg = aggregate(issues);
    if (!agg.length) return '<p class="muted" style="font-size:.9rem">' + empty + "</p>";
    return '<ul class="issues">' + agg.map(function (a) {
      return '<li class="' + (a.blocked ? "blocked" : "") + '"><strong>' + (a.blocked ? "⛔ " : "⚠ ") + esc(a.text) + "</strong>" +
        (a.count > 1 ? " (" + a.count + " places)" : "") + (a.blocked ? ' <span class="badge" style="color:var(--bad-ink)">cannot pass</span>' : "") +
        '<br><span style="font-size:.88rem">' + esc(a.why) + "</span></li>";
    }).join("") + "</ul>";
  }

  function dataMeter(rt) {
    var L0 = rt.length || 1;
    var o = rt.osmLen / L0 * 100, d = rt.demoLen / L0 * 100, u = rt.unknownLen / L0 * 100;
    return '<div class="meter" role="img" aria-label="Accessibility data coverage: ' + o.toFixed(0) + '% OpenStreetMap, ' + d.toFixed(0) + '% synthetic demo, ' + u.toFixed(0) + '% unknown">' +
      '<span class="m-osm" style="width:' + o + '%"></span><span class="m-demo" style="width:' + d + '%"></span><span class="m-unk" style="width:' + u + '%"></span></div>' +
      '<div class="meter-legend"><span><i style="background:#3b82f6"></i>OSM-mapped attribute ' + o.toFixed(0) + '%</span><span><i style="background:#8b5cf6"></i>Synthetic demo ' + d.toFixed(0) + '%</span><span><i style="background:repeating-linear-gradient(45deg,#cbd5e1 0 3px,#e2e8f0 3px 6px)"></i>Unknown ' + u.toFixed(0) + "%</span></div>";
  }

  var CONSIDERED = {
    wheelchair: "Stairs (blocked), raised kerbs (blocked), unknown kerbs at crossings, inclines, unpaved surfaces",
    blind: "Audible signals (working / faulty / unknown), tactile paving at crossings, unsignalised crossings",
    lowVision: "Uncontrolled crossings, colour-only signals, reported obstacles",
    colorVision: "Signals with pictograms or countdowns vs colour-only signals",
    deaf: "Visual crossing signals, crossings without signals"
  };

  function render(plan) {
    var s = plan.shortest, a = plan.accessible, p = plan.prefs;
    var chosen = Object.keys(p).filter(function (k) { return p[k]; });
    var html = '<h3 style="margin-top:0">Route explanation</h3>';
    html += '<p style="font-size:.92rem"><strong>From</strong> ' + esc(pts.A.label) + " <strong>to</strong> " + esc(pts.B.label) + "</p>";

    if (!plan.anyPref) {
      html += '<div class="notice info"><strong>No accessibility need selected.</strong>Showing only the shortest walking route. Select at least one need in step 2 to compare.</div>';
      html += '<div class="route-cards"><div class="route-card"><span class="legend-line short"></span><strong>Shortest</strong><div class="big">' + QA.fmtM(s.length) + "</div><small>" + s.stairs.length + " stair segments · " + s.crossings + " crossings</small></div></div>";
      $("routeResult").innerHTML = html;
      return;
    }

    html += '<p style="font-size:.88rem" class="muted">Needs: <strong>' + chosen.map(function (k) { return QA.PREFERENCES[k]; }).join(", ") + "</strong></p>";

    if (plan.noAccessibleRoute) {
      html += '<div class="notice bad" role="alert"><strong>No verified accessible route is available with the current data.</strong>' +
        "Every known path between these points has a barrier that a person with the selected needs cannot pass. The dashed line is the shortest route — it is <em>not</em> suitable.</div>";
      html += "<h3>Barriers on the shortest route</h3>" + issueList(s.issues, "None found.");
      html += '<div class="notice info"><strong>What this means</strong>This does not prove the place is inaccessible in reality. A ramp or lift may exist but is missing from OpenStreetMap. This is exactly the data gap the project aims to close — please report or map it.</div>';
      $("routeResult").innerHTML = html;
      return;
    }

    var same = sameRoute(s, a);
    var extra = a.length - s.length;
    var b0 = plan.baseline && plan.baseline.accessible;
    if (b0 && !sameRoute(b0, a)) {
      var onNew = {};
      a.segments.forEach(function (e) { onNew[e.id] = 1; });
      var idx = R.indexReports(QA.Store.all());
      var avoided = [];
      b0.segments.forEach(function (e) {
        if (onNew[e.id]) return;
        (idx[e.id] || []).forEach(function (r) {
          var cat = QA.REPORT_CATEGORIES[r.category];
          var whyK = cat && chosen.filter(function (k) { return cat.affects[k]; })[0];
          if (whyK && avoided.indexOf(r) < 0) { r._why = cat.why[whyK] || cat.why._; avoided.push(r); }
        });
      });
      if (avoided.length) {
        html += '<div class="notice ok"><strong>The route goes around reported barriers</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">' +
          avoided.map(function (r) {
            var cat = QA.REPORT_CATEGORIES[r.category];
            return "<li><strong>" + cat.icon + " " + esc(cat.label) + "</strong> (" + (r.sample ? "sample report" : "reported " + esc(r.created)) + ") — " + esc(r._why) + "</li>";
          }).join("") + "</ul><span style='font-size:.88rem'>Without these reports the route would be " + QA.fmtM(b0.length) + "; now it is " + QA.fmtM(a.length) + ".</span></div>";
      }
    }

    html += '<div class="route-cards">' +
      '<div class="route-card"><span class="legend-line short" aria-hidden="true"></span><strong>Shortest</strong><div class="big">' + QA.fmtM(s.length) + "</div><small>" + s.stairs.length + " stair segments · " + s.crossings + " crossings · " + aggregate(s.issues).length + " issue types</small></div>" +
      '<div class="route-card acc"><span class="legend-line acc" aria-hidden="true"></span><strong>Recommended for your needs</strong><div class="big">' + QA.fmtM(a.length) + "</div><small>" +
      (same ? "same as shortest" : "+" + QA.fmtM(extra) + " (+" + Math.round(extra / s.length * 100) + "%)") + " · " + a.stairs.length + " stair segments · " + a.crossings + " crossings</small></div></div>";

    // Reason
    var sBlocked = aggregate(s.issues).filter(function (x) { return x.blocked; });
    var reason;
    if (same) {
      reason = "The shortest route is also the best option for your needs among the mapped paths. Remaining issues are listed below.";
    } else if (sBlocked.length) {
      reason = "The shortest route has barriers that you cannot pass: " + sBlocked.map(function (x) { return x.text.toLowerCase(); }).slice(0, 3).join("; ") +
        ". " + sBlocked[0].why + " The recommended route goes around them and is " + QA.fmtM(extra) + " longer.";
    } else {
      reason = "The shortest route has more problems for your needs (listed below). The recommended route avoids the most serious ones, even though it is " + QA.fmtM(extra) + " longer.";
    }
    html += '<h3 style="margin-top:1rem">Why this route?</h3><p>' + esc(reason) + "</p>";

    html += '<div class="grid-2"><div><h3>Issues on the shortest route</h3>' + issueList(s.issues, "No issues found for your needs (but see unknown data).") + "</div>" +
      "<div><h3>Remaining issues on the recommended route</h3>" + issueList(a.issues, "No known issues for your needs.") + "</div></div>";

    html += "<h3>How much do we actually know about this route?</h3>" + dataMeter(a);
    var unkPct = Math.round(a.unknownLen / (a.length || 1) * 100);
    html += '<div class="notice warn"><strong>This route is NOT verified.</strong>' + unkPct + "% of its length has no accessibility information at all. Unknown is never assumed to be accessible — please treat the recommendation as a best estimate.</div>";


    html += "<details style='margin-top:.6rem'><summary><strong>Accessibility features considered</strong></summary><ul style='font-size:.9rem'>" +
      chosen.map(function (k) { return "<li><strong>" + QA.PREFERENCES[k] + ":</strong> " + CONSIDERED[k] + "</li>"; }).join("") +
      "</ul></details>";
    html += '<p class="muted" style="font-size:.82rem;margin-top:.8rem">Research prototype. Routes are suggestions based on incomplete data and are not a safety guarantee.</p>';
    $("routeResult").innerHTML = html;
  }

  // ---------- page hook ----------
  QA.pageHooks.planner = function (first) {
    if (first) {
      map = QA.makeMap("plannerMap");
      QA.maps.push(map);
      layers = L.layerGroup().addTo(map);
      reportLayer = L.layerGroup().addTo(map);
      drawReports();
      map.on("click", function (ev) {
        var which = pickMode || (!pts.A ? "A" : !pts.B ? "B" : null);
        if (!which) { status("info", "A and B are set. Press a “Click map” button to move one of them, or drag the pins."); return; }
        setPoint(which, ev.latlng.lat, ev.latlng.lng, "Map point " + QA.fmtLL(ev.latlng.lat, ev.latlng.lng));
        if (pickMode) setPick(pickMode);
      });
      drawPins();
    } else {
      map.invalidateSize();
    }
    if (dirty && lastPlan) {
      find();
      status("info", "Route recalculated with the latest reported barriers.");
    }
  };

  QA.planner = {
    preset: function (aId, bId, prefList) {
      var a = QA.landmarks.filter(function (l) { return l.id === aId; })[0];
      var b = QA.landmarks.filter(function (l) { return l.id === bId; })[0];
      startSel.value = aId; endSel.value = bId;
      setPoint("A", a.lat, a.lng, a.name, true);
      setPoint("B", b.lat, b.lng, b.name, true);
      document.querySelectorAll('input[name="pref"]').forEach(function (c) { c.checked = prefList.indexOf(c.value) >= 0; });
    }
  };
})();
