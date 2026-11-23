/* QalaAccess AI — Report a Barrier page. */
(function () {
  "use strict";
  var QA = window.QA, R = QA.router, esc = QA.esc, CAT = QA.REPORT_CATEGORIES;
  var map, pin, segLayer, loc = null, category = null, photo = null, aiAssisted = false;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_BYTES = 5 * 1024 * 1024;
  var OK_TYPES = ["image/jpeg", "image/png", "image/webp"];

  // Category buttons (radiogroup with arrow-key support)
  var keys = Object.keys(CAT);
  $("catGrid").innerHTML = keys.map(function (k, i) {
    return '<button type="button" class="cat-btn" role="radio" aria-checked="false" tabindex="' + (i === 0 ? 0 : -1) + '" data-cat="' + k + '"><span class="ic" aria-hidden="true">' + CAT[k].icon + "</span>" + esc(CAT[k].label) + "</button>";
  }).join("");
  function selectCat(k, focus) {
    category = k;
    document.querySelectorAll(".cat-btn").forEach(function (b) {
      var on = b.dataset.cat === k;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
  }
  $("catGrid").addEventListener("click", function (ev) {
    var b = ev.target.closest(".cat-btn"); if (b) selectCat(b.dataset.cat);
  });
  $("catGrid").addEventListener("keydown", function (ev) {
    var b = ev.target.closest(".cat-btn"); if (!b) return;
    var i = keys.indexOf(b.dataset.cat), n = null;
    if (ev.key === "ArrowRight" || ev.key === "ArrowDown") n = (i + 1) % keys.length;
    if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") n = (i - 1 + keys.length) % keys.length;
    if (n !== null) { ev.preventDefault(); selectCat(keys[n], true); }
  });

  QA.fillLandmarkSelect($("reportLandmark"), "— Choose a landmark —");
  $("reportLandmark").addEventListener("change", function () {
    var l = QA.landmarks.filter(function (x) { return x.id === this.value; }, this)[0];
    if (l && map) { map.setView([l.lat, l.lng], 18); setLoc(l.lat, l.lng, "near " + l.name); }
  });

  function setLoc(lat, lng, how) {
    loc = { lat: lat, lng: lng };
    if (pin) map.removeLayer(pin);
    pin = L.marker([lat, lng], { icon: QA.pinIcon("!", "r"), draggable: true, title: "Barrier location", alt: "Barrier location" }).addTo(map);
    pin.on("dragend", function (ev) { var ll = ev.target.getLatLng(); setLoc(ll.lat, ll.lng, "moved pin"); });
    segLayer.clearLayers();
    var near = R.nearestEdge([lat, lng]);
    var txt = "📍 Location: " + QA.fmtLL(lat, lng) + (how ? " (" + how + ")" : "") + ". ";
    if (near.edge && near.distance <= 25) {
      L.polyline(near.edge.g, { color: "#c27a00", weight: 8, opacity: .8 }).addTo(segLayer);
      txt += "Attached to path segment " + near.edge.id + " (" + near.edge.type + ", " + Math.round(near.distance) + " m away), highlighted in orange.";
    } else {
      txt += "No mapped footpath within 25 m — the report will appear on the map but cannot affect routing.";
    }
    if (!QA.pilotBounds.contains([lat, lng])) txt += " ⚠ This point is outside the pilot area.";
    $("reportLocation").textContent = txt;
  }

  $("useCenterBtn").addEventListener("click", function () {
    var c = map.getCenter(); setLoc(c.lat, c.lng, "map centre");
  });

  $("reportDesc").addEventListener("input", function () { $("descCount").textContent = this.value.length; });

  // Downscale photos so they fit in localStorage.
  QA.readPhoto = function (file, cb) {
    if (!file) return cb(null, null);
    if (OK_TYPES.indexOf(file.type) < 0) return cb("Only JPG, PNG or WebP images are allowed.");
    if (file.size > MAX_BYTES) return cb("The image is larger than 5 MB.");
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 640, s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        cb(null, c.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = function () { cb("This file could not be read as an image."); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  };
  $("reportPhoto").addEventListener("change", function () {
    var f = this.files[0];
    QA.readPhoto(f, function (err, data) {
      if (err) { $("reportErrors").innerHTML = '<div class="notice bad">' + esc(err) + "</div>"; $("reportPhoto").value = ""; photo = null; $("reportPhotoPreview").hidden = true; return; }
      $("reportErrors").innerHTML = "";
      photo = data; aiAssisted = false;
      $("reportPhotoPreview").src = data || ""; $("reportPhotoPreview").hidden = !data;
    });
  });

  $("reportForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var errs = [];
    if (!loc) errs.push("Choose a location on the map (step 1).");
    if (!category) errs.push("Choose a barrier category (step 2).");
    var desc = $("reportDesc").value.trim().replace(/\s+/g, " ").slice(0, 500);
    if (errs.length) {
      $("reportErrors").innerHTML = '<div class="notice bad"><strong>Please complete the form</strong><ul style="margin:.3rem 0 0;padding-left:1.1rem">' + errs.map(function (e) { return "<li>" + esc(e) + "</li>"; }).join("") + "</ul></div>";
      return;
    }
    $("reportErrors").innerHTML = "";
    var near = R.nearestEdge([loc.lat, loc.lng]);
    var r = QA.Store.add({
      category: category, lat: +loc.lat.toFixed(6), lng: +loc.lng.toFixed(6), description: desc,
      segment: near.edge && near.distance <= 25 ? near.edge.id : null,
      photo: photo || undefined, aiAssisted: aiAssisted || undefined
    });
    $("reportSuccess").innerHTML = '<div class="notice ok" tabindex="-1" id="okMsg"><strong>Your report has been added to the map as verified.</strong>' +
      esc(CAT[category].label) + " at " + QA.fmtLL(loc.lat, loc.lng) + " is now on the map as <strong>verified</strong>. The route planner will avoid it for the people it affects." +
      '<div class="row" style="margin-top:.6rem"><button type="button" class="btn btn-primary btn-sm" id="toPlanner">See the effect in the route planner →</button></div></div>';
    $("okMsg").focus();
    $("toPlanner").onclick = function () { QA.go("planner"); };
    // reset form
    category = null; selectCat(null); photo = null; aiAssisted = false;
    $("reportDesc").value = ""; $("descCount").textContent = "0";
    $("reportPhoto").value = ""; $("reportPhotoPreview").hidden = true;
    loc = null; if (pin) { map.removeLayer(pin); pin = null; } segLayer.clearLayers();
    $("reportLocation").textContent = "No location chosen yet.";
    document.querySelector(".cat-btn").tabIndex = 0;
  });

  var routeLayer, existingLayer, fittedTo = null;
  function drawLastRoutes() {
    routeLayer.clearLayers();
    var lr = QA.lastRoutes;
    if (!lr) { $("reportRouteNote").hidden = true; return; }
    if (lr.shortest) L.polyline(lr.shortest, { color: "#6b7280", weight: 4, dashArray: "8 7", opacity: .7, interactive: false }).addTo(routeLayer);
    if (lr.accessible) L.polyline(lr.accessible, { color: "#0f766e", weight: 5, opacity: .6, interactive: false }).addTo(routeLayer);
    $("reportRouteNote").hidden = false;
    if (fittedTo !== lr) { // zoom to a newly planned route once
      fittedTo = lr;
      map.fitBounds(L.latLngBounds((lr.shortest || []).concat(lr.accessible || [])), { padding: [30, 30], animate: false });
    }
  }
  function drawExisting() { QA.drawReportMarkers(existingLayer); }
  QA.Store.onChange(function () { if (existingLayer) drawExisting(); });

  QA.pageHooks.report = function (first) {
    if (first) {
      map = QA.makeMap("reportMap");
      QA.maps.push(map);
      routeLayer = L.layerGroup().addTo(map);
      segLayer = L.layerGroup().addTo(map);
      map.on("click", function (ev) { setLoc(ev.latlng.lat, ev.latlng.lng, "clicked on map"); });
      $("reportCrosshair").classList.add("show");
      existingLayer = L.layerGroup().addTo(map); // all reported barriers
    } else map.invalidateSize();
    drawExisting();
    drawLastRoutes();
  };
  QA.refreshReportMap = function () { if (map) drawLastRoutes(); };

  // Two-click confirmation (no browser dialog) to remove the user's own reports.
  $("clearMyReports").addEventListener("click", function () {
    var b = this, label = "🗑 Remove my reports (keep samples)";
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1"; b.textContent = "Click again to delete your reports";
      setTimeout(function () { b.dataset.armed = ""; b.textContent = label; }, 4000);
      return;
    }
    b.dataset.armed = ""; b.textContent = label;
    QA.Store.reset();
    $("reportSuccess").innerHTML = '<div class="notice info">Your reports were removed. The sample reports are still shown.</div>';
  });

})();
