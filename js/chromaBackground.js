// ============================================================
// chromaBackground.js — Aurora Glass Board (Exact Version)
// ============================================================

export function initChromaBackground() {
    if (document.getElementById("sky")) return;

    // إعداد حاوية الخلفية
    const sky = document.createElement("div");
    sky.id = "sky";
    Object.assign(sky.style, {
        position: "fixed", inset: "0", zIndex: "-1", pointerEvents: "none"
    });

    const cBg = document.createElement("canvas");
    const cAurora = document.createElement("canvas");
    const cStars = document.createElement("canvas");
    
    [cBg, cAurora, cStars].forEach(c => {
        c.style.position = "absolute";
        c.style.inset = "0";
        c.style.width = "100%";
        c.style.height = "100%";
        sky.appendChild(c);
    });

    document.body.insertBefore(sky, document.body.firstChild);

    const ctxBg = cBg.getContext('2d');
    const ctxA = cAurora.getContext('2d');
    const ctxS = cStars.getContext('2d');
    let W = 0, H = 0;

    // --- الرياضيات (Smooth Noise) ---
    const perm = (() => {
        const p = new Uint8Array(512);
        const base = [...Array(256)].map((_, i) => i);
        for (let i = 255; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [base[i], base[j]] = [base[j], base[i]]; }
        for (let i = 0; i < 512; i++) p[i] = base[i & 255];
        return p;
    })();

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
    function lerp(a, b, t) { return a + t * (b - a); }
    function grad1D(h, x) { return (h & 1) ? x : -x; }
    function noise1(x) {
        const xi = Math.floor(x) & 255, xf = x - Math.floor(x), u = fade(xf);
        return lerp(grad1D(perm[xi], xf), grad1D(perm[xi + 1], xf - 1), u);
    }
    function fbm(x, octs = 4) {
        let v = 0, amp = .5, freq = 1, max = 0;
        for (let i = 0; i < octs; i++) { v += noise1(x * freq) * amp; max += amp; amp *= .5; freq *= 2.1; }
        return v / max;
    }

    // --- رسم السماء والنجوم ---
    function drawBg() {
        ctxBg.clearRect(0, 0, W, H);
        const g = ctxBg.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#04080F');
        g.addColorStop(0.55, '#060C18');
        g.addColorStop(0.80, '#0A1628');
        g.addColorStop(1, '#0D1F35');
        ctxBg.fillStyle = g; 
        ctxBg.fillRect(0, 0, W, H);
    }

    let stars = [];
    function buildStars() {
        stars = [];
        for (let i = 0; i < 320; i++) {
            stars.push({
                x: Math.random(), y: Math.random() * .85,
                r: Math.random() * 1.1 + .2, a: Math.random() * .5 + .45,
                sp: Math.random() * .011 + .003, ph: Math.random() * Math.PI * 2
            });
        }
    }
    function drawStars(t) {
        ctxS.clearRect(0, 0, W, H);
        for (const s of stars) {
            const pulse = Math.sin(t * s.sp + s.ph) * .35 + .65;
            const al = s.a * pulse;
            ctxS.beginPath(); ctxS.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
            ctxS.fillStyle = `rgba(255,255,255,${al})`; 
            ctxS.fill();
        }
    }

    // --- الشفق القطبي ---
    const LAYERS_DARK = [
        { type: 'cloud',   h: 160, s: 90, l: 30, a: 0.15, x: 0.2, y: 0.4, r: 0.5, nF: 0.001, nS: 0.00002 },
        { type: 'cloud',   h: 210, s: 80, l: 35, a: 0.12, x: 0.8, y: 0.5, r: 0.6, nF: 0.002, nS: 0.00003 },
        { type: 'arc',     h: 170, s: 90, l: 45, a: 0.5,  yC: 0.6, curve: -0.15, nF: 0.0015, nS: 0.00003, thick: 0.12 },
        { type: 'curtain', h: 145, s: 100, l: 65, a: 0.85, yC: 0.65, curve: 0.1,  nF: 0.002, nS: 0.00006, hght: 0.4 },
        { type: 'curtain', h: 155, s: 100, l: 75, a: 0.95, yC: 0.55, curve: -0.05, nF: 0.003, nS: 0.00008, hght: 0.3 }
    ];

    function drawCloudAurora(ctx, layer, t) {
        const { h, s, l, a, x, y, r, nF, nS } = layer;
        const nx = (x + fbm(t * nS, 2) * 0.2 - 0.1) * W;
        const ny = (y + fbm(t * nS + 10, 2) * 0.2 - 0.1) * H;
        const rad = r * Math.min(W, H) * (0.8 + 0.4 * fbm(t * nS * 2, 2));
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, rad);
        g.addColorStop(0, `hsla(${h},${s}%,${l}%,${a})`);
        g.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(nx, ny, rad, 0, Math.PI * 2); ctx.fill();
    }

    function drawArc(ctx, layer, t) {
        const { h, s, l, a, yC, curve, nF, nS, thick } = layer;
        const PTS = 80;
        const dx = W / (PTS - 1);
        const topY = [], botY = [];
        for (let i = 0; i < PTS; i++) {
            const x = i * dx;
            const arcOffset = Math.sin((x / W) * Math.PI) * curve * H;
            const noise = (fbm(x * nF + t * nS, 3) - 0.5) * 0.15 * H;
            const cy = yC * H + arcOffset + noise;
            const hs = thick * H * 0.5;
            topY.push(cy - hs);
            botY.push(cy + hs);
        }
        ctx.beginPath();
        ctx.moveTo(0, topY[0]);
        for (let i = 0; i < PTS - 1; i++) {
            const cpx = (i * dx + (i + 1) * dx) * 0.5;
            const cpy = (topY[i] + topY[i + 1]) * 0.5;
            ctx.quadraticCurveTo(i * dx, topY[i], cpx, cpy);
        }
        ctx.lineTo(W, topY[PTS - 1]);
        ctx.lineTo(W, botY[PTS - 1]);
        for (let i = PTS - 2; i >= 0; i--) {
            const cpx = (i * dx + (i + 1) * dx) * 0.5;
            const cpy = (botY[i] + botY[i + 1]) * 0.5;
            ctx.quadraticCurveTo((i + 1) * dx, botY[i + 1], cpx, cpy);
        }
        ctx.lineTo(0, botY[0]);
        ctx.closePath();
        const avgCy = topY[Math.floor(PTS/2)] + (botY[0]-topY[0])*.5;
        const g = ctx.createLinearGradient(0, avgCy - thick * H * 0.5, 0, avgCy + thick * H * 0.5);
        g.addColorStop(0, `hsla(${h},${s}%,${Math.min(l+15,100)}%,0)`);
        g.addColorStop(0.5, `hsla(${h},${s}%,${l}%,${a})`);
        g.addColorStop(1, `hsla(${h},${s}%,${Math.max(l-15,10)}%,0)`);
        ctx.fillStyle = g;
        ctx.fill();
    }

    function drawCurtain(ctx, layer, t) {
        const { h, s, l, a, yC, curve, nF, nS, hght } = layer;
        const step = 2; // زدت الخطوة لـ 2 باش نخفف الثقل (Lag) شوية
        for (let x = 0; x < W; x += step) {
            const arcOffset = Math.sin((x / W) * Math.PI) * curve * H;
            const baseNoise = (fbm(x * nF + t * nS, 3) - 0.5) * 0.15 * H;
            const baseY = yC * H + arcOffset + baseNoise;
            const pleatNoise = fbm(x * nF * 5 + t * nS * 4, 2); 
            const alpha = a * (0.2 + 0.8 * pleatNoise);
            const stripH = hght * H * (0.6 + 0.4 * pleatNoise);
            const g = ctx.createLinearGradient(0, baseY, 0, baseY - stripH);
            g.addColorStop(0, `hsla(${h},${s}%,${Math.min(l + 25, 100)}%,${alpha})`); 
            g.addColorStop(0.15, `hsla(${h},${s}%,${l}%,${alpha * 0.9})`);
            g.addColorStop(1, `hsla(${h},${s}%,${Math.max(l - 20, 10)}%,0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x, baseY - stripH, step + 0.5, stripH);
        }
    }

    function drawAurora(t){
        ctxA.clearRect(0, 0, W, H);
        ctxA.save();
        ctxA.globalCompositeOperation = 'screen';
        for(const layer of LAYERS_DARK) {
            if (layer.type === 'cloud') drawCloudAurora(ctxA, layer, t);
            else if (layer.type === 'arc') drawArc(ctxA, layer, t);
            else if (layer.type === 'curtain') drawCurtain(ctxA, layer, t);
        }
        ctxA.restore();
    }

    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        [cBg, cAurora, cStars].forEach(c => { c.width = W; c.height = H; });
        drawBg();
        buildStars();
    }
    
    window.addEventListener('resize', resize);
    resize();

    function loop(ts) {
        drawStars(ts);
        drawAurora(ts);
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}