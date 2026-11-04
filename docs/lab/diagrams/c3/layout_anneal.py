"""
Layout refinement for the overview ER figure (QA helper; not needed to rebuild the figures).

Low-temperature simulated annealing over the centres of entity rectangles and relationship
diamonds, starting from the hand layout in er_layouts.py and using the real shape sizes
from gen_er.py.  Cost (evaluated incrementally, only for terms that touch the moved shape):
  60 x line crossings, 300 x line through another shape, 300 x shapes closer than 0.6 in,
  a penalty for lines too short to carry their (min,max) label, a small-angle penalty at
  every entity, total line length, and canvas overflow.
The best layout is printed as Python to paste into er_layouts.py; it is then polished by hand.

    python3 layout_anneal.py [iterations] [seed] [temperature]
"""
import math
import random
import sys

sys.path.insert(0, ".")
from er_model import RELS, ENTITIES  # noqa: E402
from er_layouts import FIGS  # noqa: E402
from gen_er import Figure, seg_cross  # noqa: E402

NAME = "er_core_overview"
W, H = 31.0, 20.2
CLEAR = 0.5


class Model:
    def __init__(self):
        spec = FIGS[NAME]
        f = Figure(NAME, spec)
        f.home = set(spec["home"])
        f.rels = list(spec["rels"])
        for e, (x, y) in spec["ents"].items():
            f.add_entity(e, x, y)
        for r in f.rels:
            f.add_rel(r, *spec["relpos"][r])
        self.size = {n: (d["w"], d["h"]) for n, d in f.nodes.items()}
        self.kind = {n: d["kind"] for n, d in f.nodes.items()}
        self.pos = dict(spec["ents"])
        self.pos.update(spec["relpos"])
        self.edges = [(r, e[0]) for r in f.rels for e in RELS[r]["ends"] if r != "SUBSKILL_OF"]
        self.inc = {}
        for i, (r, e) in enumerate(self.edges):
            self.inc.setdefault(r, []).append(i)
            self.inc.setdefault(e, []).append(i)
        self.fixed = set(spec.get("fixed", []))

    def endpoint(self, e, r):
        (x, y), (w, h) = self.pos[e], self.size[e]
        rx, ry = self.pos[r]
        if w > 4 and abs(ry - y) > h / 2 + 0.3:   # as gen_er.py
            return (min(max(rx, x - w / 2 + 0.14), x + w / 2 - 0.14), y + (h / 2 if ry > y else -h / 2))
        if w > 4:                     # exit point of the ray from the centre
            dx, dy = rx - x, ry - y
            t = min((w / 2) / abs(dx) if dx else 1e9, (h / 2) / abs(dy) if dy else 1e9)
            return (x + dx * t, y + dy * t)
        return (x, y)

    def seg(self, i):
        r, e = self.edges[i]
        return self.pos[r], self.endpoint(e, r)

    def through(self, i, n):
        r, e = self.edges[i]
        if n in (r, e):
            return False
        p, q = self.seg(i)
        (x, y), (w, h) = self.pos[n], self.size[n]
        m = 0.2
        if self.kind[n] == "rel":
            w, h = w * 0.75, h * 0.75
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        k = max(4, int(L / 0.2))
        for t in range(1, k):
            px = p[0] + (q[0] - p[0]) * t / k
            py = p[1] + (q[1] - p[1]) * t / k
            if abs(px - x) < w / 2 + m and abs(py - y) < h / 2 + m:
                return True
        return False

    def close(self, a, b):
        (xa, ya), (xb, yb) = self.pos[a], self.pos[b]
        wa, ha = self.size[a]
        wb, hb = self.size[b]
        dx = abs(xa - xb) - (wa + wb) / 2
        dy = abs(ya - yb) - (ha + hb) / 2
        if dx < CLEAR and dy < CLEAR:
            return 300 + 100 * (CLEAR - max(dx, dy))
        return 0

    def seglen(self, i):
        r, e = self.edges[i]
        p, q = self.seg(i)
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        vis = L - self.size[r][0] / 4 - (0 if self.size[e][0] > 4 else self.size[e][0] / 4)
        return 0.35 * L + (40 * (1.7 - vis) if vis < 1.7 else 0)

    def angles(self, e):
        a = []
        for i in self.inc.get(e, []):
            p, q = self.seg(i)
            a.append(math.atan2(p[1] - q[1], p[0] - q[0]))
        a.sort()
        c = 0
        for k in range(len(a)):
            d = (a[(k + 1) % len(a)] - a[k]) % (2 * math.pi) if len(a) > 1 else 7
            if d < math.radians(15):
                c += 25 * (math.radians(15) - d) / math.radians(15)
        return c

    def local(self, n):
        segs = set(self.inc.get(n, []))
        c = 0.0
        ncr = 0
        for i in segs:
            p, q = self.seg(i)
            ri, ei = self.edges[i]
            for j in range(len(self.edges)):
                if j == i or (j in segs and j < i):
                    continue
                rj, ej = self.edges[j]
                if len({ri, ei, rj, ej}) < 4:
                    continue
                r2, s2 = self.seg(j)
                if seg_cross(p, q, r2, s2):
                    ncr += 1
        c += 150 * ncr
        thr = 0
        for i in segs:
            for m in self.pos:
                if self.through(i, m):
                    thr += 1
        for j in range(len(self.edges)):
            if j not in segs and self.through(j, n):
                thr += 1
        c += 300 * thr
        for m in self.pos:
            if m != n:
                c += self.close(n, m)
        for i in segs:
            c += self.seglen(i)
        ents = {self.edges[i][1] for i in segs}
        if n in ENTITIES:
            ents.add(n)
        for e in ents:
            c += self.angles(e)
        return c

    def overflow(self):
        xs = [self.pos[n][0] - self.size[n][0] / 2 for n in self.pos] + [self.pos[n][0] + self.size[n][0] / 2 for n in self.pos]
        ys = [self.pos[n][1] - self.size[n][1] / 2 for n in self.pos] + [self.pos[n][1] + self.size[n][1] / 2 for n in self.pos]
        return 80 * (max(0, max(xs) - min(xs) - W) + max(0, max(ys) - min(ys) - H))

    def report(self):
        ncr = sum(1 for i in range(len(self.edges)) for j in range(i + 1, len(self.edges))
                  if len(set(self.edges[i]) | set(self.edges[j])) == 4 and seg_cross(*self.seg(i), *self.seg(j)))
        thr = sum(1 for i in range(len(self.edges)) for m in self.pos if self.through(i, m))
        names = list(self.pos)
        cl = sum(1 for a in range(len(names)) for b in names[a + 1:] if self.close(names[a], b))
        return dict(crossings=ncr, through=thr, close=cl)


def run(iters, seed, T0):
    random.seed(seed)
    m = Model()
    movable = [n for n in m.pos if n not in m.fixed]
    print("start", m.report())
    ov = m.overflow()
    for it in range(iters):
        T = T0 * (1 - it / iters) + 0.3
        sig = 0.9 * (1 - it / iters) + 0.1
        n = random.choice(movable)
        before = m.local(n) + ov
        old = m.pos[n]
        m.pos[n] = (round(old[0] + random.gauss(0, sig), 2), round(old[1] + random.gauss(0, sig), 2))
        ov2 = m.overflow()
        after = m.local(n) + ov2
        if after <= before or random.random() < math.exp((before - after) / T):
            ov = ov2
        else:
            m.pos[n] = old
    print("end", m.report())
    print("    ents={")
    print(",\n".join(f'        "{k}": ({v[0]:.1f}, {v[1]:.1f})' for k, v in m.pos.items() if k in ENTITIES) + "},")
    print("    relpos={")
    print(",\n".join(f'        "{k}": ({v[0]:.1f}, {v[1]:.1f})' for k, v in m.pos.items() if k in RELS) + "},")


if __name__ == "__main__":
    run(int(sys.argv[1]) if len(sys.argv) > 1 else 20000, int(sys.argv[2]) if len(sys.argv) > 2 else 1,
        float(sys.argv[3]) if len(sys.argv) > 3 else 8.0)
