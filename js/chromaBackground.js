// ============================================================
// chromaBackground.js — Aurora Glass Board Background
// ============================================================

export function initChromaBackground(opts = {}) {
    if (document.getElementById("auroraWrap")) return;

    const wrap = document.createElement("div");
    wrap.id = "auroraWrap";
    wrap.setAttribute("aria-hidden", "true");
    Object.assign(wrap.style, {
        position: "fixed", inset: "0", width: "100%", height: "100%",
        zIndex: "-1", pointerEvents: "none"
    });

    // إنشاء 3 ديال canvas بحال اللي كاين فكود الشفق
    const cBg = document.createElement("canvas");
    const cAurora = document.createElement("canvas");
    const cStars = document.createElement("canvas");
    
    [cBg, cAurora, cStars].forEach(c => {
        c.style.position = "absolute";
        c.style.inset = "0";
        c.style.width = "100%";
        c.style.height = "100%";
        wrap.appendChild(c);
    });

    document.body.insertBefore(wrap, document.body.firstChild);

    const ctxBg = cBg.getContext('2d');
    const ctxA = cAurora.getContext('2d');
    const ctxS = cStars.getContext('2d');

    let W = 0, H = 0;

    // --- Smooth Noise (FBM) ---
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

    // --- Background & Stars ---
    function drawBg() {
        ctxBg.clearRect(0, 0, W, H);
        const g = ctxBg.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#04080F');
        g.addColorStop(0.55, '#060C18');
        g.addColorStop(0.80, '#0A1628');
        g.addColorStop(1, '#0D1F35');
        ctxBg.fillStyle = g; ctxBg.fillRect(0, 0, W, H);
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
            ctxS.fillStyle = `rgba(255,255,255,${al})`; ctxS.fill();
        }
    }

    // --- Aurora ---
    const LAYERS = [
        { type: 'cloud', h: 160, s: 90, l: 30, a: 0.15, x: 0.2, y: 0.4, r: 0.5, nF: 0.001, nS: 0.00002 },
        { type: 'arc', h: 170, s: 90, l: 45, a: 0.5, yC: 0.6, curve: -0.15, nF: 0.0015, nS: 0.00003, thick: 0.12 },
        { type: 'curtain', h: 145, s: 100, l: 65, a: 0.85, yC: 0.65, curve: 0.1, nF: 0.002, nS: 0.00006, hght: 0.4 }
    ];

    function drawAurora(t) {
        ctxA.clearRect(0, 0, W, H);
        ctxA.save();
        ctxA.globalCompositeOperation = 'screen';
        
        // (تم اختصار رسم الشفق هنا للوضوح، يمكن وضع دوال drawArc و drawCurtain من كودك الأصلي هنا)
        // ... (ضيف دوال الشفق لي كاينين فالكود ديالك: drawCloudAurora, drawArc, drawCurtain)

        ctxA.restore();
    }

    function resize() {
        W = window.innerWidth; H = window.innerHeight;
        [cBg, cAurora, cStars].forEach(c => { c.width = W; c.height = H; });
        drawBg(); buildStars();
    }
    
    window.addEventListener('resize', resize);
    resize();

    function loop(ts) {
        drawStars(ts);
        // drawAurora(ts); // فعلها ملي تزيد دوال الرسم
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}