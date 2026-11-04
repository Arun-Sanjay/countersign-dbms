"""
Generate the Component 3 ER figures (Chen notation as in Elmasri & Navathe, Ch. 3) from
er_model.py (what the schema contains) and er_layouts.py (where each shape goes).

    python3 gen_er.py          -> writes er_core_overview.dot and er_v*.dot, prints a QA report
    neato -n2 -Tpng -Gdpi=200 X.dot -o X.png      (render.sh does this for every figure)

Notation:
  rectangle = entity type            double rectangle = weak entity type
  diamond   = relationship type      double diamond   = identifying relationship type
  oval      = attribute              underlined       = key attribute
  dashed underline = partial key     dashed oval      = derived attribute
  oval with sub-ovals = composite    double line      = total participation (min >= 1)

Legibility rules implemented here (examiner's corrections 1 and 2):
  * Every entity-relationship line is drawn as its OWN segment, from a point on the diamond's
    border to an anchor point on the entity's border.  When several lines leave the same side
    of an entity, their anchors are spread along that side (minimum gap ANCHOR_GAP), so the
    lines leave a hub such as STUDENT at visibly different points.
  * Each segment carries exactly one (min,max) label, printed ON that segment (white box over
    the line), as close to the entity as collisions allow.  A label can therefore only be read
    as belonging to the line that runs through it.
  * Labels, attributes and lines are checked against each other with polygon tests; the QA
    report lists line crossings and any placement that had to fall back.
"""
import math
import sys

sys.path.insert(0, ".")
from er_model import ENTITIES, RELS, VIEWS  # noqa: E402
from er_layouts import FIGS  # noqa: E402

FONT = "DejaVu Sans"
BLUE = "#1a3d8f"
RED = "#a01818"
ANCHOR_GAP = 0.40      # inches between two line anchors on the same entity side
CORNER = 0.14          # keep anchors this far from a corner


# ------------------------------------------------------------------ text metrics (inches)
def tw(text, size, kind):
    k = {"caps": 0.70, "lower": 0.60, "label": 0.64}[kind]
    return len(text) * size * k / 72.0


# ------------------------------------------------------------------ geometry
def rect_poly(x, y, w, h):
    return [(x - w / 2, y - h / 2), (x + w / 2, y - h / 2), (x + w / 2, y + h / 2), (x - w / 2, y + h / 2)]


def diamond_poly(x, y, w, h):
    return [(x, y - h / 2), (x + w / 2, y), (x, y + h / 2), (x - w / 2, y)]


def ellipse_poly(x, y, w, h, n=16):
    return [(x + w / 2 * math.cos(2 * math.pi * i / n), y + h / 2 * math.sin(2 * math.pi * i / n)) for i in range(n)]


def grow(poly, m):
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    out = []
    for px, py in poly:
        dx, dy = px - cx, py - cy
        L = math.hypot(dx, dy) or 1
        out.append((px + dx / L * m, py + dy / L * m))
    return out


def _axes(poly):
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        yield (-(y2 - y1), x2 - x1)


def _proj(poly, ax):
    v = [p[0] * ax[0] + p[1] * ax[1] for p in poly]
    return min(v), max(v)


def poly_overlap(a, b):
    """Separating-axis test for two convex polygons."""
    for ax in list(_axes(a)) + list(_axes(b)):
        if ax == (0, 0):
            continue
        a0, a1 = _proj(a, ax)
        b0, b1 = _proj(b, ax)
        if a1 < b0 or b1 < a0:
            return False
    return True


def seg_poly(p, q, poly):
    """Does segment pq intersect convex polygon poly?"""
    return poly_overlap([p, q], poly) if p != q else False


def seg_cross(a, b, c, d):
    def o(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2, d3, d4 = o(c, d, a), o(c, d, b), o(a, b, c), o(a, b, d)
    return (d1 * d2 < 0) and (d3 * d4 < 0)


def angdiff(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)


# ------------------------------------------------------------------ figure builder
class Figure:
    def __init__(self, name, spec):
        self.name, self.s = name, spec
        f = spec.get("fonts", {})
        self.fe, self.fr, self.fa, self.fl = f.get("ent", 18), f.get("rel", 13), f.get("att", 14), f.get("lbl", 15)
        self.nodes = {}          # id -> dict(kind, x, y, w, h, poly, ...)
        self.segs = []           # rel segments: dict(p, q, rel, ent, idx, double, text)
        self.alines = []         # attribute connector lines: dict(p, q, owner, aid)
        self.labels = []
        self.warn = []

    # ---------------------------------------------------------- shapes
    def add_entity(self, e, x, y):
        w = self.s.get("ent_w", {}).get(e, tw(e, self.fe, "caps") + 0.45)
        h = self.s.get("ent_h", {}).get(e, self.fe / 72.0 + 0.36)
        weak = ENTITIES[e]["weak"]
        g = 0.12 if weak else 0.0            # the second periphery is drawn 4 pt outside
        self.nodes[e] = dict(kind="entity", x=x, y=y, w=w + g, h=h + g, iw=w, ih=h, weak=weak,
                             poly=rect_poly(x, y, w + g, h + g), stub=e not in self.home)

    def add_rel(self, r, x, y):
        t = tw(r, self.fr, "caps")
        w = self.s.get("rel_w", {}).get(r, 1.52 * t + 0.30)
        h = self.s.get("rel_h", 0.92)
        ident = RELS[r]["kind"] == "identifying"
        g = 0.22 if ident else 0.0
        self.nodes[r] = dict(kind="rel", x=x, y=y, w=w + g, h=h + g * 0.6, iw=w, ih=h, ident=ident,
                             poly=diamond_poly(x, y, w + g, h + g * 0.6))

    # ---------------------------------------------------------- anchors
    def exit_side(self, n, tx, ty):
        dx, dy = tx - n["x"], ty - n["y"]
        tx_ = (n["w"] / 2) / abs(dx) if dx else 1e9
        ty_ = (n["h"] / 2) / abs(dy) if dy else 1e9
        t = min(tx_, ty_)
        px, py = n["x"] + dx * t, n["y"] + dy * t
        if tx_ < ty_:
            return ("e" if dx > 0 else "w"), py
        return ("s" if dy > 0 else "n"), px

    def side_point(self, n, side, c):
        if side in "ns":
            return (c, n["y"] + (n["h"] / 2 if side == "s" else -n["h"] / 2))
        return (n["x"] + (n["w"] / 2 if side == "e" else -n["w"] / 2), c)

    def compute_anchors(self):
        man = self.s.get("anchors", {})
        groups = {}
        self.anchor = {}
        for r in self.rels:
            for i, end in enumerate(RELS[r]["ends"]):
                e = end[0]
                key = f"{r}.{i}"
                n = self.nodes[e]
                if key in man:
                    side, frac = man[key]
                    lo, hi = ((n["x"] - n["w"] / 2, n["x"] + n["w"] / 2) if side in "ns"
                              else (n["y"] - n["h"] / 2, n["y"] + n["h"] / 2))
                    self.anchor[key] = self.side_point(n, side, lo + (hi - lo) * frac)
                    groups.setdefault((e, side), []).append([self.anchor[key][0 if side in "ns" else 1], key, True])
                    continue
                rn = self.nodes[r]
                if n["w"] > 4.0 and abs(rn["y"] - n["y"]) > n["h"] / 2 + 0.3:
                    # wide hub rectangle: the line meets it straight below/above its diamond
                    # (clamped to the rectangle), so the lines keep their left-to-right order
                    side = "s" if rn["y"] > n["y"] else "n"
                    c = min(max(rn["x"], n["x"] - n["w"] / 2 + CORNER), n["x"] + n["w"] / 2 - CORNER)
                else:
                    side, c = self.exit_side(n, rn["x"], rn["y"])
                groups.setdefault((e, side), []).append([c, key, False])
        for (e, side), items in groups.items():
            n = self.nodes[e]
            lo, hi = ((n["x"] - n["w"] / 2 + CORNER, n["x"] + n["w"] / 2 - CORNER) if side in "ns"
                      else (n["y"] - n["h"] / 2 + CORNER * 0.6, n["y"] + n["h"] / 2 - CORNER * 0.6))
            items.sort()
            gap = ANCHOR_GAP if side in "ns" else min(ANCHOR_GAP, (hi - lo) / max(1, len(items) - 1))
            if (len(items) - 1) * gap > hi - lo:
                gap = (hi - lo) / max(1, len(items) - 1)
            cs = [min(max(it[0], lo), hi) for it in items]
            for k in range(1, len(cs)):
                cs[k] = max(cs[k], cs[k - 1] + gap)
            if cs and cs[-1] > hi:
                cs[-1] = hi
                for k in range(len(cs) - 2, -1, -1):
                    cs[k] = min(cs[k], cs[k + 1] - gap)
            for it, c in zip(items, cs):
                if not it[2]:
                    self.anchor[it[1]] = self.side_point(n, side, c)

    def diamond_point(self, r, toward, vertex=None):
        n = self.nodes[r]
        if vertex:
            return {"n": (n["x"], n["y"] - n["h"] / 2), "s": (n["x"], n["y"] + n["h"] / 2),
                    "e": (n["x"] + n["w"] / 2, n["y"]), "w": (n["x"] - n["w"] / 2, n["y"])}[vertex]
        dx, dy = toward[0] - n["x"], toward[1] - n["y"]
        t = 1.0 / (abs(dx) / (n["w"] / 2) + abs(dy) / (n["h"] / 2))
        return (n["x"] + dx * t, n["y"] + dy * t)

    # ---------------------------------------------------------- build
    def build(self):
        s = self.s
        self.home = set(s["home"])
        self.rels = list(s["rels"])
        ents = set(s["ents"])
        for r in self.rels:
            for end in RELS[r]["ends"]:
                assert end[0] in ents, (self.name, r, end[0])
        for e, (x, y) in s["ents"].items():
            self.add_entity(e, x, y)
        for r in self.rels:
            x, y = s["relpos"][r]
            self.add_rel(r, x, y)
        self.compute_anchors()
        dv = s.get("dvertex", {})
        for r in self.rels:
            d = RELS[r]
            for i, end in enumerate(d["ends"]):
                e, mm = end[0], end[1]
                role = end[2] if len(end) > 2 else None
                key = f"{r}.{i}"
                a = self.anchor[key]
                p = self.diamond_point(r, a, dv.get(key))
                text = mm if not role else f"{role} {mm}"
                ratio = (d.get("ratio") or {}).get(e)
                self.segs.append(dict(p=p, q=a, rel=r, ent=e, idx=i, double=int(mm.strip("()").split(",")[0]) >= 1,
                                      text=text, ratio=ratio))
        # relationship-type attributes first (diamonds have the least room), then entity attributes
        self.place_labels()
        owners = [(r, RELS[r]["attrs"]) for r in self.rels]
        ent_owners = [(e, ENTITIES[e]["attrs"]) for e in s["ents"] if e in self.home]
        owners += sorted(ent_owners, key=lambda t: -len(t[1]))
        for owner, attrs in owners:
            for a in attrs:
                if s["mode"] == "keys" and not (a["key"] or a["partial"]):
                    continue
                self.place_attr(owner, a)
        self.qa()

    # ---------------------------------------------------------- (min,max) labels on their own segment
    def node_polys(self, skip=()):
        return [(nid, n["poly"]) for nid, n in self.nodes.items() if nid not in skip and n["kind"] != "pt"]

    def label_ok(self, poly, seg):
        for nid, pg in self.node_polys():
            if poly_overlap(grow(poly, 0.03), pg):
                return False
        for o in self.segs:
            if o is seg:
                continue
            if seg_poly(o["p"], o["q"], grow(poly, 0.04)):
                return False
        for al in self.alines:
            if seg_poly(al["p"], al["q"], grow(poly, 0.04)):
                return False
        return True

    def place_labels(self):
        pref = self.s.get("label_at", {})
        for sg in self.segs:
            text = sg["text"] + (f"  {sg['ratio']}" if sg["ratio"] else "")
            w = tw(text, self.fl, "label") + 0.14
            h = self.fl / 72.0 + 0.12
            (ax, ay), (dx_, dy_) = sg["q"], sg["p"]
            L = math.hypot(dx_ - ax, dy_ - ay)
            ux, uy = (dx_ - ax) / L, (dy_ - ay) / L
            # the label box centred on the line must clear the entity: start where it does
            key = f"{sg['rel']}.{sg['idx']}"
            dstart = pref.get(key, 0.0)
            best = None
            d = max(dstart, 0.12)
            while d < L - 0.1:
                cx, cy = ax + ux * d, ay + uy * d
                poly = rect_poly(cx, cy, w, h)
                if self.label_ok(poly, sg):
                    best = (cx, cy)
                    break
                d += 0.05
            if not best:
                d = L / 2
                best = (ax + ux * d, ay + uy * d)
                self.warn.append(f"label fallback {key} {text}")
            lid = f"L_{key}"
            self.nodes[lid] = dict(kind="label", x=best[0], y=best[1], w=w, h=h, text=sg["text"],
                                   ratio=sg["ratio"], poly=rect_poly(best[0], best[1], w, h))
            sg["label"] = lid
            self.labels.append(lid)

    # ---------------------------------------------------------- attributes
    def place_attr(self, owner, a, depth=0):
        o = self.nodes[owner]
        name = a["name"]
        w, h = tw(name, self.fa, "lower") + 0.42, self.fa / 72.0 + 0.30
        inc = []
        for sg in self.segs:
            if sg["rel"] == owner:
                inc.append(math.atan2(sg["q"][1] - o["y"], sg["q"][0] - o["x"]))
            if sg["ent"] == owner:
                inc.append(math.atan2(sg["p"][1] - o["y"], sg["p"][0] - o["x"]))
        for al in self.alines:
            if al["owner"] == owner:
                inc.append(math.atan2(al["q"][1] - o["y"], al["q"][0] - o["x"]))
            if al["aid"] == owner:
                inc.append(math.atan2(al["p"][1] - o["y"], al["p"][0] - o["x"]))
        hint = self.s.get("attr_dir", {}).get(owner)
        best = None
        fixed = self.s.get("attr_pos", {}).get(f"{owner}.{name}")
        if fixed:                       # hand-placed (offset from the owner's centre)
            best = (o["x"] + fixed[0], o["y"] + fixed[1])
        for ring in range(0, 40 if not fixed else 0):
            gap = 0.22 + ring * 0.16
            cands = []
            for k in range(72):
                ang = math.radians(k * 5)
                ca, sa = math.cos(ang), math.sin(ang)
                x = o["x"] + ca * (o["w"] / 2 + gap + w / 2 * abs(ca) ** 0.5)
                y = o["y"] + sa * (o["h"] / 2 + gap * 1.8 + h / 2)
                poly = ellipse_poly(x, y, w, h, 12)
                if any(poly_overlap(grow(poly, 0.12 if self.nodes[nid]["kind"] == "label" else 0.06), pg)
                       for nid, pg in self.node_polys()):
                    continue
                # connector: from the owner's centre to the attribute's centre
                p0, p1 = (o["x"], o["y"]), (x, y)
                bad = False
                for sg in self.segs:
                    if seg_cross(p0, p1, sg["p"], sg["q"]) or seg_poly(sg["p"], sg["q"], grow(poly, 0.05)):
                        bad = True
                        break
                if bad:
                    continue
                for al in self.alines:
                    if al["owner"] == owner or al["aid"] == owner:
                        continue
                    if seg_cross(p0, p1, al["p"], al["q"]) or seg_poly(al["p"], al["q"], grow(poly, 0.05)):
                        bad = True
                        break
                if bad:
                    continue
                if any(seg_poly(p0, p1, grow(pg, 0.02)) for nid, pg in self.node_polys(skip=(owner,))):
                    continue
                g = min([angdiff(ang, i) for i in inc] or [math.pi])
                score = -g
                if hint is not None:
                    score += 0.8 * angdiff(ang, math.radians(hint))
                cands.append((score, x, y))
            if cands:
                cands.sort()
                best = cands[0][1:]
                break
        if not best:
            self.warn.append(f"attr fallback {owner}.{name}")
            best = (o["x"], o["y"] - 1.2)
        aid = f"A_{owner}_{name}_{len(self.nodes)}"
        self.nodes[aid] = dict(kind="attr", x=best[0], y=best[1], w=w, h=h, text=name, key=a["key"],
                               partial=a["partial"], derived=a["derived"], multi=a["multi"],
                               poly=ellipse_poly(best[0], best[1], w, h, 12))
        self.alines.append(dict(p=(o["x"], o["y"]), q=best, owner=owner, aid=aid))
        if a.get("comp"):
            for c in a["comp"]:
                self.place_attr(aid, dict(name=c, key=False, partial=False, derived=False, multi=False, comp=None),
                                depth + 1)

    # ---------------------------------------------------------- QA
    def qa(self):
        n = 0
        for i in range(len(self.segs)):
            for j in range(i + 1, len(self.segs)):
                a, b = self.segs[i], self.segs[j]
                if seg_cross(a["p"], a["q"], b["p"], b["q"]):
                    n += 1
                    print(f"  crossing: {a['rel']}-{a['ent']}  x  {b['rel']}-{b['ent']}")
        for sg in self.segs:
            for nid, pg in self.node_polys(skip=(sg["rel"], sg["ent"], sg.get("label"))):
                if self.nodes[nid]["kind"] in ("entity", "rel", "attr", "label") and seg_poly(sg["p"], sg["q"], grow(pg, -0.01)):
                    self.warn.append(f"line {sg['rel']}-{sg['ent']} passes through {nid}")
        big = [k for k, v in self.nodes.items() if v["kind"] in ("entity", "rel")]
        for i in range(len(big)):
            for j in range(i + 1, len(big)):
                if poly_overlap(grow(self.nodes[big[i]]["poly"], 0.12), self.nodes[big[j]]["poly"]):
                    self.warn.append(f"shapes too close: {big[i]} / {big[j]}")
        self.crossings = n
        xs = [p[0] for _, pg in self.node_polys() for p in pg]
        ys = [p[1] for _, pg in self.node_polys() for p in pg]
        self.bbox = (min(xs), min(ys), max(xs), max(ys))
        print(f"{self.name}: {len(self.segs)} lines, {n} crossings, size {max(xs)-min(xs):.1f} x {max(ys)-min(ys):.1f} in")
        for w in self.warn:
            print("  WARN", w)

    # ---------------------------------------------------------- emit dot
    def dot(self):
        P = 72.0
        out = ["graph ER {",
               f'  graph [splines=line, outputorder=edgesfirst, pad=0.25, bgcolor=white, '
               f'label=<<B>{self.s["title"]}</B>>, labelloc=t, fontsize={self.s.get("title_size", 24)}, fontname="{FONT}"];',
               f'  node [fontname="{FONT}", fixedsize=true, penwidth=1.4];',
               "  edge [penwidth=1.3, color=black];"]

        def pos(x, y):
            return f'{x * P:.1f},{-y * P:.1f}!'
        for nid, n in self.nodes.items():
            k = n["kind"]
            if k == "entity":
                fill = "#e4e6ea" if n["stub"] else "#eef3fb"
                style = "filled"
                out.append(f'  "{nid}" [shape=box, pos="{pos(n["x"], n["y"])}", width={n["iw"]:.3f}, height={n["ih"]:.3f}, '
                           f'label=<<B>{nid}</B>>, fontsize={self.fe}, style="{style}", fillcolor="{fill}"'
                           + (', peripheries=2' if n["weak"] else '') + '];')
            elif k == "rel":
                out.append(f'  "{nid}" [shape=diamond, pos="{pos(n["x"], n["y"])}", width={n["iw"]:.3f}, height={n["ih"]:.3f}, '
                           f'label=<<B>{nid}</B>>, fontsize={self.fr}, style=filled, fillcolor="#fdf3e1"'
                           + (', peripheries=2' if n["ident"] else '') + '];')
            elif k == "attr":
                lab = n["text"]
                if n["key"]:
                    lab = f"<U>{lab}</U>"
                elif n["partial"]:
                    lab = ('<TABLE BORDER="0" CELLSPACING="0" CELLPADDING="0"><TR>'
                           f'<TD BORDER="1" SIDES="B" STYLE="dashed">{lab}</TD></TR></TABLE>')
                style = "dashed" if n["derived"] else "solid"
                out.append(f'  "{nid}" [shape=ellipse, pos="{pos(n["x"], n["y"])}", width={n["w"]:.3f}, height={n["h"]:.3f}, '
                           f'label=<{lab}>, fontsize={self.fa}, style="{style},filled", fillcolor=white'
                           + (', peripheries=2' if n["multi"] else '') + '];')
            elif k == "label":
                lab = n["text"]
                if n["ratio"]:
                    lab += f'  <FONT COLOR="{RED}"><I>{n["ratio"]}</I></FONT>'
                out.append(f'  "{nid}" [shape=box, pos="{pos(n["x"], n["y"])}", width={n["w"]:.3f}, height={n["h"]:.3f}, '
                           f'label=<<B>{lab}</B>>, fontsize={self.fl}, fontcolor="{BLUE}", style=filled, '
                           f'fillcolor=white, color=white, penwidth=0, margin=0];')
        k = 0
        for sg in self.segs:
            a, b = f"P{k}a", f"P{k}b"
            k += 1
            for pid, (x, y) in ((a, sg["p"]), (b, sg["q"])):
                out.append(f'  "{pid}" [shape=point, width=0.01, height=0.01, style=invis, pos="{pos(x, y)}"];')
            st = 'color="black:invis:black", penwidth=1.1' if sg["double"] else ""
            out.append(f'  "{a}" -- "{b}" [{st}];')
        for al in self.alines:
            out.append(f'  "{al["owner"]}" -- "{al["aid"]}" [penwidth=1.0];')
        out.append("}")
        return "\n".join(out)


def build_all(only=None):
    res = {}
    for name, spec in FIGS.items():
        if only and name not in only:
            continue
        f = Figure(name, spec)
        f.build()
        open(f"{name}.dot", "w").write(f.dot())
        res[name] = f
    return res


if __name__ == "__main__":
    # the five views must partition the relationship types and the home entity types
    allr = [r for v in VIEWS.values() for r in v["rels"]]
    alle = [e for v in VIEWS.values() for e in v["home"]]
    assert sorted(allr) == sorted(RELS), "views must draw every relationship type exactly once"
    assert sorted(alle) == sorted(ENTITIES), "every entity type must have exactly one home view"
    build_all(set(sys.argv[1:]) or None)
