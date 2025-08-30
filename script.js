// script.js
// Dragon Cursor — Ultimate Pro (lines-only)
// Features:
// - Line-only dragon with depth (3D illusion), layered spine, ribs, spikes, 4 wings
// - Stalking behavior: keeps distance, trails, slow motion, cinematic
// - When you "give chance" (linger near head) it lunges and tries to eat
// - Left-click -> heavy multi-layered flame (line-based) with additive glow
// - Motion trails via persistent trail canvas
// - S to save screenshot, F11 for fullscreen in browser
// Tweak the config below for more/less intensity.

(() => {
  // ---------- CONFIG (tweak these) ----------
  const SEGMENTS = 76;           // longer = heavier visuals
  const SEG_SPACING = 20;        // distance between joints
  const HEAD_EASE = 0.06;        // slow, cinematic head movement
  const WOBBLE_AMP = 0.14;       // organic wobble
  const WOBBLE_SPEED = 0.9;
  const TRAIL_OFFSET = 220;      // distance the dragon keeps from cursor (stalk)
  const LEG_EVERY = 2;           // ribs/spikes frequency
  const LEG_LENGTH = 42;
  const WING_RIBS = 14;          // ribs per wing
  const PARTICLE_RATE = 24;      // flame particles per frame when holding fire
  const MAX_PARTICLES = 1200;    // cap particles
  const MAX_EAT_PARTICLES = 300;
  const FRAME_FADE_ALPHA = 0.11; // trail persistence (lower = longer trails)

  // bite settings
  const BITE_DISTANCE = 130;         // proximity to consider lunge
  const BITE_HOLD_TIME = 0.55;       // seconds user must linger to "give chance"
  const BITE_LUNGE_DURATION = 0.5;   // lunge animation time
  const BITE_COOLDOWN = 1.2;         // seconds after bite before next

  // colors (line only)
  const COLOR_WHITE = "rgba(255,255,255,1)";
  const COLOR_LIGHT = "rgba(220,220,220,0.98)";
  const COLOR_DIM = "rgba(110,110,110,0.9)";
  const FIRE_CORE = "rgba(255,255,220,1)";

  // ---------- Canvas setup ----------
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d", { alpha: true });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(innerWidth * dpr);
    canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // recreate trail canvas on resize
    trailCanvas.width = canvas.width;
    trailCanvas.height = canvas.height;
    trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // trail canvas for motion persistence
  const trailCanvas = document.createElement("canvas");
  const trailCtx = trailCanvas.getContext("2d", { alpha: true });

  // ---------- State ----------
  let body = [];
  for (let i = 0; i < SEGMENTS; i++) {
    body.push({ x: innerWidth / 2, y: innerHeight / 2, a: 0, wig: 0, z: 1 - i / SEGMENTS });
  }

  let pointer = { x: innerWidth / 2, y: innerHeight / 2, down: false };
  let prevPointer = { x: pointer.x, y: pointer.y };
  let pointerVel = 0;
  let particles = [];
  let eatParticles = [];
  let tclock = 0;
  let lastBiteTime = -10;
  let lingerStart = null;
  let biting = { active: false, phase: "idle", t: 0 }; // phases: lunge, snap, recover

  // pointer handlers
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY;
  });
  window.addEventListener("pointerdown", (e) => { if (e.button === 0) pointer.down = true; });
  window.addEventListener("pointerup", (e) => { if (e.button === 0) pointer.down = false; });

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (e.key === "s" || e.key === "S") {
      // save screenshot (composite current canvas + trail)
      const copy = document.createElement("canvas");
      copy.width = canvas.width; copy.height = canvas.height;
      const copyCtx = copy.getContext("2d");
      copyCtx.drawImage(trailCanvas, 0, 0);
      copyCtx.drawImage(canvas, 0, 0);
      const link = document.createElement("a");
      link.href = copy.toDataURL("image/png");
      link.download = "dragon_final.png";
      link.click();
    }
  });

  // small helpers
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  function line(ax, ay, bx, by, w, color) {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // initialize sizes
  resize();

  // seed body in gentle curve
  (function seed() {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    for (let i = 0; i < body.length; i++) {
      body[i].x = cx - i * SEG_SPACING * 0.5;
      body[i].y = cy + Math.sin(i * 0.18) * 10;
      body[i].a = 0;
      body[i].z = 1 - i / (body.length * 1.2);
    }
  })();

  // ---------- Particles (flame & eat) ----------
  function spawnFlameBurst(intensity = 1.0) {
    // intensity multiplies particle rate (left click heavy)
    const h = body[0];
    const ex = h.x + Math.cos(h.a) * 56;
    const ey = h.y + Math.sin(h.a) * 56;
    const rate = Math.floor(PARTICLE_RATE * intensity);
    for (let i = 0; i < rate; i++) {
      if (particles.length >= MAX_PARTICLES) break;
      const ang = h.a + rnd(-0.65, 0.65);
      const speed = rnd(260, 1400) * (0.6 + intensity * 1.4);
      particles.push({
        x: ex, y: ey,
        vx: Math.cos(ang) * speed + rnd(-120, 120),
        vy: Math.sin(ang) * speed + rnd(-120, 120),
        life: rnd(0.25, 0.8),
        t: 0,
        thickness: rnd(0.6, 4.0) * (0.6 + intensity),
        alpha: rnd(0.6, 1.0)
      });
    }
  }
  function spawnEatBurst(count = 48) {
    const h = body[0];
    const ex = h.x + Math.cos(h.a) * 48;
    const ey = h.y + Math.sin(h.a) * 48;
    for (let i = 0; i < count; i++) {
      if (eatParticles.length >= MAX_EAT_PARTICLES) break;
      const ang = h.a + rnd(-1.8, 1.8);
      const speed = rnd(120, 540);
      eatParticles.push({
        x: ex, y: ey,
        vx: Math.cos(ang) * speed + rnd(-80, 80),
        vy: Math.sin(ang) * speed + rnd(-80, 80),
        life: rnd(0.28, 0.9), t: 0,
        thickness: rnd(0.6, 3.4)
      });
    }
  }
  function updateParticles(dt) {
    particles = particles.filter(p => {
      p.t += dt;
      if (p.t < p.life) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.986; p.vy *= 0.986;
        return true;
      }
      return false;
    });
    eatParticles = eatParticles.filter(p => {
      p.t += dt;
      if (p.t < p.life) {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.96; p.vy *= 0.96;
        return true;
      }
      return false;
    });
  }

  // ---------- BITE LOGIC ----------
  function pointerSpeed() {
    const dx = pointer.x - prevPointer.x;
    const dy = pointer.y - prevPointer.y;
    return Math.hypot(dx, dy);
  }

  function checkLinger(dt) {
    const head = body[0];
    const d = dist(head.x, head.y, pointer.x, pointer.y);
    const speed = pointerSpeed();
    // if pointer is near and slow, start/continue linger timer
    if (d < BITE_DISTANCE && speed < 3) {
      if (lingerStart === null) lingerStart = 0;
      lingerStart += dt;
    } else {
      lingerStart = null;
    }
    // if linger exceeded and cooldown passed -> start bite
    if (lingerStart !== null && lingerStart > BITE_HOLD_TIME && !biting.active && (performance.now() - lastBiteTime) / 1000 > BITE_COOLDOWN) {
      // start bite immediately
      biting.active = true; biting.phase = "lunge"; biting.t = 0;
      lastBiteTime = performance.now();
    }
  }

  // ---------- BODY KINEMATICS ----------
  function updateBody(dt) {
    tclock += dt;
    // update pointer velocity estimate
    pointerVel = pointerSpeed();
    prevPointer.x = pointer.x; prevPointer.y = pointer.y;

    const head = body[0];
    const dx = pointer.x - head.x;
    const dy = pointer.y - head.y;
    const baseAng = Math.atan2(dy, dx);
    const wob = Math.sin(tclock * WOBBLE_SPEED) * WOBBLE_AMP;

    // BITE phases control head target
    if (biting.active) {
      biting.t += dt;
      if (biting.phase === "lunge") {
        // aggressive approach: target closer than offset, faster interpolation
        const progress = clamp(biting.t / BITE_LUNGE_DURATION, 0, 1);
        const intensity = 0.9 + progress * 1.8; // increases over lunge
        const targetDist = TRAIL_OFFSET * (0.2); // lunge to near/over cursor
        const tx = pointer.x - Math.cos(baseAng) * targetDist;
        const ty = pointer.y - Math.sin(baseAng) * targetDist;
        head.x = lerp(head.x, tx, clamp(0.28 + progress * 0.6, 0.28, 0.95));
        head.y = lerp(head.y, ty, clamp(0.28 + progress * 0.6, 0.28, 0.95));
        head.a = Math.atan2(pointer.y - head.y, pointer.x - head.x) + wob * 2;
        // if lunge done -> snap
        if (biting.t > BITE_LUNGE_DURATION) {
          biting.phase = "snap"; biting.t = 0;
          // spawn eat particles
          spawnEatBurst(64);
        }
      } else if (biting.phase === "snap") {
        // violent snap jitter for a short moment
        head.x += Math.cos(head.a) * Math.sin(tclock * 200) * 4;
        head.y += Math.sin(head.a) * Math.sin(tclock * 200) * 4;
        head.a += Math.sin(tclock * 400) * 0.06;
        if (biting.t > 0.18) {
          biting.phase = "recover"; biting.t = 0;
        }
      } else if (biting.phase === "recover") {
        // slow back to stalking form
        const tx = pointer.x - Math.cos(baseAng) * TRAIL_OFFSET;
        const ty = pointer.y - Math.sin(baseAng) * TRAIL_OFFSET;
        head.x = lerp(head.x, tx, 0.18);
        head.y = lerp(head.y, ty, 0.18);
        head.a = Math.atan2(pointer.y - head.y, pointer.x - head.x) + wob;
        if (biting.t > 0.6) {
          biting.active = false; biting.phase = "idle"; biting.t = 0;
          lingerStart = null;
        }
      }
    } else {
      // stalking behavior: target is a point behind pointer by TRAIL_OFFSET
      const tx = pointer.x - Math.cos(baseAng) * TRAIL_OFFSET;
      const ty = pointer.y - Math.sin(baseAng) * TRAIL_OFFSET;
      head.x = lerp(head.x, tx, HEAD_EASE);
      head.y = lerp(head.y, ty, HEAD_EASE);
      head.a = Math.atan2(pointer.y - head.y, pointer.x - head.x) + wob;
    }

    // Update chain: segments try to be SEG_SPACING behind previous
    for (let i = 1; i < body.length; i++) {
      const prev = body[i - 1], cur = body[i];
      const vx = prev.x - cur.x, vy = prev.y - cur.y;
      const ang = Math.atan2(vy, vx);
      const targetX = prev.x - Math.cos(ang) * SEG_SPACING;
      const targetY = prev.y - Math.sin(ang) * SEG_SPACING;
      const compress = biting.active && i < 8 ? 0.6 : 0.78;
      cur.x = lerp(cur.x, targetX, compress);
      cur.y = lerp(cur.y, targetY, compress);
      cur.a = Math.atan2(prev.y - cur.y, prev.x - cur.x);
      // depth z for 3D effect (1 near head -> 0 tail)
      cur.z = 1 - i / (body.length + 6);
      cur.wig = Math.sin(tclock * (1.5 + i * 0.02) + i * 0.32) * (0.6 * (1 - i / body.length));
    }

    // chance to auto-start bitting if pointer lingers
    checkLingerAndBite();
  }

  function checkLingerAndBite() {
    // track linger: if pointer near and slow, start count
    const head = body[0];
    const d = dist(head.x, head.y, pointer.x, pointer.y);
    const speed = pointerSpeed();
    if (d < BITE_DISTANCE && speed < 2.5 && !biting.active && (performance.now() - lastBiteTime) / 1000 > BITE_COOLDOWN) {
      if (lingerStart === null) lingerStart = 0;
      lingerStart += 1 / 60; // tick approx per frame (safe)
      if (lingerStart > BITE_HOLD_TIME * 0.8) {
        // user "gives chance" — start immediate bite
        biting.active = true; biting.phase = "lunge"; biting.t = 0;
        lastBiteTime = performance.now();
      }
    } else {
      lingerStart = null;
    }
  }

  // ---------- DRAWING (line-only with 3D illusion) ----------
  function render() {
    // small translucent clear on visible canvas; trail is kept on trailCanvas
    ctx.clearRect(0, 0, innerWidth, innerHeight);

    // fade trail slightly for persistence
    trailCtx.fillStyle = `rgba(0,0,0,${FRAME_FADE_ALPHA})`;
    trailCtx.fillRect(0, 0, innerWidth, innerHeight);

    // draw body to trail first (for trailing motion)
    drawBodyToTrail();

    // then draw trail onto main canvas
    ctx.drawImage(trailCanvas, 0, 0);

    // draw dynamic particles (flames / eat)
    drawParticles(ctx);

    // overlay final head and top lines for crispness
    drawHeadAndDetails(ctx);
  }

  function drawBodyToTrail() {
    // draw from tail to head so head overlays last
    for (let i = body.length - 1; i >= 1; i--) {
      const a = body[i], b = body[i - 1];
      // compute depth-influenced width and alpha
      const z = a.z || 0.4;
      const width = lerp(12.5, 1.2, 1 - z) * (1.0 + z * 0.18);
      const color = i < 6 ? COLOR_WHITE : (i < 18 ? COLOR_LIGHT : COLOR_DIM);
      // slight offset to simulate shadow beneath body (3D)
      const shadowOffset = 6 * (1 - z);
      // main spine line
      trailCtx.lineCap = "round";
      trailCtx.lineWidth = Math.max(1.0, width);
      trailCtx.strokeStyle = color;
      trailCtx.beginPath();
      trailCtx.moveTo(a.x + a.wig * 2, a.y + a.wig * 2);
      trailCtx.lineTo(b.x + b.wig * 2, b.y + b.wig * 2);
      trailCtx.stroke();
      // highlight line for 3D ridge
      trailCtx.lineWidth = Math.max(0.6, width * 0.35);
      trailCtx.strokeStyle = (i < 9) ? COLOR_WHITE : COLOR_LIGHT;
      trailCtx.beginPath();
      trailCtx.moveTo(a.x - a.wig * 1, a.y - a.wig * 1);
      trailCtx.lineTo(b.x - b.wig * 1, b.y - b.wig * 1);
      trailCtx.stroke();
      // shadow (thin, offset)
      trailCtx.lineWidth = Math.max(0.6, width * 0.28);
      trailCtx.strokeStyle = `rgba(0,0,0,${0.6 * (1 - z)})`;
      trailCtx.beginPath();
      trailCtx.moveTo(a.x + shadowOffset, a.y + shadowOffset);
      trailCtx.lineTo(b.x + shadowOffset, b.y + shadowOffset);
      trailCtx.stroke();

      // ribs / spikes
      if (i % LEG_EVERY === 0 && i > 3 && i < body.length - 3) {
        const ang = a.a || Math.atan2(b.y - a.y, b.x - a.x);
        const perpX = Math.sin(ang), perpY = -Math.cos(ang);
        const spikeLen = lerp(8, LEG_LENGTH, i / body.length) * (1 + (biting.active && i < 8 ? 0.6 : 0));
        const side = (i % (LEG_EVERY * 2) === 0) ? 1 : -1;
        const sx = a.x + perpX * 6 * side;
        const sy = a.y + perpY * 6 * side;
        const tx = sx + perpX * spikeLen * side - Math.cos(a.a) * 12;
        const ty = sy + perpY * spikeLen * side - Math.sin(a.a) * 12;
        trailCtx.lineWidth = 1.8;
        trailCtx.strokeStyle = COLOR_DIM;
        trailCtx.beginPath(); trailCtx.moveTo(sx, sy); trailCtx.lineTo(tx, ty); trailCtx.stroke();
        trailCtx.lineWidth = 0.9;
        trailCtx.strokeStyle = COLOR_LIGHT;
        trailCtx.beginPath(); trailCtx.moveTo(sx, sy); trailCtx.lineTo(tx + Math.cos(a.a) * 6, ty + Math.sin(a.a) * 6); trailCtx.stroke();
      }
    }

    // Draw wings (four wings: two pairs) projected into trail
    drawWingsToTrail();
  }

  function drawWingsToTrail() {
    // two anchor points along the torso for two wing pairs
    const anchors = [Math.floor(body.length * 0.14), Math.floor(body.length * 0.35)];
    for (let pair = 0; pair < anchors.length; pair++) {
      const anchorIdx = anchors[pair];
      const anchor = body[anchorIdx];
      const baseAng = anchor.a || 0;
      // two sides each -> total 4 wings
      for (let side = -1; side <= 1; side += 2) {
        for (let r = 0; r < WING_RIBS; r++) {
          const t = r / (WING_RIBS - 1);
          const spread = lerp(80, 420 + pair * 60, t) * (1 + 0.2 * Math.sin(tclock * 0.9 + r));
          const ang = baseAng + side * (Math.PI / 2 + t * (0.85 + pair * 0.12));
          const ex = anchor.x + Math.cos(ang) * spread;
          const ey = anchor.y + Math.sin(ang) * spread * (0.9 + 0.25 * t);
          // layered ribs
          trailCtx.lineWidth = lerp(2.4, 0.6, t);
          trailCtx.strokeStyle = COLOR_DIM;
          trailCtx.beginPath(); trailCtx.moveTo(anchor.x, anchor.y); trailCtx.lineTo(ex, ey); trailCtx.stroke();
          trailCtx.lineWidth = Math.max(0.6, lerp(1.2, 0.5, t));
          trailCtx.strokeStyle = COLOR_LIGHT;
          trailCtx.beginPath(); trailCtx.moveTo(anchor.x, anchor.y); trailCtx.lineTo(ex - Math.cos(ang) * 6, ey - Math.sin(ang) * 6); trailCtx.stroke();
        }
      }
    }
  }

  // draw particles and sharp head overlay on main canvas
  function drawParticles(ctxMain) {
    // flames (particles)
    if (particles.length > 0) {
      ctxMain.save(); ctxMain.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const alpha = clamp(1 - p.t / p.life, 0.02, 1) * p.alpha;
        ctxMain.lineWidth = p.thickness;
        ctxMain.strokeStyle = `rgba(255,${Math.floor(220 * alpha)},${Math.floor(100 * alpha)},${alpha})`;
        ctxMain.beginPath(); ctxMain.moveTo(p.x, p.y); ctxMain.lineTo(p.x - p.vx * 0.012, p.y - p.vy * 0.012); ctxMain.stroke();
      }
      ctxMain.restore();
    }
    // eat particles (bright white streaks)
    if (eatParticles.length > 0) {
      ctxMain.save(); ctxMain.globalCompositeOperation = "lighter";
      for (const e of eatParticles) {
        const a = clamp(1 - e.t / e.life, 0.02, 1);
        ctxMain.lineWidth = e.thickness;
        ctxMain.strokeStyle = `rgba(255,255,255,${a})`;
        ctxMain.beginPath(); ctxMain.moveTo(e.x, e.y); ctxMain.lineTo(e.x - e.vx * 0.01, e.y - e.vy * 0.01); ctxMain.stroke();
      }
      ctxMain.restore();
    }
  }

  function drawHeadAndDetails(ctxMain) {
    // draw head overlay (crisp lines)
    const h = body[0];
    const ang = h.a || 0;
    const hx = h.x, hy = h.y;
    const tipX = hx + Math.cos(ang) * 72;
    const tipY = hy + Math.sin(ang) * 72;

    // draw top snout ridge
    line(hx - Math.cos(ang) * 12, hy - Math.sin(ang) * 12, tipX, tipY, 5.6, COLOR_LIGHT);
    // jaws (open/closing dynamic)
    const d = dist(hx, hy, pointer.x, pointer.y);
    const near = clamp(1 - (d / BITE_DISTANCE), 0, 1);
    const jawOpen = biting.active ? 0.9 : (0.08 + near * 0.96);
    const vibr = biting.active && biting.phase === "snap" ? Math.sin(tclock * 300) * 0.5 : 0;
    const jawLx = hx + Math.cos(ang + 0.30 + vibr) * (32 + jawOpen * 36);
    const jawLy = hy + Math.sin(ang + 0.30 + vibr) * (32 + jawOpen * 36);
    const jawRx = hx + Math.cos(ang - 0.30 - vibr) * (32 + jawOpen * 36);
    const jawRy = hy + Math.sin(ang - 0.30 - vibr) * (32 + jawOpen * 36);

    line(tipX, tipY, jawLx, jawLy, 4.2, COLOR_WHITE);
    line(tipX, tipY, jawRx, jawRy, 4.2, COLOR_WHITE);

    // horns (sharp)
    const horn1X = hx + Math.cos(ang + 0.78) * 58, horn1Y = hy + Math.sin(ang + 0.78) * 58;
    const horn2X = hx + Math.cos(ang - 0.78) * 58, horn2Y = hy + Math.sin(ang - 0.78) * 58;
    line(hx - Math.cos(ang) * 10, hy - Math.sin(ang) * 10, horn1X, horn1Y, 3.8, COLOR_LIGHT);
    line(hx - Math.cos(ang) * 10, hy - Math.sin(ang) * 10, horn2X, horn2Y, 3.8, COLOR_LIGHT);

    // teeth (sharp line-only teeth)
    for (let k = 0; k < 7; k++) {
      const f = k / 6;
      const bx = lerp(jawRx, jawLx, f);
      const by = lerp(jawRy, jawLy, f);
      const offAng = ang + (Math.random() - 0.5) * 0.16;
      line(bx, by, bx - Math.cos(offAng) * (8 + jawOpen * 26), by - Math.sin(offAng) * (8 + jawOpen * 26), 1.2, COLOR_WHITE);
    }

    // eye (tiny cross lines)
    const eyeX = hx + Math.cos(ang) * 22 - Math.sin(ang) * 14;
    const eyeY = hy + Math.sin(ang) * 22 + Math.cos(ang) * 14;
    line(eyeX - 4, eyeY - 1, eyeX + 4, eyeY + 1, 1.6, COLOR_WHITE);
    line(eyeX - 1, eyeY - 4, eyeX + 1, eyeY + 4, 1.6, COLOR_WHITE);

    // if pointer.down -> draw larger flame core (heavy)
    if (pointer.down) {
      // spawn heavier flame bursts
      spawnFlameBurst(1.8);
    } else {
      // small idle ember spawns for atmosphere
      if (Math.random() < 0.02) spawnFlameBurst(0.28);
    }
  }

  // ---------- ANIMATION LOOP ----------
  let last = performance.now();
  function frame(now) {
    const dt = (now - last) / 1000; last = now;
    tclock += dt;

    // update body kinematics & particles
    updateBody(dt);
    updateParticles(dt);
    // update particle arrays
    updateParticles(dt);
    // render: trail -> main canvas
    render();

    // update previous pointer sample
    prevPointer = { x: pointer.x, y: pointer.y };

    requestAnimationFrame(frame);
  }

  // start animate
  requestAnimationFrame(frame);

  // helper: clamp index
  function clampIdx(i, lo, hi) { return Math.max(lo, Math.min(hi, i)); }

  // small console hint
  console.log("Dragon Ultimate PRO running. Left-click to unleash heavy flame. Linger near head to lure bite. S saves image.");

  // small function to update particles arrays (called above)
  function updateParticles(dtGlobal) {
    // already defined earlier under different name; keep it consistent:
    // we will just run the function previously declared that updates particles
    updateParticles = updateParticlesImplementation;
  }

  // workaround: define the final update function implementation separately to avoid hoisting confusion
  function updateParticlesImplementation(dt) {
    // update flame particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      if (p.t >= p.life) particles.splice(i, 1);
      else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.986; p.vy *= 0.986;
      }
    }
    // update eat particles
    for (let i = eatParticles.length - 1; i >= 0; i--) {
      const e = eatParticles[i];
      e.t += dt;
      if (e.t >= e.life) eatParticles.splice(i, 1);
      else {
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.vx *= 0.96; e.vy *= 0.96;
      }
    }
  }

  // Replace the previous placeholder with actual function
  updateParticles = updateParticlesImplementation;

  // Done.
})();
