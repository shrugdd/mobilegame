/* Level 1: "Sunny Hills Run" — an original opening level in the classic
 * side-scrolling obstacle-course style: rolling grass hills, a spike pit,
 * a big chasm jump, a swinging log, then the finish line.
 *
 * Coordinates are in meters, y grows DOWN (matches canvas), gravity is +y.
 */
(function () {
  'use strict';

  var Vec2 = planck.Vec2;

  // Collision categories
  var CAT = {
    WORLD: 0x0001,
    BIKE: 0x0002,
    RIDER: 0x0004,
    HAZARD: 0x0008
  };

  function buildLevel(world) {
    var level = {
      spawn: new Vec2(0, -1.0), // ground height at spawn is y=0
      finishX: 88,
      killY: 30, // fell off the world
      terrain: [], // polyline for rendering
      spikes: [], // triangles for rendering [{x,y}...]
      logs: [], // dynamic swinging logs
      signs: [], // decorative signs {x, y, text}
      cat: CAT
    };

    var pts = [];
    var x = -10;
    var y = 0;

    function to(nx, ny) {
      x = nx;
      y = ny;
      pts.push({ x: x, y: y });
    }
    function flat(len) { to(x + len, y); }
    // Smooth hill: half-cosine rise/fall over len meters to dy
    function slope(len, dy, steps) {
      var n = steps || Math.max(4, Math.round(len * 1.5));
      var x0 = x, y0 = y;
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        var s = (1 - Math.cos(Math.PI * t)) / 2; // ease in/out
        pts.push({ x: x0 + len * t, y: y0 + dy * s });
      }
      x = x0 + len;
      y = y0 + dy;
    }
    // Launch ramp: quadratic ease-in, so the lip keeps its slope and you get
    // real launch angle off the end (a cosine hill launches you flat)
    function ramp(len, dy, steps) {
      var n = steps || Math.max(4, Math.round(len * 1.5));
      var x0 = x, y0 = y;
      for (var i = 1; i <= n; i++) {
        var t = i / n;
        pts.push({ x: x0 + len * t, y: y0 + dy * t * t });
      }
      x = x0 + len;
      y = y0 + dy;
    }

    // --- Terrain profile ---
    to(-10, -7); // left wall so you can't reverse off the map
    to(-10, 0);
    flat(18); // start pad, spawn at x=0
    slope(5, -1.4); // first hill up
    slope(5, 1.4); //   ...and down
    slope(4, -1.8); // second, steeper hill
    slope(4, 1.8);
    flat(4); // x = 30, breather before spike pit

    // Spike pit: small launch lip, drop, spikes along the bottom, and a
    // climbable ramp out the far side for anyone who falls in
    ramp(2.2, -0.7); // launch lip
    var pitTop = y;
    to(x, pitTop + 2.6); // sheer drop
    var pitStart = x;
    var pitFloor = y;
    flat(4.6);
    var pitEnd = x;
    slope(7, -pitFloor); // gentle ramp back up to grade
    addSpikeRow(level, pitStart + 0.3, pitEnd - 0.3, pitFloor);
    level.signs.push({ x: pitStart - 6, y: 0, text: 'SPIKES!' });

    flat(5);
    ramp(6, -2.2); // launch ramp up
    var jumpLipX = x, jumpLipY = y;
    to(x, y + 6.5); // chasm wall down
    var chasmStart = x;
    flat(8); // chasm floor
    var chasmEnd = x;
    to(x, jumpLipY + 1.0); // far wall up (landing slightly lower than lip)
    addSpikeRow(level, chasmStart + 0.5, chasmEnd - 0.5, jumpLipY + 6.5);
    level.signs.push({ x: jumpLipX - 7, y: jumpLipY + 2.2, text: 'JUMP →' });

    slope(6, 1.2); // gentle downhill after landing
    flat(6); // swinging log zone
    var logX = x - 3;
    addSwingLog(world, level, logX, y - 4.6, 3.2);

    slope(4, -1.0); // small final hill
    slope(4, 1.0);
    flat(10); // finish straight (finishX = 97 is in here)
    to(x, y - 6); // end wall so you can't ride off the map
    level.terrain = pts;

    // Static terrain body (one chain shape)
    var ground = world.createBody({ type: 'static', userData: { type: 'ground' } });
    var verts = pts.map(function (p) { return new Vec2(p.x, p.y); });
    ground.createFixture(new planck.Chain(verts, false), {
      density: 0,
      friction: 0.92,
      filterCategoryBits: CAT.WORLD,
      userData: { type: 'ground' }
    });

    return level;
  }

  function addSpikeRow(level, x0, x1, groundY) {
    var w = 0.42, h = 0.75;
    var n = Math.floor((x1 - x0) / w);
    level._pendingSpikes = level._pendingSpikes || [];
    for (var i = 0; i < n; i++) {
      var sx = x0 + i * w;
      level._pendingSpikes.push([
        new Vec2(sx, groundY),
        new Vec2(sx + w, groundY),
        new Vec2(sx + w / 2, groundY - h)
      ]);
      level.spikes.push({ x0: sx, x1: sx + w, tipX: sx + w / 2, y: groundY, tipY: groundY - h });
    }
  }

  // Create the queued spike fixtures on one static body (called by buildLevel caller)
  function finalizeSpikes(world, level) {
    if (!level._pendingSpikes) return;
    var body = world.createBody({ type: 'static', userData: { type: 'spikes' } });
    level._pendingSpikes.forEach(function (tri) {
      body.createFixture(new planck.Polygon(tri), {
        density: 0,
        friction: 0.5,
        filterCategoryBits: CAT.HAZARD,
        userData: { type: 'spike', kill: true }
      });
    });
    delete level._pendingSpikes;
  }

  function addSwingLog(world, level, x, anchorY, length) {
    var log = world.createBody({
      type: 'dynamic',
      position: new planck.Vec2(x, anchorY + length / 2 + 0.4),
      angularDamping: 0.15,
      userData: { type: 'log' }
    });
    log.createFixture(new planck.Box(0.28, length / 2), {
      density: 1.6,
      friction: 0.6,
      restitution: 0.1,
      filterCategoryBits: CAT.WORLD,
      userData: { type: 'log' }
    });

    var anchor = world.createBody({ position: new planck.Vec2(x, anchorY) });
    world.createJoint(new planck.RevoluteJoint({}, anchor, log, new planck.Vec2(x, anchorY + 0.4)));

    // Start it swinging
    log.setAngularVelocity(2.2);

    level.logs.push({ body: log, anchorX: x, anchorY: anchorY, len: length });
  }

  function build(world) {
    var level = buildLevel(world);
    finalizeSpikes(world, level);
    return level;
  }

  var api = { build: build, CAT: CAT };
  if (typeof window !== 'undefined') window.Level = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
