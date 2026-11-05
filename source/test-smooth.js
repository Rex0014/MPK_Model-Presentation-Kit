/* Self-check for the auto-smooth pass engine.js runs on a model (`model.smooth`):
   node test-smooth.js
   What can silently break is the angle: wrong units, or an edge that should stay
   hard getting averaged away. A regular 8-gon prism makes both measurable — its
   side faces meet at 45°, its rim at 90°. */
const assert = require('assert');
global.window = {}; global.self = global.window;
require('./vendor/three.bundle.js');
const T = window.THREE, { toCreasedNormals } = window.THREE_ADDONS;

// the call engine.js makes, degrees in
const smooth = (deg) => toCreasedNormals(new T.CylinderGeometry(1, 1, 2, 8), deg * Math.PI / 180);

// Largest angle, in degrees, between a triangle's own face normal and its three
// vertex normals. 0 means every face is still flat-shaded; the bigger it gets,
// the more edges have been smoothed over.
function deviation(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, v = [0, 1, 2].map(() => new T.Vector3());
  let max = 0;
  for (let i = 0; i < p.count; i += 3) {
    v.forEach((x, k) => x.fromBufferAttribute(p, i + k));
    const face = new T.Vector3().subVectors(v[2], v[1]).cross(new T.Vector3().subVectors(v[0], v[1])).normalize();
    for (let k = 0; k < 3; k++) max = Math.max(max, face.angleTo(new T.Vector3().fromBufferAttribute(n, i + k)) * 180 / Math.PI);
  }
  return max;
}

// below the crease angle nothing merges: a faceted mesh stays faceted
for (const a of [1, 20, 30, 44]) assert.ok(deviation(smooth(a)) < 1e-3, a + '° must leave 45° faces hard');

// past it the side wall shades round — and the 90° rim is still a hard edge,
// so the deviation stays well under the 54° it reaches once the caps merge too
for (const a of [46, 60, 89]) {
  const d = deviation(smooth(a));
  assert.ok(d > 10 && d < 45, a + '° must smooth the wall (got ' + d.toFixed(1) + ')');
}

// the switch sits at 45, which is only true if the value is in degrees
assert.ok(deviation(smooth(100)) > 50, '100° must finally merge the 90° rim');

// an untouched mesh keeps its attributes through the pass (uv, groups for GLB)
{
  const g = smooth(60);
  assert.ok(g.attributes.uv && g.attributes.position.count === g.attributes.normal.count);
}

console.log('ok  auto-smooth: hard below the angle, averaged above it, degrees in');
