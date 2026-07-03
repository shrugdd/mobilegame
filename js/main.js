/* Main: world setup, fixed-timestep loop, camera, canvas rendering, game state. */
(function () {
  'use strict';

  var Vec2 = planck.Vec2;
  var DT = 1 / 60;
  var HEAD_KILL_IMPULSE = 0.9; // normal impulse on the head that kills (head is ~0.13 kg)

  var canvas, ctx, dpr;
  var world, level, player;
  var state = 'menu'; // menu | playing | dead | won
  var elapsed = 0;
  var accumulator = 0;
  var lastTime = 0;
  var cam = { x: 0, y: -3, scale: 46 };
  var particles = [];
  var deathTimer = 0;
  var stillTime = 0; // how long a detached rider has been motionless
  var pendingKill = null; // set from contact callbacks, applied after step
  var pendingBlood = [];

  // ---------- Setup ----------

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    // Scale so ~13 world-meters fit vertically, clamped for phones/desktops
    cam.scale = Math.min(64, Math.max(30, canvas.height / dpr / 13)) ;
  }

  function resetWorld() {
    world = new planck.World({ gravity: new Vec2(0, 10) });
    level = Level.build(world);
    player = Player.create(world, level.spawn, Level.CAT);
    particles = [];
    pendingKill = null;
    pendingBlood = [];
    elapsed = 0;
    deathTimer = 0;
    stillTime = 0;
    cam.x = level.spawn.x;
    cam.y = level.spawn.y - 3;

    world.on('post-solve', onPostSolve);
    world.on('begin-contact', onBeginContact);
  }

  function fixtureInfo(f) {
    return f.getUserData() || {};
  }

  function onBeginContact(contact) {
    var a = fixtureInfo(contact.getFixtureA());
    var b = fixtureInfo(contact.getFixtureB());
    // Spikes kill the rider (the bike itself can survive them)
    var spike = a.kill ? a : (b.kill ? b : null);
    var rider = a.type === 'rider' ? a : (b.type === 'rider' ? b : null);
    if (spike && rider && player.alive) {
      var wm = contact.getWorldManifold();
      var pt = wm && wm.points && wm.points[0];
      pendingKill = { at: pt || player.torso.getPosition() };
    }
  }

  function onPostSolve(contact, impulse) {
    if (!player.alive) return;
    var fa = contact.getFixtureA(), fb = contact.getFixtureB();
    var a = fixtureInfo(fa), b = fixtureInfo(fb);
    var head = a.part === 'head' ? fa : (b.part === 'head' ? fb : null);
    if (!head) return;
    var maxImp = 0;
    for (var i = 0; i < impulse.normalImpulses.length; i++) {
      maxImp = Math.max(maxImp, impulse.normalImpulses[i]);
    }
    if (maxImp > HEAD_KILL_IMPULSE) {
      pendingKill = { at: head.getBody().getPosition() };
    } else if (maxImp > HEAD_KILL_IMPULSE * 0.45) {
      pendingBlood.push({ at: head.getBody().getPosition(), n: 6 });
    }
  }

  // ---------- Game state ----------

  function start() {
    resetWorld();
    state = 'playing';
    hideOverlay();
  }

  function die(at) {
    if (!player.alive) return;
    Player.kill(player, world);
    spawnBlood(at, 40);
    state = 'dead';
    deathTimer = 0;
  }

  function win() {
    state = 'won';
    showOverlay('LEVEL COMPLETE!', 'Time: ' + elapsed.toFixed(2) + 's', 'PLAY AGAIN');
  }

  // ---------- Simulation ----------

  function step() {
    var input = Input.state;

    if (input.restart) {
      input.restart = false;
      if (state !== 'menu') start();
      return;
    }

    if (state === 'playing' && input.eject && player.attached) {
      Player.detach(player, world, true);
    }

    Player.control(player, input);
    world.step(DT, 8, 3);

    // Deferred kill/blood from contact callbacks (can't mutate world inside them)
    if (pendingKill) {
      die(pendingKill.at);
      pendingKill = null;
    }
    while (pendingBlood.length) {
      var pb = pendingBlood.pop();
      spawnBlood(pb.at, pb.n);
    }

    // Breakable joints
    var snapped = Player.checkBreaks(player, world, 1 / DT);
    snapped.forEach(function (pt) { spawnBlood(pt, 8); });

    if (state === 'playing') {
      elapsed += DT;
      var pos = player.frame.getPosition();
      if (pos.x >= level.finishX && player.alive) win();
      if (pos.y > level.killY || player.torso.getPosition().y > level.killY) {
        die(player.torso.getPosition());
      }
      // A detached rider who slides across the line still wins;
      // one who comes to rest anywhere else is knocked out
      if (!player.attached && player.alive && state === 'playing') {
        var t = player.torso.getPosition();
        if (t.x >= level.finishX) {
          win();
        } else {
          var tv = player.torso.getLinearVelocity();
          if (Math.abs(tv.x) + Math.abs(tv.y) < 0.7) {
            stillTime += DT;
            if (stillTime > 2) {
              Player.kill(player, world);
              state = 'dead';
              deathTimer = 1.0; // overlay comes up quickly, they're just lying there
            }
          } else {
            stillTime = 0;
          }
        }
      }
    }

    if (state === 'dead') {
      deathTimer += DT;
      if (deathTimer > 1.4) {
        showOverlay('OUCH.', 'You made it ' + Math.max(0, player.torso.getPosition().x).toFixed(0) + 'm', 'RETRY');
        state = 'deadShown';
      }
    }

    updateParticles();
    updateCamera();
  }

  function updateCamera() {
    var target = player.attached ? player.frame : player.torso;
    var pos = target.getPosition();
    var vel = target.getLinearVelocity();
    var lookahead = Math.max(-2, Math.min(4, vel.x * 0.35));
    cam.x += (pos.x + lookahead - cam.x) * 0.08;
    cam.y += (pos.y - 2.2 - cam.y) * 0.06;
  }

  function spawnBlood(at, n) {
    for (var i = 0; i < n; i++) {
      particles.push({
        x: at.x, y: at.y,
        vx: (Math.random() - 0.5) * 7,
        vy: -Math.random() * 6 - 1,
        r: 0.03 + Math.random() * 0.07,
        life: 1.2 + Math.random() * 0.8
      });
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }

  function updateParticles() {
    for (var i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.vy += 10 * DT;
      pt.x += pt.vx * DT;
      pt.y += pt.vy * DT;
      pt.life -= DT;
      if (pt.life <= 0) particles.splice(i, 1);
    }
  }

  // ---------- Rendering ----------

  function w2sX(x) { return (x - cam.x) * cam.scale * dpr + canvas.width / 2; }
  function w2sY(y) { return (y - cam.y) * cam.scale * dpr + canvas.height / 2; }

  function render() {
    var W = canvas.width, H = canvas.height;
    var s = cam.scale * dpr;

    // Sky
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#6db9ef');
    sky.addColorStop(1, '#c9e8fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawBackground(W, H, s);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.translate(-cam.x, -cam.y);
    ctx.lineJoin = 'round';

    drawTerrain();
    drawSpikes();
    drawSigns();
    drawFinish();
    drawLogs();
    drawBike();
    drawRider();
    drawParticles();

    ctx.restore();
  }

  function drawBackground(W, H, s) {
    // Distant hills (parallax)
    ctx.fillStyle = '#a8d8a0';
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (var x = 0; x <= W; x += 8) {
      var wx = x / (s * 0.25) + cam.x * 0.25;
      var y = H * 0.72 + Math.sin(wx * 0.35) * H * 0.06 + Math.sin(wx * 0.13 + 2) * H * 0.09;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();

    // Clouds
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (var i = 0; i < 6; i++) {
      var cx = ((i * 431 - cam.x * s * 0.12) % (W + 300)) - 150;
      if (cx < -150) cx += W + 300;
      var cy = H * (0.12 + (i % 3) * 0.09);
      var r = H * 0.035 * (1 + (i % 3) * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 7);
      ctx.arc(cx + r * 1.1, cy + r * 0.25, r * 0.8, 0, 7);
      ctx.arc(cx - r * 1.1, cy + r * 0.3, r * 0.7, 0, 7);
      ctx.fill();
    }
  }

  function drawTerrain() {
    var pts = level.terrain;
    var deep = cam.y + 40;
    // Dirt
    ctx.fillStyle = '#8a5a34';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, deep);
    pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(pts[pts.length - 1].x, deep);
    ctx.closePath();
    ctx.fill();
    // Grass edge
    ctx.strokeStyle = '#4fa832';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke();
    ctx.strokeStyle = '#67c93f';
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    pts.forEach(function (p, i) { i ? ctx.lineTo(p.x, p.y - 0.05) : ctx.moveTo(p.x, p.y - 0.05); });
    ctx.stroke();
  }

  function drawSpikes() {
    ctx.fillStyle = '#b9bfc7';
    ctx.strokeStyle = '#5c636b';
    ctx.lineWidth = 0.04;
    level.spikes.forEach(function (sp) {
      ctx.beginPath();
      ctx.moveTo(sp.x0, sp.y);
      ctx.lineTo(sp.tipX, sp.tipY);
      ctx.lineTo(sp.x1, sp.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }

  function drawSigns() {
    ctx.textAlign = 'center';
    level.signs.forEach(function (sg) {
      ctx.fillStyle = '#8a5a34';
      ctx.fillRect(sg.x - 0.06, sg.y - 1.5, 0.12, 1.5);
      ctx.fillStyle = '#d9a05b';
      ctx.fillRect(sg.x - 0.9, sg.y - 2.15, 1.8, 0.7);
      ctx.strokeStyle = '#8a5a34';
      ctx.lineWidth = 0.05;
      ctx.strokeRect(sg.x - 0.9, sg.y - 2.15, 1.8, 0.7);
      ctx.fillStyle = '#5a3a1a';
      ctx.font = 'bold 0.34px sans-serif';
      ctx.fillText(sg.text, sg.x, sg.y - 1.7);
    });
  }

  function drawFinish() {
    var fx = level.finishX;
    var fy = groundYAt(fx);
    // Pole
    ctx.fillStyle = '#444';
    ctx.fillRect(fx - 0.07, fy - 4.2, 0.14, 4.2);
    // Checkered flag
    var fw = 1.7, fh = 1.0, n = 4, m = 3;
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < m; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(fx + 0.07 + i * fw / n, fy - 4.2 + j * fh / m, fw / n, fh / m);
      }
    }
    ctx.fillStyle = '#111';
    ctx.font = 'bold 0.5px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FINISH', fx, fy - 2.6);
  }

  function groundYAt(x) {
    var pts = level.terrain;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].x >= x && pts[i - 1].x <= x) {
        var t = (x - pts[i - 1].x) / Math.max(1e-6, pts[i].x - pts[i - 1].x);
        return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
      }
    }
    return 0;
  }

  function drawLogs() {
    level.logs.forEach(function (lg) {
      var pos = lg.body.getPosition();
      // chain
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.moveTo(lg.anchorX, lg.anchorY);
      var top = lg.body.getWorldPoint(new Vec2(0, -lg.len / 2 + 0.1));
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      // gallows arm
      ctx.strokeStyle = '#6b4423';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.moveTo(lg.anchorX - 2.2, groundYAt(lg.anchorX - 2.2));
      ctx.lineTo(lg.anchorX - 2.2, lg.anchorY - 0.3);
      ctx.lineTo(lg.anchorX, lg.anchorY);
      ctx.stroke();
      // log
      drawBox(lg.body, 0.28, lg.len / 2, '#8b5e34', '#6b4423');
    });
  }

  function drawBox(body, hw, hh, fill, stroke, localCx, localCy, localAngle) {
    var pos = body.getPosition();
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(body.getAngle());
    if (localCx || localCy) ctx.translate(localCx || 0, localCy || 0);
    if (localAngle) ctx.rotate(localAngle);
    ctx.fillStyle = fill;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.04;
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    }
    ctx.restore();
  }

  function drawBike() {
    var R = Player.WHEEL_R;
    [player.rearWheel, player.frontWheel].forEach(function (w) {
      var pos = w.getPosition(), a = w.getAngle();
      // tire
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, R, 0, 7);
      ctx.fillStyle = '#2b2b2b';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, R * 0.72, 0, 7);
      ctx.fillStyle = '#cfd6dd';
      ctx.fill();
      // spokes
      ctx.strokeStyle = '#8f979f';
      ctx.lineWidth = 0.035;
      for (var i = 0; i < 4; i++) {
        var ang = a + i * Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(pos.x - Math.cos(ang) * R * 0.72, pos.y - Math.sin(ang) * R * 0.72);
        ctx.lineTo(pos.x + Math.cos(ang) * R * 0.72, pos.y + Math.sin(ang) * R * 0.72);
        ctx.stroke();
      }
      // hub
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 0.07, 0, 7);
      ctx.fillStyle = '#444';
      ctx.fill();
    });

    // frame drawn as tubes between key points
    var f = player.frame;
    var rw = player.rearWheel.getPosition();
    var fw = player.frontWheel.getPosition();
    var seat = f.getWorldPoint(player.seatLocal);
    var bar = f.getWorldPoint(player.barLocal);
    var pedal = f.getWorldPoint(player.pedalLocal);
    var stemBase = f.getWorldPoint(new Vec2(0.62, -0.05));

    ctx.strokeStyle = '#d8342c';
    ctx.lineWidth = 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rw.x, rw.y); ctx.lineTo(seat.x, seat.y); // seat stay
    ctx.lineTo(pedal.x, pedal.y); // seat tube
    ctx.lineTo(rw.x, rw.y); // chain stay
    ctx.moveTo(seat.x, seat.y); ctx.lineTo(stemBase.x, stemBase.y); // top tube
    ctx.moveTo(pedal.x, pedal.y); ctx.lineTo(stemBase.x, stemBase.y); // down tube
    ctx.moveTo(fw.x, fw.y); ctx.lineTo(bar.x, bar.y); // fork + stem
    ctx.stroke();

    // seat + handlebar
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 0.09;
    ctx.beginPath();
    ctx.moveTo(seat.x - 0.16, seat.y);
    ctx.lineTo(seat.x + 0.16, seat.y);
    ctx.moveTo(bar.x - 0.12, bar.y);
    ctx.lineTo(bar.x + 0.1, bar.y - 0.04);
    ctx.stroke();

    // pedal crank
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 0.06;
    var ca = player.rearWheel.getAngle() * 0.5;
    ctx.beginPath();
    ctx.moveTo(pedal.x - Math.cos(ca) * 0.18, pedal.y - Math.sin(ca) * 0.18);
    ctx.lineTo(pedal.x + Math.cos(ca) * 0.18, pedal.y + Math.sin(ca) * 0.18);
    ctx.stroke();
  }

  function drawRider() {
    var SKIN = '#e8b88a', SHIRT = '#3a76c4', PANTS = '#37474f';

    drawLimbBody(player.thigh, 0.075, PANTS);
    drawLimbBody(player.shin, 0.06, PANTS);
    drawLimbBody(player.torso, 0.15, SHIRT);
    drawLimbBody(player.upperArm, 0.055, SHIRT);
    drawLimbBody(player.foreArm, 0.05, SKIN);

    // head + helmet
    var hp = player.head.getPosition();
    var ha = player.head.getAngle();
    ctx.save();
    ctx.translate(hp.x, hp.y);
    ctx.rotate(ha);
    ctx.beginPath();
    ctx.arc(0, 0, 0.17, 0, 7);
    ctx.fillStyle = SKIN;
    ctx.fill();
    // helmet
    ctx.beginPath();
    ctx.arc(0, -0.03, 0.185, Math.PI * 0.95, Math.PI * 2.05);
    ctx.fillStyle = '#e33';
    ctx.fill();
    // eye
    ctx.beginPath();
    ctx.arc(0.08, 0.02, 0.022, 0, 7);
    ctx.fillStyle = '#222';
    ctx.fill();
    ctx.restore();
  }

  function drawLimbBody(body, hw, color) {
    var f = body.getFixtureList();
    var shape = f.getShape();
    var hh = 0.3;
    // Box2D boxes store their verts; recover half-height from them
    if (shape.m_vertices && shape.m_vertices.length === 4) {
      hh = Math.abs(shape.m_vertices[0].y);
      hw = Math.abs(shape.m_vertices[0].x);
    }
    var pos = body.getPosition();
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(body.getAngle());
    ctx.fillStyle = color;
    roundRect(-hw, -hh, hw * 2, hh * 2, Math.min(hw, 0.06));
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawParticles() {
    ctx.fillStyle = '#c81e1e';
    particles.forEach(function (pt) {
      ctx.globalAlpha = Math.min(1, pt.life);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, 7);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------- Overlay / HUD ----------

  var overlayEl, overlayTitle, overlaySub, overlayBtn, timerEl;

  function showOverlay(title, sub, btnText) {
    overlayTitle.textContent = title;
    overlaySub.textContent = sub;
    overlayBtn.textContent = btnText;
    overlayEl.classList.remove('hidden');
  }
  function hideOverlay() {
    overlayEl.classList.add('hidden');
  }

  // ---------- Main loop ----------

  function frame(t) {
    requestAnimationFrame(frame);
    if (!lastTime) lastTime = t;
    var dt = Math.min(0.1, (t - lastTime) / 1000);
    lastTime = t;

    if (state !== 'menu') {
      accumulator += dt;
      var steps = 0;
      while (accumulator >= DT && steps < 4) {
        step();
        accumulator -= DT;
        steps++;
      }
      if (steps === 4) accumulator = 0; // don't spiral on slow devices
      timerEl.textContent = elapsed.toFixed(2);
      render();
    } else {
      render();
    }
  }

  function init() {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    overlayEl = document.getElementById('overlay');
    overlayTitle = document.getElementById('overlay-title');
    overlaySub = document.getElementById('overlay-sub');
    overlayBtn = document.getElementById('overlay-btn');
    timerEl = document.getElementById('timer');

    window.addEventListener('resize', resize);
    resize();

    Input.init();
    resetWorld();

    overlayBtn.addEventListener('click', start);
    document.getElementById('btn-restart').addEventListener('click', function () {
      if (state !== 'menu') start();
    });

    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
