/* Player: a bicycle (two motor-driven wheels + frame) with a jointed ragdoll
 * rider attached by breakable joints at the seat, hands and feet.
 * y grows DOWN, so "up" is -y and positive wheel spin rolls to the right.
 */
(function () {
  'use strict';

  var Vec2 = planck.Vec2;

  var WHEEL_R = 0.42;
  var DRIVE_SPEED = 30; // rad/s target wheel spin when holding gas (~12.6 m/s)
  var DRIVE_ACCEL = 220; // rad/s^2 wheel spin-up (drive ends up traction-limited)
  var REVERSE_SPEED = -13;
  var BRAKE_RATE = 12; // fraction/s of wheel spin removed while braking
  var LEAN_TORQUE = 42;
  var LEAN_MAX_SPIN = 4.2; // rad/s cap on lean rotation

  // Reaction force above which an attachment joint snaps (Newtons)
  var SEAT_BREAK_FORCE = 2600;
  var HAND_BREAK_FORCE = 1500;
  var FOOT_BREAK_FORCE = 900;

  function create(world, spawn, cat) {
    var sx = spawn.x, sy = spawn.y; // sy = ground level; bodies sit above it (-y)

    var p = {
      alive: true,
      attached: true,
      brokenJoints: [],
      cat: cat
    };

    var bikeFilter = {
      filterCategoryBits: cat.BIKE,
      filterMaskBits: cat.WORLD | cat.HAZARD,
      filterGroupIndex: -1
    };
    var riderFilter = {
      filterCategoryBits: cat.RIDER,
      filterMaskBits: cat.WORLD | cat.HAZARD,
      filterGroupIndex: -1
    };

    function dyn(x, y, angle, opts) {
      return world.createBody(Object.assign({
        type: 'dynamic',
        position: new Vec2(x, y),
        angle: angle || 0,
        linearDamping: 0.02,
        angularDamping: 0.06,
        bullet: false
      }, opts || {}));
    }

    // ---------- Bicycle ----------
    var frameY = sy - 0.98;
    p.frame = dyn(sx, frameY, 0, { angularDamping: 0.4 });
    // main beam between the wheels
    p.frame.createFixture(new planck.Box(0.72, 0.09), Object.assign({ density: 5.5, friction: 0.3, userData: { type: 'bike' } }, bikeFilter));
    // seat post + seat (rear-top) and handlebar stem (front-top)
    p.frame.createFixture(new planck.Box(0.05, 0.22, new Vec2(-0.42, -0.26), 0.25), Object.assign({ density: 1.2, friction: 0.3, userData: { type: 'bike' } }, bikeFilter));
    p.frame.createFixture(new planck.Box(0.05, 0.24, new Vec2(0.62, -0.28), -0.2), Object.assign({ density: 1.2, friction: 0.3, userData: { type: 'bike' } }, bikeFilter));

    // local attachment points on the frame
    p.seatLocal = new Vec2(-0.44, -0.50);
    p.barLocal = new Vec2(0.66, -0.54);
    p.pedalLocal = new Vec2(0.02, 0.06);

    function wheel(x) {
      var w = dyn(x, sy - WHEEL_R, 0, { bullet: true });
      w.createFixture(new planck.Circle(WHEEL_R), Object.assign({
        density: 1.3,
        friction: 1.6,
        restitution: 0.12,
        userData: { type: 'wheel' }
      }, bikeFilter));
      return w;
    }
    p.rearWheel = wheel(sx - 0.78);
    p.frontWheel = wheel(sx + 0.78);

    world.createJoint(new planck.RevoluteJoint({}, p.frame, p.rearWheel, p.rearWheel.getPosition()));
    world.createJoint(new planck.RevoluteJoint({}, p.frame, p.frontWheel, p.frontWheel.getPosition()));

    // ---------- Rider ragdoll ----------
    function limb(x, y, hw, hh, angle, density, part) {
      var b = dyn(x, y, angle);
      b.createFixture(new planck.Box(hw, hh), Object.assign({
        density: density,
        friction: 0.4,
        restitution: 0.05,
        userData: { type: 'rider', part: part }
      }, riderFilter));
      return b;
    }

    var seatW = { x: sx + p.seatLocal.x, y: frameY + p.seatLocal.y };
    var barW = { x: sx + p.barLocal.x, y: frameY + p.barLocal.y };
    var pedalW = { x: sx + p.pedalLocal.x, y: frameY + p.pedalLocal.y };

    // Torso leans forward from hips (at the seat) toward the handlebars
    var hip = new Vec2(seatW.x, seatW.y - 0.06);
    var torsoLen = 0.62;
    var torsoAngle = 0.42; // lean forward
    var torsoC = new Vec2(hip.x + Math.sin(torsoAngle) * torsoLen / 2, hip.y - Math.cos(torsoAngle) * torsoLen / 2);
    p.torso = limb(torsoC.x, torsoC.y, 0.15, torsoLen / 2, torsoAngle, 1.1, 'torso');

    var shoulder = new Vec2(hip.x + Math.sin(torsoAngle) * torsoLen * 0.92, hip.y - Math.cos(torsoAngle) * torsoLen * 0.92);

    // Head
    var headR = 0.17;
    var headC = new Vec2(shoulder.x + Math.sin(torsoAngle) * 0.16, shoulder.y - Math.cos(torsoAngle) * 0.16 - headR * 0.9);
    p.head = dyn(headC.x, headC.y, 0);
    p.head.createFixture(new planck.Circle(headR), Object.assign({
      density: 1.4, friction: 0.4, restitution: 0.1,
      userData: { type: 'rider', part: 'head' }
    }, riderFilter));

    // Arm: shoulder -> elbow -> handlebar
    var elbow = new Vec2((shoulder.x + barW.x) / 2, (shoulder.y + barW.y) / 2 + 0.10);
    p.upperArm = limbBetween(shoulder, elbow, 0.055, 0.9, 'arm');
    p.foreArm = limbBetween(elbow, barW, 0.05, 0.8, 'arm');

    // Leg: hip -> knee -> pedal
    var knee = new Vec2((hip.x + pedalW.x) / 2 + 0.22, (hip.y + pedalW.y) / 2 - 0.05);
    p.thigh = limbBetween(hip, knee, 0.075, 1.2, 'leg');
    p.shin = limbBetween(knee, pedalW, 0.06, 1.0, 'leg');

    function limbBetween(a, b, hw, density, part) {
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      var angle = Math.atan2(dy, dx) - Math.PI / 2; // box's long axis is y
      return limb((a.x + b.x) / 2, (a.y + b.y) / 2, hw, len / 2, angle, density, part);
    }

    // ---------- Joints ----------
    function rev(bodyA, bodyB, anchor, lo, hi) {
      var def = {};
      if (lo !== undefined) {
        def.enableLimit = true;
        def.lowerAngle = lo;
        def.upperAngle = hi;
      }
      return world.createJoint(new planck.RevoluteJoint(def, bodyA, bodyB, new Vec2(anchor.x, anchor.y)));
    }

    var neck = new Vec2(shoulder.x + Math.sin(torsoAngle) * 0.12, shoulder.y - Math.cos(torsoAngle) * 0.12);
    p.neckJoint = rev(p.torso, p.head, neck, -0.5, 0.5);
    p.shoulderJoint = rev(p.torso, p.upperArm, shoulder, -1.6, 1.6);
    p.elbowJoint = rev(p.upperArm, p.foreArm, elbow, -1.8, 1.8);
    p.hipJoint = rev(p.torso, p.thigh, hip, -1.2, 1.5);
    p.kneeJoint = rev(p.thigh, p.shin, knee, -2.0, 0.2);

    // Breakable attachments to the bike
    p.seatJoint = rev(p.frame, p.torso, hip);
    p.seatJoint._breakForce = SEAT_BREAK_FORCE;
    p.handJoint = rev(p.frame, p.foreArm, barW);
    p.handJoint._breakForce = HAND_BREAK_FORCE;
    p.footJoint = rev(p.frame, p.shin, pedalW);
    p.footJoint._breakForce = FOOT_BREAK_FORCE;
    p.attachJoints = [p.seatJoint, p.handJoint, p.footJoint];

    p.bodies = [p.frame, p.rearWheel, p.frontWheel, p.torso, p.head, p.upperArm, p.foreArm, p.thigh, p.shin];
    return p;
  }

  /* Apply one physics-tick worth of control input (dt = physics timestep).
   * Drive works by steering wheel spin directly: traction is still limited by
   * tire friction, but there's no motor reaction torque flipping the frame. */
  function control(p, input, dt) {
    dt = dt || 1 / 60;

    if (p.attached && p.alive) {
      var rearSpin = p.rearWheel.getAngularVelocity();
      if (input.gas) {
        p.rearWheel.setAngularVelocity(approach(rearSpin, DRIVE_SPEED, DRIVE_ACCEL * dt));
      } else if (input.brake) {
        var vx = p.frame.getLinearVelocity().x;
        if (vx > 1.2 || rearSpin > 3) {
          // moving forward: bleed spin off both wheels
          var k = Math.max(0, 1 - BRAKE_RATE * dt);
          p.rearWheel.setAngularVelocity(rearSpin * k);
          p.frontWheel.setAngularVelocity(p.frontWheel.getAngularVelocity() * k);
        } else {
          // slow/stopped: reverse
          p.rearWheel.setAngularVelocity(approach(rearSpin, REVERSE_SPEED, DRIVE_ACCEL * 0.7 * dt));
        }
      }

      var spin = p.frame.getAngularVelocity();
      if (input.leanBack && spin > -LEAN_MAX_SPIN) p.frame.applyTorque(-LEAN_TORQUE);
      if (input.leanFwd && spin < LEAN_MAX_SPIN) p.frame.applyTorque(LEAN_TORQUE);

      // Keep the ragdoll's posture a bit stiff while riding
      p.torso.applyTorque(-p.torso.getAngularVelocity() * 2.0);
    }
  }

  function approach(v, target, maxDelta) {
    if (v < target) return Math.min(target, v + maxDelta);
    return Math.max(target, v - maxDelta);
  }

  /* Check breakable joints; returns list of world points where joints snapped. */
  function checkBreaks(p, world, invDt) {
    var snapped = [];
    for (var i = p.attachJoints.length - 1; i >= 0; i--) {
      var j = p.attachJoints[i];
      var f = j.getReactionForce(invDt);
      var mag = Math.sqrt(f.x * f.x + f.y * f.y);
      if (mag > j._breakForce) {
        snapped.push(j.getAnchorA());
        world.destroyJoint(j);
        p.attachJoints.splice(i, 1);
      }
    }
    if (p.attachJoints.length === 0) p.attached = false;
    return snapped;
  }

  /* Detach the rider from the bike entirely (eject / death). */
  function detach(p, world, hop) {
    if (!p.attached) return;
    p.attachJoints.forEach(function (j) { world.destroyJoint(j); });
    p.attachJoints = [];
    p.attached = false;
    if (hop) {
      var v = p.frame.getLinearVelocity();
      p.torso.applyLinearImpulse(new Vec2(v.x * 0.3 - 1.5, -14), p.torso.getWorldCenter(), true);
    }
  }

  function kill(p, world) {
    if (!p.alive) return;
    p.alive = false;
    detach(p, world, false);
  }

  var api = {
    create: create,
    control: control,
    checkBreaks: checkBreaks,
    detach: detach,
    kill: kill,
    WHEEL_R: WHEEL_R
  };
  if (typeof window !== 'undefined') window.Player = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
