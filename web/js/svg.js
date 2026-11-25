// Small helpers for drawing the scene as SVG markup: a seeded random generator (so the valley
// looks the same on every visit), smooth curves, and generators for repeated detail such as
// fern fronds, grass, conifers, rocks and clouds. Everything returns SVG strings.

export const INK = "#24160a";

/** A deterministic random generator (mulberry32). rnd() is in [0, 1). */
export function rng(seed) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.range = (lo, hi) => lo + (hi - lo) * rnd();
  rnd.pick = (list) => list[Math.floor(rnd() * list.length)];
  return rnd;
}

const f = (n) => Math.round(n * 10) / 10;

/** A smooth path through points ([x, y] pairs) using Catmull-Rom curves. */
export function smooth(points, closed = false) {
  const p = points;
  const n = p.length;
  if (n < 2) return "";
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  const get = (i) => (closed ? p[(i + n) % n] : p[Math.max(0, Math.min(n - 1, i))]);
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? d + "Z" : d;
}

/** Points along a hilly ridge between x0 and x1 around baseY. */
export function ridgePoints(rnd, x0, x1, baseY, amp, steps) {
  const pts = [];
  const phase = rnd() * 10, phase2 = rnd() * 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = baseY
      - amp * (0.55 * Math.sin(t * 5.1 + phase) + 0.3 * Math.sin(t * 11.3 + phase2) + 0.15 * (rnd() - 0.5) * 2);
    pts.push([x, y]);
  }
  return pts;
}

/** A filled hill shape: a ridge, closed down to bottomY. */
export function hill(points, bottomY) {
  const first = points[0], last = points[points.length - 1];
  return `${smooth(points)} L${f(last[0])} ${bottomY} L${f(first[0])} ${bottomY}Z`;
}

/** Animation helpers (SMIL, so rotation happens about each group's own origin). */
export function sway(deg, dur, delay = 0) {
  return `<animateTransform attributeName="transform" type="rotate" values="${-deg};${deg};${-deg}" dur="${dur}s" begin="${-delay}s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
}
export function bob(dy, dur, delay = 0) {
  return `<animateTransform attributeName="transform" type="translate" values="0 0;0 ${dy};0 0" dur="${dur}s" begin="${-delay}s" repeatCount="indefinite" additive="sum" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1"/>`;
}

/**
 * A leaflet: a pointed leaf along its own +x axis, length len, width w, placed at (px, py) and
 * turned by angle a (radians). The points are transformed here, so many leaflets can share
 * one path (one element per frond side instead of one per leaf).
 */
function leafPath(len, w, curl, px, py, a) {
  const cos = Math.cos(a), sin = Math.sin(a);
  const p = (x, y) => `${f(px + x * cos - y * sin)} ${f(py + x * sin + y * cos)}`;
  return `M${p(0, 0)} C${p(len * 0.25, -w + curl)} ${p(len * 0.7, -w * 0.8 + curl)} ${p(len, curl * 1.6)} `
    + `C${p(len * 0.7, w * 0.7 + curl)} ${p(len * 0.25, w * 0.9 + curl)} ${p(0, 0)}Z`;
}

/**
 * A fern frond rooted at (0,0), growing along an arc. Returns a <g>.
 * opts: length, bend (radians of total curl), angle (start direction, radians, -PI/2 is up),
 *       leaf (max leaflet length), colors {dark, mid, light, rib}, outline (bool)
 */
export function frond(rnd, o) {
  const n = o.leaflets ?? 18;
  const len = o.length;
  const pts = [];
  let ang = o.angle ?? -Math.PI / 2;
  let x = 0, y = 0;
  const step = len / n;
  for (let i = 0; i <= n; i++) {
    pts.push([x, y, ang]);
    x += Math.cos(ang) * step;
    y += Math.sin(ang) * step;
    ang += (o.bend ?? 0.6) / n;
  }
  const c = o.colors;
  let back = "", front = "", veins = "";
  for (let i = 1; i < n; i++) {
    const [px, py, a] = pts[i];
    const t = i / n;
    const size = (o.leaf ?? 40) * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.05)) * (0.85 + rnd() * 0.3);
    if (size < 3) continue;
    const w = size * (o.leafWidth ?? 0.34);
    for (const side of [-1, 1]) {
      const la = a + side * (1.05 - t * 0.35) + (rnd() - 0.5) * 0.12;
      const d = leafPath(size, w, side * w * 0.3, px, py, la);
      if (side < 0) back += d; else front += d;
      if (o.light && size > 14) {
        const cos = Math.cos(la), sin = Math.sin(la), ex = size * 0.8, ey = side * w * 0.1;
        veins += `M${f(px)} ${f(py)} L${f(px + ex * cos - ey * sin)} ${f(py + ex * sin + ey * cos)}`;
      }
    }
  }
  const stroke = o.outline ? ` stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"` : "";
  const rib = smooth(pts.map((p) => [p[0], p[1]]));
  return `<g>${back ? `<path d="${back}" fill="${c.dark}"${stroke}/>` : ""}`
    + `<path d="${rib}" stroke="${o.outline ? INK : c.rib}" stroke-width="${o.ribWidth ?? 3.2}" fill="none" stroke-linecap="round"/>`
    + (o.outline ? `<path d="${rib}" stroke="${c.rib}" stroke-width="${(o.ribWidth ?? 3.2) - 1.6}" fill="none" stroke-linecap="round"/>` : "")
    + (front ? `<path d="${front}" fill="${c.mid}"${stroke}/>` : "")
    + (veins ? `<path d="${veins}" stroke="${c.light}" stroke-width="1.4" fill="none" stroke-linecap="round" opacity=".8"/>` : "")
    + `</g>`;
}

/** A clump of fronds rooted at (0,0). */
export function fernClump(rnd, o) {
  const count = o.count ?? 7;
  let out = "";
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = -Math.PI / 2 + (t - 0.5) * (o.spread ?? 2.2) + (rnd() - 0.5) * 0.15;
    const bend = (t - 0.5) * (o.bendSpread ?? 1.6) + (rnd() - 0.5) * 0.2;
    const length = o.length * (0.75 + 0.35 * Math.sin(Math.PI * t)) * (0.9 + rnd() * 0.2);
    const g = frond(rnd, { ...o, angle, bend, length });
    out += o.animate ? `<g>${sway(o.swayDeg ?? 2.5, rnd.range(5, 9), rnd() * 8)}${g}</g>` : g;
  }
  return out;
}

/** A grass tuft at (x, y): a few tapered blades. */
export function tuft(rnd, x, y, h, colors) {
  let d = "";
  const blades = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < blades; i++) {
    const bx = x + (i - blades / 2) * h * 0.12 + (rnd() - 0.5) * 3;
    const lean = (rnd() - 0.5) * h * 0.9;
    const bh = h * (0.6 + rnd() * 0.5);
    const w = h * 0.07 + 1;
    d += `M${f(bx - w)} ${f(y)} Q${f(bx + lean * 0.3)} ${f(y - bh * 0.6)} ${f(bx + lean)} ${f(y - bh)} Q${f(bx + lean * 0.3 + w)} ${f(y - bh * 0.5)} ${f(bx + w)} ${f(y)}Z`;
  }
  return `<path d="${d}" fill="${rnd.pick(colors)}"/>`;
}

/** A rock at (0,0) sitting on its base: lumpy outline, shadow side and highlight. */
export function rock(rnd, w, h, c) {
  const pts = [];
  const k = 9;
  for (let i = 0; i <= k; i++) {
    const a = Math.PI + (i / k) * Math.PI;
    const r = 0.85 + rnd() * 0.25;
    pts.push([Math.cos(a) * w * 0.5 * r, Math.sin(a) * h * r]);
  }
  pts[0][1] = 0; pts[k][1] = 0;
  const top = smooth(pts);
  const shade = `M${f(w * 0.05)} ${f(-h * 0.9)} C${f(w * 0.35)} ${f(-h * 0.8)} ${f(w * 0.5)} ${f(-h * 0.4)} ${f(w * 0.48)} 0 L${f(w * 0.1)} 0 C${f(w * 0.2)} ${f(-h * 0.35)} ${f(w * 0.15)} ${f(-h * 0.6)} ${f(w * 0.05)} ${f(-h * 0.9)}Z`;
  return `<g><path d="${top}Z" fill="${c.mid}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<path d="${shade}" fill="${c.dark}" opacity=".85"/>`
    + `<path d="M${f(-w * 0.3)} ${f(-h * 0.62)} Q${f(-w * 0.12)} ${f(-h * 0.95)} ${f(w * 0.08)} ${f(-h * 0.88)}" stroke="${c.light}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `<path d="${top}" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/></g>`;
}

/** A cartoon cloud of width w: puffs with a shaded underside and a bright rim on top. */
export function cloud(rnd, w) {
  const puffs = [];
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = w * (0.11 + 0.11 * Math.sin(Math.PI * t)) * (0.85 + rnd() * 0.3);
    puffs.push([w * (0.1 + 0.8 * t), -r * (0.55 + rnd() * 0.3), r]);
  }
  const circles = (dx, dy, extra, fill) => puffs.map(([x, y, r]) => `<circle cx="${f(x + dx)}" cy="${f(y + dy)}" r="${f(r + extra)}" fill="${fill}"/>`).join("");
  const base = `<rect x="${f(w * 0.08)}" y="${f(-w * 0.07)}" width="${f(w * 0.84)}" height="${f(w * 0.07)}" rx="${f(w * 0.035)}"`;
  return `<g>`
    + circles(0, 0, 3, "#5d8fa3") + `${base.replace("<rect", `<rect fill="#5d8fa3"`)} transform="translate(0 3)"/>`
    + circles(0, 0, 0, "#cfe3ea") + `${base} fill="#cfe3ea"/>`
    + circles(-w * 0.012, -w * 0.02, -w * 0.012, "#ffffff")
    + `</g>`;
}

/** An Araucaria-style conifer rooted at (0,0): tiered drooping branches with needle tufts. */
export function conifer(rnd, h, c, outline = true) {
  const tiers = 7;
  let out = `<path d="M-${f(h * 0.025)} 0 L-${f(h * 0.012)} -${f(h)} L${f(h * 0.012)} -${f(h)} L${f(h * 0.025)} 0Z" fill="${c.trunk}"${outline ? ` stroke="${INK}" stroke-width="2"` : ""}/>`;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = -h * (0.42 + 0.56 * t);
    const span = h * (0.34 - 0.27 * t) * (0.9 + rnd() * 0.2);
    const droop = h * 0.05;
    for (const side of [-1, 1]) {
      const ex = side * span, ey = y + droop;
      const tone = side < 0 ? c.dark : c.mid;
      const needles = `M0 ${f(y - 4)} Q${f(ex * 0.5)} ${f(y - droop * 0.9)} ${f(ex)} ${f(ey - 2)} Q${f(ex * 1.06)} ${f(ey + 8)} ${f(ex * 0.9)} ${f(ey + 9)} Q${f(ex * 0.5)} ${f(y + droop * 0.6)} 0 ${f(y + 7)}Z`;
      out += `<path d="${needles}" fill="${tone}"${outline ? ` stroke="${INK}" stroke-width="2" stroke-linejoin="round"` : ""}/>`;
      if (outline) {
        out += `<path d="M${f(ex * 0.15)} ${f(y - 1)} Q${f(ex * 0.5)} ${f(y - droop * 0.5)} ${f(ex * 0.85)} ${f(ey - 1)}" stroke="${c.light}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>`;
        let hatch = "";
        for (let k = 0.2; k < 0.95; k += 0.09) {
          const hx = ex * k, hy = y + (ey - y) * k * k - 1;
          hatch += `M${f(hx)} ${f(hy + 1)} l${f(side * 3)} ${f(7 + rnd() * 3)}`;
        }
        out += `<path d="${hatch}" stroke="${c.dark === tone ? "#1f4f27" : c.dark}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/>`;
      }
    }
  }
  out += `<path d="M0 ${f(-h - 10)} l-${f(h * 0.03)} 14 l${f(h * 0.06)} 0z" fill="${c.mid}"${outline ? ` stroke="${INK}" stroke-width="2" stroke-linejoin="round"` : ""}/>`;
  return `<g>${out}</g>`;
}

/** A cycad rooted at (0,0): a stout scaly trunk with a crown of stiff fronds. */
export function cycad(rnd, h, c) {
  const tw = h * 0.22;
  let trunk = `<path d="M${f(-tw * 0.6)} 0 C${f(-tw * 0.55)} ${f(-h * 0.3)} ${f(-tw * 0.5)} ${f(-h * 0.45)} ${f(-tw * 0.45)} ${f(-h * 0.55)} L${f(tw * 0.45)} ${f(-h * 0.55)} C${f(tw * 0.5)} ${f(-h * 0.45)} ${f(tw * 0.55)} ${f(-h * 0.3)} ${f(tw * 0.6)} 0Z" fill="${c.trunk}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  for (let y = -8; y > -h * 0.52; y -= 11) {
    for (let x = -tw * 0.4; x < tw * 0.45; x += 12) {
      trunk += `<path d="M${f(x)} ${f(y)} l6 -6 l6 6" fill="none" stroke="${c.trunkDark}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  const crown = fernClump(rnd, {
    count: 9, length: h * 0.75, spread: 3.4, bendSpread: 2.2, leaf: h * 0.13, leaflets: 14,
    colors: c.leaves, outline: true, light: true, ribWidth: 3.4,
  });
  return `<g>${trunk}<g transform="translate(0 ${f(-h * 0.55)})">${sway(1.6, 7, rnd() * 6)}${crown}</g></g>`;
}

/** A tree fern rooted at (0,0): a thin shaggy trunk topped with arching fronds. */
export function treeFern(rnd, h, c) {
  const trunk = `<path d="M-7 0 C-5 ${f(-h * 0.4)} -9 ${f(-h * 0.7)} -4 ${f(-h)} L5 ${f(-h)} C2 ${f(-h * 0.7)} 7 ${f(-h * 0.4)} 8 0Z" fill="${c.trunk}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
  let shag = "";
  for (let y = -10; y > -h * 0.95; y -= 9) shag += `<path d="M-5 ${f(y)} q5 4 10 0" stroke="${c.trunkDark}" stroke-width="2" fill="none"/>`;
  const crown = fernClump(rnd, {
    count: 8, length: h * 0.55, spread: 3.6, bendSpread: 2.8, leaf: h * 0.09, leaflets: 16,
    colors: c.leaves, outline: true, light: true, ribWidth: 3,
  });
  return `<g>${trunk}${shag}<g transform="translate(0 ${f(-h)})">${sway(2, 8, rnd() * 6)}${crown}</g></g>`;
}
