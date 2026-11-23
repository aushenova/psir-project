"""
Build the QalaAccess pilot pedestrian graph from an OpenStreetMap Overpass export.

This script is run ONCE by the developer, not by website visitors.

Usage:
    python tools/build_graph.py <ways.json> <tagged_nodes.json> js/data/graph.js

Inputs (downloaded from the Overpass API, bbox 51.1235,71.4000,51.1345,71.4480):
  ways.json          way["highway"~"footway|pedestrian|path|steps|living_street|cycleway"]; out body; >; out skel;
  tagged_nodes.json  crossing / traffic_signals / kerb / tactile_paving nodes; out body;

Output: a JavaScript file that defines `window.QA_GRAPH` so the site works when opened
directly from disk (file://) as well as on GitHub Pages.

Only attributes that actually exist in OSM are copied. Everything else is left as
"unknown". Synthetic demonstration attributes are added separately in
js/data/demoAttributes.js and are clearly labelled there.
"""
import json
import math
import sys
from collections import defaultdict


def haversine(a, b):
    r = 6371000.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def main(ways_path, nodes_path, out_path):
    raw = json.load(open(ways_path, encoding="utf-8"))
    tagged = json.load(open(nodes_path, encoding="utf-8"))

    coords = {e["id"]: (e["lat"], e["lon"]) for e in raw["elements"] if e["type"] == "node"}
    node_tags = {e["id"]: e.get("tags", {}) for e in tagged["elements"] if e["type"] == "node"}

    ways = []
    for e in raw["elements"]:
        if e["type"] != "way":
            continue
        t = e.get("tags", {})
        if t.get("area") == "yes" or t.get("foot") == "no" or t.get("access") == "private":
            continue
        if t.get("highway") == "cycleway" and t.get("foot") not in ("yes", "designated"):
            # Many cycleways in the area are not open to pedestrians; keep only shared ones.
            continue
        ways.append(e)

    # Nodes used by more than one way (or way endpoints) become graph vertices.
    use = defaultdict(int)
    for w in ways:
        for n in w["nodes"]:
            use[n] += 1
        use[w["nodes"][0]] += 1
        use[w["nodes"][-1]] += 1

    vid = {}
    vcoords = []

    def vertex(osm_id):
        if osm_id not in vid:
            vid[osm_id] = len(vcoords)
            vcoords.append(coords[osm_id])
        return vid[osm_id]

    edges = []
    for w in ways:
        t = w["tags"]
        hw = t.get("highway")
        fw = t.get("footway")
        if hw == "steps":
            kind = "steps"
        elif fw == "crossing" or "crossing" in t:
            kind = "crossing"
        elif fw == "sidewalk":
            kind = "sidewalk"
        else:
            kind = hw
        seg = [w["nodes"][0]]
        for n in w["nodes"][1:]:
            seg.append(n)
            if use[n] > 1 or n == w["nodes"][-1]:
                if seg[0] != seg[-1] and all(x in coords for x in seg):
                    geom = [coords[x] for x in seg]
                    length = sum(haversine(geom[i], geom[i + 1]) for i in range(len(geom) - 1))
                    e = {
                        "a": vertex(seg[0]),
                        "b": vertex(seg[-1]),
                        "g": [[round(p[0], 6), round(p[1], 6)] for p in geom],
                        "l": round(length, 1),
                        "type": kind,
                        "osm": w["id"],
                    }
                    if t.get("surface"):
                        e["surface"] = t["surface"]
                    if t.get("incline"):
                        e["incline"] = t["incline"]
                    if t.get("width"):
                        e["width"] = t["width"]
                    if t.get("tactile_paving"):
                        e["tactile"] = t["tactile_paving"]
                    # Crossing control: from the way tag or from tagged nodes along it.
                    ctrl = t.get("crossing")
                    sound = t.get("traffic_signals:sound")
                    kerb = None
                    for x in seg:
                        nt = node_tags.get(x, {})
                        if kind == "crossing" and not ctrl:
                            if nt.get("crossing"):
                                ctrl = nt["crossing"]
                            elif nt.get("highway") == "traffic_signals":
                                ctrl = "traffic_signals"
                        if nt.get("traffic_signals:sound") and not sound:
                            sound = nt["traffic_signals:sound"]
                        if nt.get("tactile_paving") and "tactile" not in e:
                            e["tactile"] = nt["tactile_paving"]
                        if nt.get("kerb"):
                            kerb = nt["kerb"]
                    if ctrl:
                        e["crossingCtrl"] = ctrl
                    if sound:
                        e["audible"] = sound
                    if kerb:
                        e["kerb"] = kerb
                    edges.append(e)
                seg = [n]

    # Keep only the largest connected component so every landmark is reachable.
    adj = defaultdict(list)
    for i, e in enumerate(edges):
        adj[e["a"]].append(e["b"])
        adj[e["b"]].append(e["a"])
    seen, best = set(), set()
    for s in range(len(vcoords)):
        if s in seen or s not in adj:
            continue
        comp, stack = {s}, [s]
        while stack:
            u = stack.pop()
            for v in adj[u]:
                if v not in comp:
                    comp.add(v)
                    stack.append(v)
        seen |= comp
        if len(comp) > len(best):
            best = comp

    remap = {}
    nodes_out = []
    for old in sorted(best):
        remap[old] = len(nodes_out)
        nodes_out.append([round(vcoords[old][0], 6), round(vcoords[old][1], 6)])
    edges_out = []
    for e in edges:
        if e["a"] in best and e["b"] in best:
            e["a"], e["b"] = remap[e["a"]], remap[e["b"]]
            e["id"] = "S" + str(len(edges_out) + 1).zfill(4)
            edges_out.append(e)

    meta = {
        "source": "OpenStreetMap contributors (ODbL), downloaded via Overpass API",
        "bbox": [51.1235, 71.4000, 51.1345, 71.4480],
        "osmTimestamp": raw.get("osm3s", {}).get("timestamp_osm_base"),
        "nodeCount": len(nodes_out),
        "segmentCount": len(edges_out),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED by tools/build_graph.py from OpenStreetMap data (c) OpenStreetMap contributors, ODbL.\n")
        f.write("// Pilot pedestrian network: Nurzhol Boulevard area, Astana. Do not edit by hand.\n")
        f.write("window.QA_GRAPH = ")
        json.dump({"meta": meta, "nodes": nodes_out, "edges": edges_out}, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(json.dumps(meta, indent=1))
    from collections import Counter
    print(Counter(e["type"] for e in edges_out))
    print("crossingCtrl", Counter(e.get("crossingCtrl") for e in edges_out if e["type"] == "crossing"))


if __name__ == "__main__":
    main(*sys.argv[1:4])
