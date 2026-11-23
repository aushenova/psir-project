/*
 * QalaAccess AI — routing engine (Dijkstra on the pilot pedestrian graph).
 *
 * Every rule below is a transparent, documented demonstration rule.
 * The resulting routes are NOT safety guarantees.
 */
(function (root) {
  "use strict";

  // Report categories and how they affect routing. Reports submitted by users
  // are stored as verified and immediately used in routing.
  // `affects`: internal routing weight per user group (extra metres; Infinity = impassable).
  // `why`: plain-language explanation shown to the user, per user group.
  var REPORT_CATEGORIES = {
    broken_tactile: { label: "Broken tactile paving", icon: "▦", affects: { blind: 400 },
      why: { blind: "Blind people follow tactile paving with a cane or their feet. Broken tiles interrupt the guidance and they can lose their way." } },
    missing_tactile: { label: "Missing tactile guidance", icon: "▢", affects: { blind: 250 },
      why: { blind: "Without tactile paving a blind person cannot feel where the sidewalk ends and the road begins." } },
    faulty_audible: { label: "Faulty audible pedestrian crossing", icon: "🔇", affects: { blind: 600, lowVision: 150 },
      why: { blind: "The sound signal tells a blind person when it is safe to cross. If it does not work, they cannot know when the light is green.",
             lowVision: "People with low vision rely partly on the sound signal because the light is hard to see." } },
    missing_visual: { label: "Missing visual crossing information", icon: "👁", affects: { deaf: 500, colorVision: 400, lowVision: 200 },
      why: { deaf: "A deaf person cannot hear traffic or sound signals, so they need a clear visual signal to cross safely.",
             colorVision: "Without a pictogram or countdown, a person who cannot tell red from green does not know when to cross.",
             lowVision: "Without a clear, large visual signal it is hard for a person with low vision to see when to cross." } },
    stairs: { label: "Stairs without accessible alternative", icon: "🪜", affects: { wheelchair: Infinity, blind: 50 },
      why: { wheelchair: "A wheelchair cannot go up or down steps, and there is no ramp or lift here.",
             blind: "Unmarked steps are a fall risk for a blind person." } },
    inaccessible_curb: { label: "Inaccessible curb", icon: "⛔", affects: { wheelchair: Infinity, lowVision: 100 },
      why: { wheelchair: "The curb is too high — a wheelchair cannot get from the road onto the sidewalk.",
             lowVision: "A high, unmarked curb edge is easy to trip over." } },
    steep_ramp: { label: "Steep or damaged ramp", icon: "◢", affects: { wheelchair: 600 },
      why: { wheelchair: "A ramp that is too steep or broken is very hard or dangerous to use in a wheelchair." } },
    blocked_sidewalk: { label: "Blocked sidewalk", icon: "🚧", affects: { wheelchair: Infinity, blind: 500, lowVision: 400, colorVision: 150, deaf: 150 },
      why: { wheelchair: "The sidewalk is blocked, so a wheelchair cannot pass and would have to go onto the road.",
             blind: "A blind person can walk into the obstacle and has to find a detour without seeing it.",
             lowVision: "An obstacle on the sidewalk is easy to walk into for a person with low vision.",
             colorVision: "The detour around the obstacle may lead onto the road.",
             deaf: "The detour around the obstacle may lead onto the road, where a deaf person cannot hear cars." } },
    other: { label: "Other accessibility issue", icon: "❗", affects: { wheelchair: 300, blind: 300, lowVision: 300, colorVision: 150, deaf: 150 },
      why: { _: "A user reported a problem here that may make it hard to pass." } }
  };

  var PREFERENCES = {
    wheelchair:  "Wheelchair / step-free",
    blind:       "Blind or visually impaired",
    lowVision:   "Low vision",
    colorVision: "Colour-vision accessibility",
    deaf:        "Deaf or hard of hearing"
  };

  var UNPAVED = { gravel: 1, fine_gravel: 1, dirt: 1, ground: 1, grass: 1, sand: 1, unpaved: 1, earth: 1, mud: 1, pebblestone: 1 };

  function haversine(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Distance (m) from point p to segment ab, using a local flat projection.
  function pointSegDist(p, a, b) {
    var k = Math.cos(p[0] * Math.PI / 180);
    var ax = (a[1] - p[1]) * k, ay = a[0] - p[0];
    var bx = (b[1] - p[1]) * k, by = b[0] - p[0];
    var dx = bx - ax, dy = by - ay;
    var t = dx * dx + dy * dy ? -(ax * dx + ay * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    var x = ax + t * dx, y = ay + t * dy;
    return Math.sqrt(x * x + y * y) * 111320;
  }

  function parseIncline(v) {
    if (!v) return null;
    var m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? Math.abs(parseFloat(m[0])) : null;
  }

  function Router(graph, demoAttributes) {
    this.nodes = graph.nodes;
    this.edges = graph.edges;
    this.byId = {};
    this.adj = this.nodes.map(function () { return []; });
    var self = this;
    this.edges.forEach(function (e, i) {
      e.idx = i;
      self.byId[e.id] = e;
      self.adj[e.a].push(i);
      self.adj[e.b].push(i);
    });
    if (demoAttributes) this.applyDemoAttributes(demoAttributes);
  }

  // Synthetic demonstration attributes are stored separately and labelled.
  Router.prototype.applyDemoAttributes = function (list) {
    var self = this;
    list.forEach(function (d) {
      var e = self.byId[d.segment];
      if (!e) return;
      e.demo = e.demo || {};
      Object.keys(d.set).forEach(function (k) { e.demo[k] = d.set[k]; });
      e.demoNote = d.note;
    });
  };

  // Value of an attribute + where it came from.
  Router.prototype.attr = function (e, key) {
    if (e.demo && e.demo[key] !== undefined) return { value: e.demo[key], source: "Synthetic demo" };
    if (e[key] !== undefined) return { value: e[key], source: "OpenStreetMap" };
    return { value: "unknown", source: "No data" };
  };

  Router.prototype.nearestNode = function (latlng) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < this.nodes.length; i++) {
      var d = haversine(latlng, this.nodes[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { node: best, distance: bestD };
  };

  Router.prototype.nearestEdge = function (latlng) {
    var best = null, bestD = Infinity;
    this.edges.forEach(function (e) {
      for (var i = 0; i < e.g.length - 1; i++) {
        var d = pointSegDist(latlng, e.g[i], e.g[i + 1]);
        if (d < bestD) { bestD = d; best = e; }
      }
    });
    return { edge: best, distance: bestD };
  };

  /* Attach reports to segments. Returns a map segmentId -> [reports]. */
  Router.prototype.indexReports = function (reports) {
    var map = {};
    var self = this;
    reports.forEach(function (r) {
      if (r.status === "rejected") return;
      var seg = r.segment;
      if (!seg) {
        var near = self.nearestEdge([r.lat, r.lng]);
        if (near.edge && near.distance <= 25) seg = near.edge.id;
      }
      if (seg) (map[seg] = map[seg] || []).push(r);
    });
    return map;
  };

  /*
   * Routing cost of one segment for a set of preferences:
   *   cost = length x multiplier + extra (internal weights, not shown to users)
   * Returns { mult, extra, blocked, reasons[] } where each reason is
   * { title, why, blocked } in plain language.
   */
  Router.prototype.segmentCost = function (e, prefs, reportsOnSeg) {
    var mult = 1, extra = 0, blocked = false, reasons = [];
    function block(title, why) { blocked = true; reasons.push({ title: title, why: why, blocked: true }); }
    function m(x, title, why) { mult *= x; reasons.push({ title: title, why: why }); }
    function add(x, title, why) { extra += x; reasons.push({ title: title, why: why }); }

    var isCrossing = e.type === "crossing";
    var ctrl = e.crossingCtrl;
    var signal = ctrl === "traffic_signals";
    var audible = this.attr(e, "audible").value;
    var tactile = this.attr(e, "tactile").value;
    var visual = this.attr(e, "visualSignal").value;
    var kerb = this.attr(e, "kerb").value;
    var incl = parseIncline(this.attr(e, "incline").value);

    if (prefs.wheelchair) {
      if (e.type === "steps") block("Stairs", "A wheelchair cannot go up or down steps.");
      if (kerb === "raised") block("High curb at the crossing", "A wheelchair cannot get over a high curb.");
      else if (isCrossing && kerb === "unknown") add(60, "Curb height at the crossing is unknown", "We do not know if the curb is lowered — it may be too high for a wheelchair.");
      if (incl !== null && incl > 8) m(5, "Very steep slope", "A slope this steep is very hard to climb and dangerous to go down in a wheelchair.");
      else if (incl !== null && incl > 5) m(2, "Steep slope", "A steep slope needs a lot of effort in a manual wheelchair.");
      if (e.surface && UNPAVED[e.surface]) m(3, "Unpaved surface (" + e.surface + ")", "Wheels sink or get stuck on gravel, sand or dirt.");
    }
    if (prefs.blind) {
      if (isCrossing) {
        if (audible === "faulty") add(600, "Sound signal is not working", "A blind person cannot hear when the light turns green, so they do not know when it is safe to cross.");
        else if (audible === "yes") { /* preferred */ }
        else if (signal) add(150, "Traffic light without known sound signal", "It is unknown whether this light makes a sound, so a blind person may not know when to cross.");
        else add(300, "Crossing without traffic light", "With no light and no sound signal, a blind person must judge the traffic only by ear.");
        if (tactile === "no") add(100, "No tactile paving at the crossing", "A blind person cannot feel where the sidewalk ends and the road begins.");
        else if (tactile !== "yes") add(40, "Tactile paving at the crossing is unknown", "It is unknown whether there is tactile paving that shows the edge of the road.");
      }
    }
    if (prefs.lowVision) {
      if (isCrossing && !signal) add(200, "Crossing without traffic light", "Without a light, a person with low vision has to see approaching cars, which is difficult.");
      if (isCrossing && signal && visual === "no") add(100, "Signal shown by colour only", "A small coloured light without a symbol is hard to see with low vision.");
    }
    if (prefs.colorVision) {
      if (isCrossing && signal) {
        if (visual === "no") add(400, "Signal shown by colour only", "A person who cannot tell red from green does not know when to cross if there is no symbol or countdown.");
        else if (visual !== "yes") add(100, "Unknown if the signal has a symbol", "It is unknown whether the light has a walking-figure symbol or countdown, not only colour.");
      }
    }
    if (prefs.deaf) {
      if (isCrossing) {
        if (!signal) add(200, "Crossing without traffic light", "A deaf person cannot hear approaching cars, so a crossing without a light is riskier.");
        else if (visual === "no") add(250, "No clear visual signal", "A deaf person depends on a clear visual signal because they cannot hear sound warnings.");
      }
    }

    (reportsOnSeg || []).forEach(function (r) {
      if (r.status === "rejected") return;
      var cat = REPORT_CATEGORIES[r.category];
      if (!cat) return;
      var title = "Reported barrier: " + cat.label + (r.sample ? " (sample)" : "");
      Object.keys(cat.affects).forEach(function (p) {
        if (!prefs[p]) return;
        var why = cat.why[p] || cat.why._ || "";
        if (cat.affects[p] === Infinity) block(title, why);
        else add(cat.affects[p], title, why);
      });
    });

    return { mult: mult, extra: extra, blocked: blocked, reasons: reasons };
  };

  Router.prototype.costOf = function (e, prefs, reportsOnSeg) {
    var c = this.segmentCost(e, prefs, reportsOnSeg);
    return c.blocked ? Infinity : e.l * c.mult + c.extra;
  };

  Router.prototype.dijkstra = function (start, end, costFn) {
    var n = this.nodes.length;
    var dist = new Float64Array(n).fill(Infinity);
    var prevEdge = new Int32Array(n).fill(-1);
    var done = new Uint8Array(n);
    // Binary heap of [dist, node]
    var heap = [[0, start]];
    dist[start] = 0;
    function push(item) {
      heap.push(item);
      var i = heap.length - 1;
      while (i > 0) {
        var p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        var t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p;
      }
    }
    function pop() {
      var top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        var i = 0;
        for (;;) {
          var l = 2 * i + 1, r = l + 1, m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
        }
      }
      return top;
    }
    while (heap.length) {
      var cur = pop(), u = cur[1];
      if (done[u]) continue;
      done[u] = 1;
      if (u === end) break;
      var list = this.adj[u];
      for (var k = 0; k < list.length; k++) {
        var e = this.edges[list[k]];
        var c = costFn(e);
        if (c === Infinity) continue;
        var v = e.a === u ? e.b : e.a;
        var nd = dist[u] + c;
        if (nd < dist[v]) { dist[v] = nd; prevEdge[v] = e.idx; push([nd, v]); }
      }
    }
    if (dist[end] === Infinity) return null;
    var path = [], node = end;
    while (node !== start) {
      var ei = prevEdge[node], ed = this.edges[ei];
      path.push({ edge: ed, forward: ed.b === node });
      node = ed.a === node ? ed.b : ed.a;
    }
    path.reverse();
    return { steps: path, cost: dist[end] };
  };

  Router.prototype.summarize = function (res, prefs, reportIndex) {
    if (!res) return null;
    var self = this, length = 0, coords = [], stairs = [], crossings = 0, unknownLen = 0,
      demoLen = 0, osmLen = 0, issues = [], reportsOnRoute = [], seenReports = {};
    res.steps.forEach(function (s) {
      var e = s.edge, g = s.forward ? e.g : e.g.slice().reverse();
      coords = coords.length ? coords.concat(g.slice(1)) : g.slice();
      length += e.l;
      if (e.type === "steps") stairs.push(e);
      if (e.type === "crossing") crossings++;
      var hasAcc = e.audible || e.tactile || e.kerb || e.incline || e.width || e.type === "steps";
      if (e.demo) demoLen += e.l; else if (hasAcc) osmLen += e.l; else unknownLen += e.l;
      (reportIndex[e.id] || []).forEach(function (r) {
        if (!seenReports[r.id]) { seenReports[r.id] = 1; reportsOnRoute.push(r); }
      });
      var f = self.segmentCost(e, prefs, reportIndex[e.id]);
      if (f.reasons.length) issues.push({ edge: e, reasons: f.reasons, blocked: f.blocked });
    });
    return {
      coords: coords, length: length, cost: res.cost, segments: res.steps.map(function (s) { return s.edge; }),
      stairs: stairs, crossings: crossings, unknownLen: unknownLen, demoLen: demoLen, osmLen: osmLen,
      issues: issues, reports: reportsOnRoute
    };
  };

  /*
   * Main entry: returns { shortest, accessible, prefs, noAccessibleRoute }.
   * `shortest` ignores preferences (pure distance). `accessible` applies them.
   */
  Router.prototype.plan = function (startNode, endNode, prefs, reports) {
    var self = this;
    var idx = this.indexReports(reports || []);
    var none = {};
    var shortestRaw = this.dijkstra(startNode, endNode, function (e) { return e.l; });
    var anyPref = Object.keys(prefs).some(function (k) { return prefs[k]; });
    var accRaw = anyPref ? this.dijkstra(startNode, endNode, function (e) {
      return self.costOf(e, prefs, idx[e.id]);
    }) : shortestRaw;
    return {
      shortest: this.summarize(shortestRaw, prefs, idx),
      accessible: this.summarize(accRaw, prefs, idx),
      shortestPlain: this.summarize(shortestRaw, none, idx),
      prefs: prefs,
      anyPref: anyPref,
      noAccessibleRoute: anyPref && !accRaw
    };
  };

  root.QA = root.QA || {};
  root.QA.Router = Router;
  root.QA.REPORT_CATEGORIES = REPORT_CATEGORIES;
  root.QA.PREFERENCES = PREFERENCES;
  root.QA.haversine = haversine;
  if (typeof module !== "undefined") module.exports = root.QA;
})(typeof window !== "undefined" ? window : globalThis);
