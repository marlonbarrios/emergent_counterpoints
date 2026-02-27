// Counterpoint Tool - p5.js
// Widgets move on a stage; arms stop at clock-face positions and move at one of four speeds.
// Markings: shape match, fan (same rate), motion trails. Toggles by sliders.

let tool;

function getCanvasSize() {
    const el = document.getElementById('canvas');
    return { w: el ? el.clientWidth : windowWidth, h: el ? el.clientHeight : 400 };
}

function setup() {
    let { w: canvasWidth, h: canvasHeight } = getCanvasSize();
    if (canvasWidth <= 0 || canvasHeight <= 0) {
        canvasWidth = windowWidth;
        canvasHeight = Math.max(300, windowHeight - 280);
    }
    const cnv = createCanvas(canvasWidth, canvasHeight);
    cnv.parent('canvas');

    tool = new CounterpointTool();
    tool.setupControls();
    tool.initializeWidgets();

    const canvasEl = document.getElementById('canvas');
    if (canvasEl && typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            const { w, h } = getCanvasSize();
            if (w > 0 && h > 0) {
                resizeCanvas(w, h);
                if (tool && tool.widgets.length > 0) tool.repositionWidgets();
                tool._initialRepositionDone = false;
            }
        });
        ro.observe(canvasEl);
    }
    setTimeout(() => {
        const { w, h } = getCanvasSize();
        if (w > 0 && h > 0) {
            if (w !== width || h !== height) resizeCanvas(w, h);
            if (tool && tool.widgets.length > 0) tool.repositionWidgets();
        }
    }, 250);
}

function draw() {
    if (tool.isPlaying) {
        tool.update();
    }
    tool.draw();
}

function windowResized() {
    const { w, h } = getCanvasSize();
    if (w > 0 && h > 0) {
        resizeCanvas(w, h);
        if (tool && tool.widgets.length > 0) tool.repositionWidgets();
    }
}

// 12 clock positions; 4 speed levels (0=still, 1–3 = slow to fast); each widget has 3 arms
const CLOCK_POSITIONS = 12;
const NUM_SPEEDS = 4;
const NUM_ARMS = 3;
const MIN_WIDGET_DIST = 85;
// Keep movers out from under the Tweakpane (top-right); inner 3/4 keeps them toward center
const EDGE_MARGIN = 75;
const INNER_INSET = 0.125;
const MAX_ARC_MOVERS = 15;

function getPlayBounds(w, h) {
    const outerMinX = EDGE_MARGIN;
    const outerMaxX = w - EDGE_MARGIN;
    const outerMinY = EDGE_MARGIN;
    const outerMaxY = h - EDGE_MARGIN;
    const safeW = Math.max(40, outerMaxX - outerMinX);
    const safeH = Math.max(40, outerMaxY - outerMinY);
    return {
        minX: outerMinX + safeW * INNER_INSET,
        maxX: outerMaxX - safeW * INNER_INSET,
        minY: outerMinY + safeH * INNER_INSET,
        maxY: outerMaxY - safeH * INNER_INSET
    };
}
// Time per step (ms): 0=still, 1=slow, 2=med, 3=fast — spread so shape vs speed is clearly different
const SPEED_MS = [Infinity, 1100, 420, 160];
const TRAIL_LENGTH = 80;

class CounterpointTool {
    constructor() {
        this.widgets = [];
        this.isPlaying = true;
        this.gridSize = 40;
        this.baseWidgetCount = 2;

        this.params = {
            shape: 0.2,
            speed: 0.1,
            motionV: 0.1,
            motionH: 0.1,
            zoom: 0.3,
            activity: 0.5,
            flocking: 0,
            collapse: 0
        };

        // Toggles for markings (bound to Tweakpane)
        this.marks = {
            showShapeMarks: false,
            showFanMarks: false,
            showMotionTrails: false,
            showTipPlanes: false
        };
        // Persistent layer: trail lines accumulate and stay visible (cleared when trails off or reset)
        this.trailLayer = null;
        this.pane = null;
        this.soundFile = null;   // HTMLAudioElement
        this.soundFileUrl = null; // blob URL to revoke on new load
        this.audioContext = null;
        this.audioAnalyser = null;
        this.audioSource = null;
        this.autoPerformance = false;
        this.audioSensitivity = 0.5;
        this._audioDataArray = null;
        this.soundDuration = 0;
        this._arcLastProgress = -1;
        this._arcLastMoverCount = -1;
        this._arcLastRefreshProgress = -1;
        this.effectiveParams = Object.assign({}, this.params);
        this._initialRepositionDone = false;
    }

    getPerformanceArc(progress, audio) {
        const p = constrain(progress, 0, 1);
        const ease = (t) => t * t * (3 - 2 * t);
        const p1 = ease(p);
        const beat = (audio && typeof audio.beat === 'number') ? audio.beat : 0;
        const bass = (audio && typeof audio.bass === 'number') ? audio.bass : 0;
        const level = (audio && typeof audio.level === 'number') ? audio.level : 0;
        const mids = (audio && typeof audio.mids === 'number') ? audio.mids : 0;
        const highs = (audio && typeof audio.highs === 'number') ? audio.highs : 0;
        const react = 0.4 + beat * 0.6 + level * 0.3;
        const numSegs = 28;
        const segRaw = p * numSegs;
        const segBump = beat > 0.5 ? Math.min(numSegs - 1, (segRaw | 0) + 1) : (segRaw | 0);
        const seg = Math.min(segBump, numSegs - 1);
        const scripts = [
            [1, 2, 4, 3, 6, 5, 8, 7, 10, 12, 15, 12, 8, 6, 5, 4, 6, 8, 10, 8, 6, 4, 3, 2, 2, 2, 2, 2],
            [15, 12, 8, 6, 7, 5, 4, 6, 8, 10, 12, 7, 5, 3, 4, 6, 8, 6, 4, 3, 5, 7, 6, 4, 3, 2, 2, 2],
            [3, 5, 2, 6, 4, 8, 10, 12, 14, 10, 7, 4, 6, 10, 6, 4, 3, 5, 4, 3, 2, 3, 2, 2, 2, 2, 2, 2],
            [2, 2, 5, 5, 10, 12, 15, 12, 8, 8, 4, 6, 10, 7, 4, 3, 6, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2],
            [4, 3, 2, 6, 4, 8, 6, 10, 12, 15, 12, 7, 5, 3, 6, 8, 10, 6, 4, 3, 2, 2, 2, 2, 2, 2, 2, 2]
        ];
        const scriptIdx = this.soundDuration > 0 ? Math.floor(this.soundDuration * 0.13 + (this.soundDuration | 0) * 7) % scripts.length : 0;
        const moverBySegment = scripts[scriptIdx];
        const targetMoverCount = Math.max(1, Math.min(MAX_ARC_MOVERS, moverBySegment[Math.min(seg, moverBySegment.length - 1)]));
        const wave = (phase) => 0.5 + 0.5 * Math.sin(p * Math.PI * 4 + phase);
        const reactFlock = 0.15 + wave(0) * 0.5 + bass * 0.4 + beat * 0.25;
        const reactCollapse = wave(1.2) * 0.55 + bass * 0.4 + beat * 0.25;
        const reactActivity = 0.2 + wave(0.7) * 0.4 + mids * 0.4 + beat * 0.35;
        const reactMotion = 0.1 + wave(2.1) * 0.5 + level * 0.3 + beat * 0.25;
        const reactZoom = 0.15 + wave(0.4) * 0.5 + (1 - level) * 0.35 + beat * 0.15;
        const reactShape = wave(1.5) * 0.7 + highs * 0.25 + level * 0.2;
        const reactSpeed = wave(2.8) * 0.65 + highs * 0.3 + beat * 0.2;
        const flocking = constrain(reactFlock, 0, 1);
        const collapse = constrain(reactCollapse, 0, 1);
        const activity = constrain(reactActivity, 0, 1);
        const motion = constrain(reactMotion, 0, 1);
        const zoom = constrain(reactZoom, 0, 1);
        const shape = constrain(reactShape, 0, 1);
        const speed = constrain(reactSpeed, 0, 1);
        const markOrders = [
            { shape: 0.04, fan: 0.15, trails: 0.08, tip: 0.25 },
            { shape: 0.12, fan: 0.06, trails: 0.35, tip: 0.18 },
            { shape: 0.06, fan: 0.28, trails: 0.12, tip: 0.08 },
            { shape: 0.22, fan: 0.08, trails: 0.05, tip: 0.42 },
            { shape: 0.03, fan: 0.35, trails: 0.22, tip: 0.12 }
        ];
        const orderIdx = (scriptIdx + Math.floor(this.soundDuration) % 5) % markOrders.length;
        const th = markOrders[orderIdx];
        const markBoost = 1 - react * 0.35;
        const fanWindows = [
            [{ start: 0.18, end: 0.22 }, { start: 0.58, end: 0.62 }],
            [{ start: 0.35, end: 0.39 }, { start: 0.78, end: 0.82 }],
            [{ start: 0.08, end: 0.12 }, { start: 0.45, end: 0.49 }],
            [{ start: 0.52, end: 0.56 }],
            [{ start: 0.25, end: 0.29 }, { start: 0.68, end: 0.72 }]
        ];
        const fanRanges = fanWindows[scriptIdx % fanWindows.length];
        const fanMarks = fanRanges.some(r => p >= r.start && p <= r.end);
        return {
            targetMoverCount,
            flocking,
            collapse,
            activity,
            motionV: motion,
            motionH: motion,
            zoom,
            shape,
            speed,
            shapeMarks: p > th.shape * markBoost,
            fanMarks,
            trails: p > th.trails * markBoost,
            tipPlanes: p > th.tip * markBoost
        };
    }

    setupControls() {
        const container = document.getElementById('tweakpane-container');
        if (!container) return;
        const PaneClass = (typeof Tweakpane !== 'undefined' && Tweakpane.Pane) ? Tweakpane.Pane : (typeof Pane !== 'undefined' ? Pane : null);
        if (typeof PaneClass !== 'function') {
            console.warn('Tweakpane not loaded: add controls here or load Tweakpane script.');
            return;
        }
        const pane = new PaneClass({ container: container, title: 'Controls', expanded: true });
        this.pane = pane;

        // Parameters folder (Tweakpane 3 uses addInput, not addBinding)
        const paramsFolder = pane.addFolder({ title: 'Parameters', expanded: true });
        paramsFolder.addInput(this.params, 'activity', { min: 0, max: 1, step: 0.01, label: 'Activity (less↔more)' });
        paramsFolder.addInput(this.params, 'flocking', { min: 0, max: 1, step: 0.01, label: 'Flocking (none↔strong)' });
        paramsFolder.addInput(this.params, 'shape', { min: 0, max: 1, step: 0.01, label: 'Shape (sameness↔diff)' });
        paramsFolder.addInput(this.params, 'speed', { min: 0, max: 1, step: 0.01, label: 'Speed (sameness↔diff)' });
        paramsFolder.addInput(this.params, 'motionV', { min: 0, max: 1, step: 0.01, label: 'Motion ↑↓' });
        paramsFolder.addInput(this.params, 'motionH', { min: 0, max: 1, step: 0.01, label: 'Motion ↔' });
        paramsFolder.addInput(this.params, 'zoom', { min: 0, max: 1, step: 0.01, label: 'Zoom (Out↔In)' });
        paramsFolder.addInput(this.params, 'collapse', { min: 0, max: 1, step: 0.01, label: 'Collapse (min↔max)' });

        // Markings folder
        const marksFolder = pane.addFolder({ title: 'Markings', expanded: true });
        marksFolder.addInput(this.marks, 'showShapeMarks', { label: 'Shape match lines' });
        marksFolder.addInput(this.marks, 'showFanMarks', { label: 'Fan (speed align)' });
        const trailsInput = marksFolder.addInput(this.marks, 'showMotionTrails', { label: 'Motion trails' });
        trailsInput.on('change', () => {
            if (!this.marks.showMotionTrails && this.trailLayer) this.clearTrailLayer();
        });
        marksFolder.addInput(this.marks, 'showTipPlanes', { label: 'Tip planes △' });

        // Actions folder
        const actionsFolder = pane.addFolder({ title: 'Actions', expanded: true });
        actionsFolder.addButton({ title: 'Add mover' }).on('click', () => this.addWidget());
        actionsFolder.addButton({ title: 'Remove mover' }).on('click', () => this.removeWidget());
        actionsFolder.addButton({ title: 'Pause / Play' }).on('click', () => { this.isPlaying = !this.isPlaying; });
        actionsFolder.addButton({ title: 'Toggle all marks' }).on('click', () => {
            const anyOn = this.marks.showShapeMarks || this.marks.showFanMarks || this.marks.showMotionTrails || this.marks.showTipPlanes;
            if (anyOn) {
                this.marks.showShapeMarks = this.marks.showFanMarks = this.marks.showMotionTrails = this.marks.showTipPlanes = false;
                if (this.trailLayer) this.clearTrailLayer();
            } else {
                this.marks.showShapeMarks = this.marks.showFanMarks = this.marks.showMotionTrails = this.marks.showTipPlanes = true;
            }
            if (this.pane && typeof this.pane.refresh === 'function') this.pane.refresh();
        });
        actionsFolder.addButton({ title: 'Reset' }).on('click', () => this.reset());
        actionsFolder.addButton({ title: 'Hide panel' }).on('click', () => {
            const container = document.getElementById('tweakpane-container');
            const showBtn = document.getElementById('show-panel-btn');
            if (container) container.classList.add('panel-hidden');
            if (showBtn) showBtn.classList.remove('panel-hidden');
        });
        const showPanelBtn = document.getElementById('show-panel-btn');
        if (showPanelBtn) {
            showPanelBtn.addEventListener('click', () => {
                const container = document.getElementById('tweakpane-container');
                if (container) container.classList.remove('panel-hidden');
                showPanelBtn.classList.add('panel-hidden');
            });
        }

        // Sound folder: load file, play, pause, restart, stop (HTML5 Audio for reliable playback)
        const soundFolder = pane.addFolder({ title: 'Sound', expanded: true });
        const soundFileInput = document.getElementById('sound-file-input');
        if (soundFileInput) {
            soundFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file || !file.type.startsWith('audio/')) return;
                if (this.soundFileUrl) URL.revokeObjectURL(this.soundFileUrl);
                if (this.soundFile) {
                    this.soundFile.pause();
                    this.soundFile.src = '';
                }
                this.soundFileUrl = URL.createObjectURL(file);
                this.soundFile = new Audio(this.soundFileUrl);
                this.soundFile.addEventListener('error', () => console.error('Sound load error'));
                this.audioSource = null;
                this.audioContext = null;
                this.audioAnalyser = null;
                this._audioDataArray = null;
                this._audioLevelHistory = [];
                this.soundDuration = 0;
                this._arcLastProgress = -1;
                this._arcLastMoverCount = -1;
                this.soundFile.addEventListener('loadedmetadata', () => {
                    if (this.soundFile && !isNaN(this.soundFile.duration) && isFinite(this.soundFile.duration)) this.soundDuration = this.soundFile.duration;
                });
                this.soundFile.addEventListener('ended', () => this.exitAllMovers());
                e.target.value = '';
            });
            soundFolder.addButton({ title: 'Load sound file' }).on('click', () => soundFileInput.click());
        }
        soundFolder.addButton({ title: 'Play' }).on('click', () => {
            if (this.soundFile) {
                this.ensureAudioAnalysis();
                this.soundFile.play().catch((e) => console.warn('Play failed:', e));
            }
        });
        soundFolder.addButton({ title: 'Pause' }).on('click', () => {
            if (this.soundFile) this.soundFile.pause();
        });
        soundFolder.addButton({ title: 'Restart' }).on('click', () => {
            if (this.soundFile) {
                this.ensureAudioAnalysis();
                this.soundFile.pause();
                this.soundFile.currentTime = 0;
                this._arcLastProgress = -1;
                this.soundFile.play().catch((e) => console.warn('Play failed:', e));
            }
        });
        soundFolder.addButton({ title: 'Stop' }).on('click', () => {
            if (this.soundFile) {
                this.soundFile.pause();
                this.soundFile.currentTime = 0;
            }
        });
        const autoPerfInput = soundFolder.addInput(this, 'autoPerformance', { label: 'Auto performance (add/remove movers, marks, zoom, etc. anytime)' });
        autoPerfInput.on('change', () => {
            if (this.autoPerformance) {
                if (this.soundFile) {
                    this.ensureAudioAnalysis();
                    this.soundFile.play().catch((e) => console.warn('Play failed:', e));
                }
            } else {
                if (this.soundFile) {
                    this.soundFile.pause();
                    this.soundFile.currentTime = 0;
                }
            }
        });
        soundFolder.addInput(this, 'audioSensitivity', { min: 0, max: 1, step: 0.05, label: 'Track sensitivity' });
    }

    ensureAudioAnalysis() {
        if (!this.soundFile || this.audioSource) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            this.audioContext = this.audioContext || new Ctx();
            this.audioSource = this.audioContext.createMediaElementSource(this.soundFile);
            this.audioAnalyser = this.audioContext.createAnalyser();
            this.audioAnalyser.fftSize = 512;
            this.audioAnalyser.smoothingTimeConstant = 0.75;
            this.audioSource.connect(this.audioAnalyser);
            this.audioAnalyser.connect(this.audioContext.destination);
            this._audioDataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
            this._audioLevelHistory = [];
            this._audioLevelHistoryLen = 12;
            if (this.audioContext.state === 'suspended') this.audioContext.resume();
        } catch (e) {
            console.warn('Audio analysis setup failed:', e);
        }
    }

    getAudioLevel() {
        if (!this.audioAnalyser || !this._audioDataArray) return 0;
        try {
            this.audioAnalyser.getByteFrequencyData(this._audioDataArray);
            let sum = 0;
            for (let i = 0; i < this._audioDataArray.length; i++) sum += this._audioDataArray[i];
            return (sum / this._audioDataArray.length) / 255;
        } catch (e) {
            return 0;
        }
    }

    getAudioBands() {
        if (!this.audioAnalyser || !this._audioDataArray) return { bass: 0, mids: 0, highs: 0, level: 0, beat: 0 };
        try {
            this.audioAnalyser.getByteFrequencyData(this._audioDataArray);
            const n = this._audioDataArray.length;
            const bassEnd = Math.floor(n * 0.1);
            const midsEnd = Math.floor(n * 0.5);
            let bass = 0, mids = 0, highs = 0;
            for (let i = 0; i < bassEnd && i < n; i++) bass += this._audioDataArray[i];
            for (let i = bassEnd; i < midsEnd && i < n; i++) mids += this._audioDataArray[i];
            for (let i = midsEnd; i < n; i++) highs += this._audioDataArray[i];
            bass = (bass / Math.max(1, bassEnd)) / 255;
            mids = (mids / Math.max(1, midsEnd - bassEnd)) / 255;
            highs = (highs / Math.max(1, n - midsEnd)) / 255;
            const level = (bass * 0.3 + mids * 0.4 + highs * 0.3);
            this._audioLevelHistory = this._audioLevelHistory || [];
            this._audioLevelHistoryLen = this._audioLevelHistoryLen || 12;
            this._audioLevelHistory.push(level);
            if (this._audioLevelHistory.length > this._audioLevelHistoryLen) this._audioLevelHistory.shift();
            const avg = this._audioLevelHistory.reduce((a, b) => a + b, 0) / this._audioLevelHistory.length;
            const beat = level > avg * 1.4 && level > 0.08 ? Math.min(1, (level - avg) * 3) : 0;
            return { bass, mids, highs, level, beat };
        } catch (e) {
            return { bass: 0, mids: 0, highs: 0, level: 0, beat: 0 };
        }
    }

    initializeWidgets() {
        this.widgets = [];
        for (let i = 0; i < this.baseWidgetCount; i++) this.addWidget(false);
    }

    getStageCenterAndBounds() {
        const w = Math.max(100, typeof width !== 'undefined' ? width : 400);
        const h = Math.max(100, typeof height !== 'undefined' ? height : 300);
        const b = getPlayBounds(w, h);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        return { cx, cy, minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY, w, h };
    }

    addWidget(fromEdge = true) {
        const { cx, cy, minX, minY, maxX, maxY, w, h } = this.getStageCenterAndBounds();
        let x, y, vx, vy;
        if (!fromEdge) {
            const n = this.widgets.length;
            const count = n + 1;
            const angle = (TWO_PI / Math.max(count, 2)) * n + random(-0.2, 0.2);
            const radius = 60 + random(80);
            const jitter = 25;
            x = constrain(cx + cos(angle) * radius + random(-jitter, jitter), minX, maxX);
            y = constrain(cy + sin(angle) * radius + random(-jitter, jitter), minY, maxY);
            vx = cos(angle) * 0.14 + (random() - 0.5) * 0.08;
            vy = sin(angle) * 0.14 + (random() - 0.5) * 0.08;
        } else {
            const edgeMargin = 15;
            const side = floor(random(4));
            if (side === 0) {
                x = random(minX, maxX);
                y = -edgeMargin - random(20);
                vx = (cx - x) * 0.012;
                vy = (cy - y) * 0.012;
            } else if (side === 1) {
                x = maxX + edgeMargin + random(20);
                y = random(minY, maxY);
                vx = (cx - x) * 0.012;
                vy = (cy - y) * 0.012;
            } else if (side === 2) {
                x = random(minX, maxX);
                y = h + edgeMargin + random(20);
                vx = (cx - x) * 0.012;
                vy = (cy - y) * 0.012;
            } else {
                x = -edgeMargin - random(20);
                y = random(minY, maxY);
                vx = (cx - x) * 0.012;
                vy = (cy - y) * 0.012;
            }
        }
        const clampX = constrain(x, minX, maxX);
        const clampY = constrain(y, minY, maxY);
        const widget = new Widget(clampX, clampY, this.widgets.length, this.params);
        widget.vx = vx;
        widget.vy = vy;
        widget.baseVx = vx;
        widget.baseVy = vy;
        this.widgets.push(widget);
    }

    repositionWidgets() {
        const { cx, cy, minX, minY, maxX, maxY } = this.getStageCenterAndBounds();
        this.widgets.forEach((w, i) => {
            const count = this.widgets.length;
            const angle = (TWO_PI / Math.max(count, 2)) * i + random(-0.15, 0.15);
            const radius = 50 + random(60);
            const jitter = 20;
            w.x = constrain(cx + cos(angle) * radius + random(-jitter, jitter), minX, maxX);
            w.y = constrain(cy + sin(angle) * radius + random(-jitter, jitter), minY, maxY);
        });
    }

    removeWidget() {
        if (this.widgets.length <= 1) return;
        const w = typeof width !== 'undefined' ? width : 400;
        const h = typeof height !== 'undefined' ? height : 300;
        const widget = this.widgets[this.widgets.length - 1];
        const dl = widget.x;
        const dr = w - widget.x;
        const exX = dl <= dr ? -40 : w + 40;
        const exY = widget.y;
        const dx = exX - widget.x, dy = exY - widget.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const speed = 4;
        widget.isExiting = true;
        widget.exitVx = (dx / d) * speed;
        widget.exitVy = (dy / d) * speed;
    }

    exitAllMovers() {
        const w = typeof width !== 'undefined' ? width : 400;
        const h = typeof height !== 'undefined' ? height : 300;
        const speed = 4;
        this.widgets.forEach((widget) => {
            if (widget.isExiting) return;
            const dl = widget.x;
            const dr = w - widget.x;
            const exX = dl <= dr ? -40 : w + 40;
            const exY = widget.y;
            const dx = exX - widget.x, dy = exY - widget.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
            widget.isExiting = true;
            widget.exitVx = (dx / d) * speed;
            widget.exitVy = (dy / d) * speed;
        });
        if (this.trailLayer) this.clearTrailLayer();
    }

    reset() {
        this.params.shape = 0.2;
        this.params.speed = 0.1;
        this.params.motionV = 0.1;
        this.params.motionH = 0.1;
        this.params.zoom = 0.3;
        this.params.activity = 0.5;
        this.params.flocking = 0;
        this.params.collapse = 0;
        this.marks.showShapeMarks = false;
        this.marks.showFanMarks = false;
        this.marks.showMotionTrails = false;
        this.marks.showTipPlanes = false;
        this.widgets = [];
        this.initializeWidgets();
        this.isPlaying = true;
        this._initialRepositionDone = false;
        this.effectiveParams = Object.assign({}, this.params);
        this.clearTrailLayer();
        if (this.pane && typeof this.pane.refresh === 'function') this.pane.refresh();
    }

    drawGrid() {
        const zoom = typeof this.effectiveParams.zoom === 'number' ? this.effectiveParams.zoom : this.params.zoom;
        const z = typeof zoom === 'number' ? zoom : 0.3;
        const scale = 0.35 + z * 1.0;
        const gridSpacing = this.gridSize * scale;
        fill(211, 211, 211); // #D3D3D3 light grey to match reference
        noStroke();
        const dotSize = 2.2;
        for (let x = gridSpacing; x < width; x += gridSpacing) {
            for (let y = gridSpacing; y < height; y += gridSpacing) {
                ellipse(x, y, dotSize, dotSize);
            }
        }
    }

    // Shape match: draw a line between two widgets when they have the same shape (alignment)
    drawShapeMarks() {
        if (!this.marks.showShapeMarks || this.widgets.length < 2) return;
        stroke(100, 130, 180, 180);
        strokeWeight(2);
        noFill();
        for (let i = 0; i < this.widgets.length; i++) {
            for (let j = i + 1; j < this.widgets.length; j++) {
                const a = this.widgets[i];
                const b = this.widgets[j];
                if (a.sameShape(b)) {
                    line(a.x, a.y, b.x, b.y);
                }
            }
        }
        noStroke();
    }

    // Fan: show when a widget's arms are in speed alignment (same rate) — obvious when button is on
    drawFanMarks() {
        if (!this.marks.showFanMarks) return;
        this.widgets.forEach(w => {
            if (w.sameArmSpeed()) w.drawFan(this.effectiveParams.zoom);
        });
    }

    // Planes between the tips of the arms: triangles per widget + mesh lines between widgets
    drawTipPlanes() {
        if (!this.marks.showTipPlanes || this.widgets.length === 0) return;
        const active = this.widgets.filter(w => !w.isExiting);
        if (active.length === 0) return;
        const tips = active.map(w => w.getTipPositions(this.effectiveParams.zoom, this.effectiveParams));
        stroke(0);
        strokeWeight(1);
        noFill();
        for (let i = 0; i < tips.length; i++) {
            const t = tips[i];
            if (!t || t.length < 3) continue;
            beginShape();
            t.forEach(p => vertex(p.x, p.y));
            endShape(CLOSE);
        }
        for (let i = 0; i < tips.length - 1; i++) {
            const ta = tips[i];
            const tb = tips[i + 1];
            if (!ta || !tb || ta.length < 3 || tb.length < 3) continue;
            for (let a = 0; a < 3; a++) {
                for (let b = 0; b < 3; b++) {
                    line(ta[a].x, ta[a].y, tb[b].x, tb[b].y);
                }
            }
        }
        noStroke();
    }

    clearTrailLayer() {
        if (this.trailLayer) this.trailLayer.background(255, 255, 255, 0);
    }

    // Trails: persistent layer; each frame we add a segment and fade the layer so traces decay in time
    drawTrails() {
        if (!this.marks.showMotionTrails) return;
        const w = typeof width !== 'undefined' ? width : 400;
        const h = typeof height !== 'undefined' ? height : 300;
        if (!this.trailLayer || this.trailLayer.width !== w || this.trailLayer.height !== h) {
            this.trailLayer = createGraphics(w, h);
            this.trailLayer.background(255, 255, 255, 0);
        }
        this.trailLayer.push();
        // Decay in time: fade existing trails so older traces gradually disappear (longer decay = lower alpha)
        this.trailLayer.fill(255, 255, 255, 3);
        this.trailLayer.noStroke();
        this.trailLayer.rect(0, 0, w, h);
        this.trailLayer.stroke(100, 130, 180, 200);
        this.trailLayer.strokeWeight(2);
        this.trailLayer.noFill();
        this.widgets.forEach(w => {
            if (w.prevX != null && w.prevY != null && (w.prevX !== w.x || w.prevY !== w.y)) {
                this.trailLayer.line(w.prevX, w.prevY, w.x, w.y);
            }
        });
        this.trailLayer.pop();
        image(this.trailLayer, 0, 0);
    }

    update() {
        const w = typeof width !== 'undefined' ? width : 400;
        const h = typeof height !== 'undefined' ? height : 300;
        this.effectiveParams = Object.assign({}, this.params);
        if (this.soundFile && (this.soundDuration <= 0 || isNaN(this.soundDuration)) && !isNaN(this.soundFile.duration) && this.soundFile.duration > 0)
            this.soundDuration = this.soundFile.duration;
        const duration = this.soundFile && !isNaN(this.soundFile.duration) && this.soundFile.duration > 0 ? this.soundFile.duration : this.soundDuration;
        const progress = this.soundFile && duration > 0 ? constrain(this.soundFile.currentTime / duration, 0, 1) : 0;
        const useArc = this.autoPerformance && this.soundFile && !this.soundFile.paused && duration > 0;

        if (this.autoPerformance && this.soundFile && !this.soundFile.paused && this.audioAnalyser) {
            const bands = this.getAudioBands();
            const s = this.audioSensitivity;
            const { bass, mids, highs, level, beat } = bands;
            const u = (key) => this.params[key];
            const mix = (base, reactive) => constrain(base * (1 - s) + reactive * s, 0, 1);
            this.effectiveParams.activity = mix(u('activity'), 0.15 + mids * 0.85 + beat * 0.35);
            this.effectiveParams.flocking = mix(u('flocking'), bass * 0.95 + mids * 0.4);
            this.effectiveParams.motionV = mix(u('motionV'), 0.1 + mids * 0.9 + beat * 0.4);
            this.effectiveParams.motionH = mix(u('motionH'), 0.1 + mids * 0.9 + beat * 0.4);
            this.effectiveParams.collapse = mix(u('collapse'), bass * 0.7 + beat * 0.25);
            this.effectiveParams.speed = mix(u('speed'), highs * 0.8 + mids * 0.3);
            this.effectiveParams.shape = mix(u('shape'), highs * 0.6 + level * 0.3);
            this.effectiveParams.zoom = mix(u('zoom'), 0.2 + (1 - level) * 0.5);
        }

        if (useArc) {
            const bands = (this.autoPerformance && this.audioAnalyser) ? this.getAudioBands() : null;
            const arc = this.getPerformanceArc(progress, bands);
            const arcBlend = 0.6;
            this.effectiveParams.flocking = this.effectiveParams.flocking * (1 - arcBlend) + arc.flocking * arcBlend;
            this.effectiveParams.collapse = this.effectiveParams.collapse * (1 - arcBlend) + arc.collapse * arcBlend;
            this.effectiveParams.activity = this.effectiveParams.activity * (1 - arcBlend) + arc.activity * arcBlend;
            this.effectiveParams.motionV = this.effectiveParams.motionV * (1 - arcBlend) + arc.motionV * arcBlend;
            this.effectiveParams.motionH = this.effectiveParams.motionH * (1 - arcBlend) + arc.motionH * arcBlend;
            this.effectiveParams.zoom = this.effectiveParams.zoom * (1 - arcBlend) + arc.zoom * arcBlend;
            this.effectiveParams.shape = this.effectiveParams.shape * (1 - arcBlend) + arc.shape * arcBlend;
            this.effectiveParams.speed = this.effectiveParams.speed * (1 - arcBlend) + arc.speed * arcBlend;
            this.marks.showShapeMarks = arc.shapeMarks;
            this.marks.showFanMarks = arc.fanMarks;
            this.marks.showMotionTrails = arc.trails;
            this.marks.showTipPlanes = arc.tipPlanes;
            if (progress < this._arcLastProgress - 0.05) this._arcLastProgress = progress;
            const activeCount = this.widgets.filter(w => !w.isExiting).length;
            const progressStep = 0.025;
            if (activeCount < arc.targetMoverCount && progress - this._arcLastProgress > progressStep) {
                this.addWidget();
                this._arcLastProgress = progress;
            } else if (activeCount > arc.targetMoverCount && this.widgets.length > 1 && progress - this._arcLastProgress > progressStep) {
                this.removeWidget();
                this._arcLastProgress = progress;
            }
            if (progress <= progressStep) this._arcLastProgress = Math.min(this._arcLastProgress, progress);
            const progressBucket = Math.floor(progress * 10) / 10;
            if (this.pane && typeof this.pane.refresh === 'function' && progressBucket !== this._arcLastRefreshProgress) {
                this._arcLastRefreshProgress = progressBucket;
                this.pane.refresh();
            }
        }

        const offMargin = 50;
        this.widgets = this.widgets.filter(widget => {
            if (!widget.isExiting) return true;
            return widget.x >= -offMargin && widget.x <= w + offMargin && widget.y >= -offMargin && widget.y <= h + offMargin;
        });
        this.widgets.forEach((widget, i) => { widget.index = i; });
        const active = this.widgets.filter(widget => !widget.isExiting);
        const leader = active[0];
        const p = this.effectiveParams;
        const extremeUnison = active.length > 1 &&
            p.shape < 0.5 &&
            p.speed < 0.5 &&
            p.motionH < 0.5 &&
            p.motionV < 0.5;

        let activeIndex = 0;
        this.widgets.forEach((w) => {
            if (w.isExiting) {
                w.x += w.exitVx;
                w.y += w.exitVy;
                return;
            }
            w.update(this.effectiveParams, activeIndex, active.length, leader);
            if (activeIndex > 0 && leader) {
                if (p.shape < 0.5) {
                    for (let a = 0; a < NUM_ARMS; a++) {
                        w.armPos[a] = leader.armPos[a];
                        w.armPosDraw[a] = leader.armPosDraw[a];
                    }
                }
                if (extremeUnison) {
                    w.vx = leader.vx;
                    w.vy = leader.vy;
                    w.baseVx = leader.baseVx;
                    w.baseVy = leader.baseVy;
                    w.angle = leader.angle;
                    w.rotationSpeed = leader.rotationSpeed;
                    for (let a = 0; a < NUM_ARMS; a++) w.armTimers[a] = leader.armTimers[a];
                    for (let a = 0; a < NUM_ARMS; a++) w.armSpeedIndex[a] = leader.armSpeedIndex[a];
                }
            }
            activeIndex++;
        });
        this.applyFlocking();
        this.applyCollapse();
        this.separateWidgets();
    }

    applyCollapse() {
        const active = this.widgets.filter(w => !w.isExiting);
        if (active.length === 0) return;
        const c = this.effectiveParams.collapse;
        const { cx, cy } = this.getStageCenterAndBounds();
        const collapseSmooth = 0.06; // velocity blend for smoother motion
        if (c >= 0.99) {
            active.forEach(widget => {
                const dx = cx - widget.x;
                const dy = cy - widget.y;
                widget.vx += dx * collapseSmooth;
                widget.vy += dy * collapseSmooth;
                widget.baseVx *= 0.92;
                widget.baseVy *= 0.92;
                widget.x += (cx - widget.x) * 0.08;
                widget.y += (cy - widget.y) * 0.08;
            });
            return;
        }
        if (c > 0) {
            active.forEach(widget => {
                const dx = cx - widget.x;
                const dy = cy - widget.y;
                const pull = c * 0.012;
                widget.vx += dx * pull;
                widget.vy += dy * pull;
            });
        }
        if (c < 0.25) {
            const spread = (0.25 - c) / 0.25;
            active.forEach((widget) => {
                const dx = widget.x - cx;
                const dy = widget.y - cy;
                const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
                const nudge = 0.04 * spread;
                widget.vx += (dx / d) * nudge;
                widget.vy += (dy / d) * nudge;
            });
        }
    }

    applyFlocking() {
        const active = this.widgets.filter(w => !w.isExiting);
        if (this.effectiveParams.flocking <= 0 || active.length < 2) return;
        const f = this.effectiveParams.flocking;
        const c = this.effectiveParams.collapse;
        const flockStrength = c > 0.85 ? f * 0.5 : f;
        let cx = 0, cy = 0, avx = 0, avy = 0;
        active.forEach(w => {
            cx += w.x;
            cy += w.y;
            avx += w.vx;
            avy += w.vy;
        });
        const n = active.length;
        cx /= n;
        cy /= n;
        avx /= n;
        avy /= n;
        const posBlend = 0.012 * flockStrength;
        const velBlend = 0.035 * flockStrength;
        active.forEach(w => {
            w.vx += (avx - w.vx) * velBlend;
            w.vy += (avy - w.vy) * velBlend;
            w.baseVx += (avx - w.baseVx) * velBlend * 0.8;
            w.baseVy += (avy - w.baseVy) * velBlend * 0.8;
            w.x += (cx - w.x) * posBlend;
            w.y += (cy - w.y) * posBlend;
        });
    }

    separateWidgets() {
        if (this.effectiveParams.collapse > 0.88) return;
        const active = this.widgets.filter(w => !w.isExiting);
        if (active.length < 2) return;
        const minDist = MIN_WIDGET_DIST;
        const repulsionX = this.widgets.map(() => 0);
        const repulsionY = this.widgets.map(() => 0);
        for (let i = 0; i < this.widgets.length; i++) {
            if (this.widgets[i].isExiting) continue;
            for (let j = i + 1; j < this.widgets.length; j++) {
                if (this.widgets[j].isExiting) continue;
                const a = this.widgets[i];
                const b = this.widgets[j];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
                if (d < minDist) {
                    const pushStrength = (minDist - d) * 0.12;
                    const nx = dx / d;
                    const ny = dy / d;
                    repulsionX[i] -= nx * pushStrength;
                    repulsionY[i] -= ny * pushStrength;
                    repulsionX[j] += nx * pushStrength;
                    repulsionY[j] += ny * pushStrength;
                }
            }
        }
        const w = typeof width !== 'undefined' ? width : 400;
        const h = typeof height !== 'undefined' ? height : 300;
        const b = getPlayBounds(w, h);
        const sepSmooth = 0.4;
        this.widgets.forEach((widget, i) => {
            if (widget.isExiting) return;
            widget.vx += repulsionX[i] * sepSmooth;
            widget.vy += repulsionY[i] * sepSmooth;
            widget.x = Math.max(b.minX, Math.min(b.maxX, widget.x + repulsionX[i] * 0.15));
            widget.y = Math.max(b.minY, Math.min(b.maxY, widget.y + repulsionY[i] * 0.15));
        });
    }

    draw() {
        if (!this._initialRepositionDone && typeof width !== 'undefined' && typeof height !== 'undefined' && width > 100 && height > 100 && this.widgets.length > 0) {
            this.repositionWidgets();
            this._initialRepositionDone = true;
        }
        background(255);
        this.drawGrid();
        this.drawTrails();
        this.drawShapeMarks();
        this.drawFanMarks();
        this.drawTipPlanes();
        this.widgets.forEach(w => w.draw(this.effectiveParams.zoom, this.effectiveParams));
    }
}

class Widget {
    constructor(x, y, index, params) {
        this.x = x;
        this.y = y;
        this.index = index;
        this.angle = (TWO_PI / 8) * index;
        this.rotationSpeed = 0.015;

        const baseSpeed = 0.14;
        const angle = (TWO_PI / 8) * index;
        this.vx = cos(angle) * baseSpeed + (random() - 0.5) * 0.08;
        this.vy = sin(angle) * baseSpeed + (random() - 0.5) * 0.08;
        this.baseVx = this.vx;
        this.baseVy = this.vy;

        // Three arms: like a clock with three hands; each can go clockwise (+1) or counterclockwise (-1)
        this.armPos = [];
        this.armPosDraw = [];
        this.armDirection = [];
        for (let a = 0; a < NUM_ARMS; a++) {
            this.armPos.push(floor(random(CLOCK_POSITIONS)));
            this.armPosDraw.push(this.armPos[a]);
            this.armDirection.push(random() < 0.5 ? 1 : -1);
        }
        // Speed: in difference mode each arm has a clearly different speed (slow/med/fast) so speed is obvious
        const speedPatterns = [[1, 2, 3], [2, 3, 1], [3, 1, 2], [1, 3, 2], [3, 2, 1], [2, 1, 3]];
        this.armSpeedIndexBase = speedPatterns[index % speedPatterns.length].slice();
        this.armSpeedIndex = [...this.armSpeedIndexBase];
        this.armTimers = [0, 0, 0];
        // Shape: in difference mode each widget deforms away from the basic sprite (offset + form variation)
        this.shapeOffset = (index * 5) % CLOCK_POSITIONS;
        this.deformArmLen = [0.72 + (index * 17 % 11) / 30, 0.88 + (index * 13 % 11) / 25, 1.15 + (index * 7 % 11) / 20];
        this.deformArmWidth = [0.6 + (index * 19 % 11) / 22, 1.25 + (index * 3 % 11) / 15, 0.75 + (index * 23 % 11) / 18];
        this.deformCenter = 0.82 + (index * 31 % 17) / 25;

        this.restTimer = 0;
        this.restDuration = 0;
        this.isResting = false;
        this.isExiting = false;
        this.exitVx = 0;
        this.exitVy = 0;
        this.trail = [];
        this.prevX = x;
        this.prevY = y;
        this.seed1 = random(1000);
        this.seed2 = random(1000);
    }

    sameShape(other) {
        for (let a = 0; a < NUM_ARMS; a++) if (this.armPos[a] !== other.armPos[a]) return false;
        return true;
    }

    sameArmSpeed() {
        const s = this.armSpeedIndex[0];
        if (s === 0) return false;
        for (let a = 1; a < NUM_ARMS; a++) if (this.armSpeedIndex[a] !== s) return false;
        return true;
    }

    update(params, index, totalWidgets, leader) {
        this.prevX = this.x;
        this.prevY = this.y;
        const dt = deltaTime || 16;
        const shapeVar = params.shape * (index / max(totalWidgets, 1));
        const speedVar = params.speed * (index / max(totalWidgets, 1));
        // Amplitude of motion variation: when toward difference, all widgets get strong sweep (not just later ones)
        const motionVVar = params.motionV > 0.5 ? params.motionV : params.motionV * (index / max(totalWidgets, 1));
        const motionHVar = params.motionH > 0.5 ? params.motionH : params.motionH * (index / max(totalWidgets, 1));

        // Motion sliders: sameness = move in same direction as leader; difference = each widget its own path
        if (params.motionH < 0.5 && params.motionV < 0.5 && leader && index > 0) {
            this.baseVx += (leader.baseVx - this.baseVx) * 0.03;
            this.baseVy += (leader.baseVy - this.baseVy) * 0.03;
        }

        // Speed: sameness = one shared rate and direction (all arms move together); difference = each arm its own speed/direction
        if (params.speed < 0.5) {
            const sameRate = 2; // fixed medium speed so all arms clearly move in lockstep
            for (let a = 0; a < NUM_ARMS; a++) this.armSpeedIndex[a] = sameRate;
        } else {
            for (let a = 0; a < NUM_ARMS; a++) this.armSpeedIndex[a] = this.armSpeedIndexBase[a];
        }
        const useSameDirection = params.speed < 0.5;

        // Advance each arm at clock-face positions (four speeds); each arm can go clockwise or counterclockwise
        for (let i = 0; i < NUM_ARMS; i++) {
            const ms = SPEED_MS[this.armSpeedIndex[i]];
            if (ms === Infinity) continue;
            this.armTimers[i] += dt;
            const dir = useSameDirection ? 1 : this.armDirection[i];
            while (this.armTimers[i] >= ms) {
                this.armTimers[i] -= ms;
                this.armPos[i] = (this.armPos[i] + dir + CLOCK_POSITIONS) % CLOCK_POSITIONS;
            }
            // Smooth interpolation so arms don’t jump between clock positions
            let delta = this.armPos[i] - this.armPosDraw[i];
            if (delta > CLOCK_POSITIONS / 2) delta -= CLOCK_POSITIONS;
            if (delta < -CLOCK_POSITIONS / 2) delta += CLOCK_POSITIONS;
            this.armPosDraw[i] += delta * 0.08;
            this.armPosDraw[i] = (this.armPosDraw[i] % CLOCK_POSITIONS + CLOCK_POSITIONS) % CLOCK_POSITIONS;
        }

        // Activity: less = more pausing (at extreme "less" almost pause everything); more = less pausing. restAmount = 1 - activity
        const restAmount = 1 - (params.activity ?? 0.5);
        if (restAmount > 0.2) {
            this.restTimer += dt / 1000;
            const timeBeforeRest = 0.15 + (1 - restAmount) * 2.5;   // at restAmount=1: move ~0.15s then rest; at 0.25: move ~2.1s
            const restDurationMin = 2 + restAmount * 18;            // at restAmount=1: rest 18–22s; at 0.25: rest ~6s
            if (this.isResting) {
                if (this.restTimer > this.restDuration) {
                    this.isResting = false;
                    this.restTimer = 0;
                    this.restDuration = restDurationMin + random(4);
                }
            } else {
                if (this.restTimer > timeBeforeRest) {
                    this.isResting = true;
                    this.restTimer = 0;
                    this.restDuration = restDurationMin + random(4);
                }
            }
        } else {
            this.isResting = false;
        }

        if (!this.isResting) {
            const motionSame = params.motionH < 0.5 && params.motionV < 0.5;
            let targetVx, targetVy;
            if (motionSame && leader && index > 0) {
                targetVx = leader.baseVx;
                targetVy = leader.baseVy;
            } else {
                const t = millis() * 0.001;
                const n = max(totalWidgets, 1);
                const hPhase = (index / n) * TWO_PI;
                const vPhase = (index / n) * TWO_PI;
                // Difference mode: amplitude for visible sweep; sameness: minimal variation (reduced for slower max speed)
                const motionHMult = params.motionH > 0.5 ? 1.6 : 0.06;
                const motionVMult = params.motionV > 0.5 ? 1.6 : 0.06;
                const motionAmp = 0.9;
                targetVx = this.baseVx + (sin(t + this.seed1) * motionHMult + sin(t * 0.5 + hPhase) * motionHMult * 0.6) * motionHVar * motionAmp;
                targetVy = this.baseVy + (cos(t + this.seed2) * motionVMult + cos(t * 0.5 + vPhase) * motionVMult * 0.6) * motionVVar * motionAmp;
            }
            const smooth = 0.07;
            this.vx += (targetVx - this.vx) * smooth;
            this.vy += (targetVy - this.vy) * smooth;
            this.x += this.vx;
            this.y += this.vy;
            const w = typeof width !== 'undefined' ? width : 400;
            const h = typeof height !== 'undefined' ? height : 300;
            const b = getPlayBounds(w, h);
            if (this.x < b.minX) {
                this.x = b.minX;
                this.vx = max(0, this.vx);
                this.baseVx = max(0, this.baseVx);
            } else if (this.x > b.maxX) {
                this.x = b.maxX;
                this.vx = min(0, this.vx);
                this.baseVx = min(0, this.baseVx);
            }
            if (this.y < b.minY) {
                this.y = b.minY;
                this.vy = max(0, this.vy);
                this.baseVy = max(0, this.baseVy);
            } else if (this.y > b.maxY) {
                this.y = b.maxY;
                this.vy = min(0, this.vy);
                this.baseVy = min(0, this.baseVy);
            }
        }

        this.rotationSpeed += (0.015 - this.rotationSpeed) * 0.05;
        this.angle += this.rotationSpeed;
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    }

    drawFan(zoom) {
        push();
        translate(this.x, this.y);
        rotate(this.angle);
        const zoomVal = typeof zoom === 'number' ? zoom : 0.3;
        const scale = 0.35 + zoomVal * 1.0;
        // Obvious speed-alignment mark: thick stroke, bright blue, larger arc
        noFill();
        stroke(70, 110, 200);
        strokeWeight(3);
        const rMin = 22 * scale;
        const rMax = 42 * scale;
        for (let r = rMin; r <= rMax; r += 5 * scale) {
            arc(0, 0, r * 2, r * 2, 0, TWO_PI * 0.75);
        }
        pop();
    }

    drawTrail() {
        if (this.trail.length < 2) return;
        stroke(100, 130, 180, 140);
        strokeWeight(2);
        noFill();
        beginShape();
        this.trail.forEach(p => vertex(p.x, p.y));
        endShape();
    }

    getTipPositions(zoom, params) {
        const zoomVal = typeof zoom === 'number' ? zoom : 0.3;
        const scale = 0.35 + zoomVal * 1.0;
        const sizeMult = 2.2;
        const gridDotD = 2.2 * sizeMult;
        let centerDotD = gridDotD * 3.5;
        const baseLen = centerDotD * 2.65;
        const useShapeDiff = params && typeof params.shape === 'number' && params.shape > 0.5;
        const offset = useShapeDiff ? this.shapeOffset : 0;
        if (useShapeDiff) centerDotD *= this.deformCenter;
        const out = [];
        for (let i = 0; i < NUM_ARMS; i++) {
            const len = baseLen * (useShapeDiff ? this.deformArmLen[i] : 1);
            const pos = (this.armPosDraw[i] != null ? this.armPosDraw[i] : this.armPos[i]) + offset;
            const angle = (TWO_PI / CLOCK_POSITIONS) * (pos % CLOCK_POSITIONS);
            const lx = cos(angle) * len * scale;
            const ly = sin(angle) * len * scale;
            const wx = this.x + cos(this.angle) * lx - sin(this.angle) * ly;
            const wy = this.y + sin(this.angle) * lx + cos(this.angle) * ly;
            out.push({ x: wx, y: wy });
        }
        return out;
    }

    draw(zoom, params) {
        push();
        translate(this.x, this.y);
        rotate(this.angle);
        const zoomVal = typeof zoom === 'number' ? zoom : 0.3;
        const scale = 0.35 + zoomVal * 1.0;
        const sizeMult = 2.2; // widget scale (larger = bigger widgets)
        // Reference proportions: central dot 3–4× grid dot; arm length 2–2.5× central dot; arm widest 1/3–1/2 central dot
        const gridDotD = 2.2 * sizeMult;
        let centerDotD = gridDotD * 3.5;
        const baseLen = centerDotD * 2.65;
        let baseWidth = centerDotD * 0.15;
        let midWidth = centerDotD * 0.45;
        const tipDotD = gridDotD * 1.1;

        // Shape: when difference is high, deform away from basic sprite (offset + form variation)
        const useShapeDiff = params && typeof params.shape === 'number' && params.shape > 0.5;
        const offset = useShapeDiff ? this.shapeOffset : 0;
        if (useShapeDiff) centerDotD *= this.deformCenter;

        // Central solid black dot (#000000)
        fill(0);
        noStroke();
        ellipse(0, 0, centerDotD * scale, centerDotD * scale);

        // Three arms/legs: narrow at center, widen toward middle, taper to point at tip; grey dot at tip. In shape-diff, deform length/width per arm.
        for (let i = 0; i < NUM_ARMS; i++) {
            const len = baseLen * (useShapeDiff ? this.deformArmLen[i] : 1);
            const armBaseW = baseWidth * (useShapeDiff ? this.deformArmWidth[i] : 1);
            const armMidW = midWidth * (useShapeDiff ? this.deformArmWidth[i] : 1);
            const pos = (this.armPosDraw[i] != null ? this.armPosDraw[i] : this.armPos[i]) + offset;
            const angle = (TWO_PI / CLOCK_POSITIONS) * (pos % CLOCK_POSITIONS);
            const tipX = cos(angle) * len * scale;
            const tipY = sin(angle) * len * scale;
            const midX = cos(angle) * len * scale * 0.5;
            const midY = sin(angle) * len * scale * 0.5;
            const perpX = -sin(angle);
            const perpY = cos(angle);

            const bHalf = (armBaseW * scale) / 2;
            const mHalf = (armMidW * scale) / 2;

            fill(0);
            noStroke();
            beginShape();
            vertex(0 + perpX * bHalf, 0 + perpY * bHalf);
            vertex(midX + perpX * mHalf, midY + perpY * mHalf);
            vertex(tipX, tipY);
            vertex(midX - perpX * mHalf, midY - perpY * mHalf);
            vertex(0 - perpX * bHalf, 0 - perpY * bHalf);
            endShape(CLOSE);

            fill(211, 211, 211);
            ellipse(tipX, tipY, tipDotD * scale, tipDotD * scale);
        }
        pop();
    }
}
