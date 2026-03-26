// ComfyVFX Color Picker extension
// Adds a visual hue wheel + SV square to the color picker node
// Only shows when node is selected
import { app } from "/scripts/app.js";

const EXT_NAME = "ComfyVFX.ColorPicker";
console.log(`[${EXT_NAME}] loading`);

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }

function hsvToRgb(h, s, v) {
    const c = v * s;
    const hh = (h / 60) % 6;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (0 <= hh && hh < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (1 <= hh && hh < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (2 <= hh && hh < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (3 <= hh && hh < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (4 <= hh && hh < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }
    const m = v - c;
    return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d === 0) h = 0;
    else if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * (((b - r) / d) + 2);
    else h = 60 * (((r - g) / d) + 4);
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    return [h, s, v];
}

function createPickerContainer() {
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.zIndex = "100";
    container.style.width = "200px";
    container.style.pointerEvents = "auto";
    container.style.transformOrigin = "top left";
    container.style.display = "none"; // Hidden by default

    // Preview swatch
    const preview = document.createElement("div");
    preview.style.width = "40px";
    preview.style.height = "40px";
    preview.style.border = "2px solid #fff";
    preview.style.borderRadius = "6px";
    preview.style.marginTop = "8px";
    preview.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

    // Canvas for hue ring + SV square
    const wheel = document.createElement("canvas");
    const baseSize = 200;
    const dpr = window.devicePixelRatio || 1;
    wheel.style.width = `${baseSize}px`;
    wheel.style.height = `${baseSize}px`;
    wheel.width = Math.round(baseSize * dpr);
    wheel.height = Math.round(baseSize * dpr);
    wheel.style.display = "block";
    wheel.style.cursor = "crosshair";

    container.appendChild(wheel);
    container.appendChild(preview);
    
    const canvas = app.canvas?.canvas;
    const canvasContainer = canvas?.parentElement || document.body;
    canvasContainer.appendChild(container);
    
    return { container, wheel, preview };
}

function drawHueRingAndSV(canvas, hueDeg, s, v) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 200;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    
    const cx = w / 2, cy = h / 2;
    const outer = Math.min(cx, cy) - 4;
    const ringThickness = 16;
    const inner = outer - ringThickness;

    // Draw hue ring
    if (typeof ctx.createConicGradient === 'function') {
        const cg = ctx.createConicGradient(-Math.PI/2, cx, cy);
        cg.addColorStop(0/6, '#ff0000');
        cg.addColorStop(1/6, '#ffff00');
        cg.addColorStop(2/6, '#00ff00');
        cg.addColorStop(3/6, '#00ffff');
        cg.addColorStop(4/6, '#0000ff');
        cg.addColorStop(5/6, '#ff00ff');
        cg.addColorStop(1, '#ff0000');
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill('evenodd');
    } else {
        // Fallback for older browsers
        for (let angle = 0; angle < 360; angle += 2) {
            const startAngle = (angle - 90) * Math.PI / 180;
            const endAngle = (angle + 2 - 90) * Math.PI / 180;
            const [rr, gg, bb] = hsvToRgb(angle, 1, 1);
            ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
            ctx.beginPath();
            ctx.arc(cx, cy, outer, startAngle, endAngle);
            ctx.arc(cx, cy, inner, endAngle, startAngle, true);
            ctx.closePath();
            ctx.fill();
        }
    }

    // Hue marker on ring
    const hueAngle = (hueDeg - 90) * Math.PI / 180;
    const hueMarkerR = (outer + inner) / 2;
    const hmx = cx + Math.cos(hueAngle) * hueMarkerR;
    const hmy = cy + Math.sin(hueAngle) * hueMarkerR;
    ctx.beginPath();
    ctx.arc(hmx, hmy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hmx, hmy, 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();

    // SV square inside the ring
    const cornerGap = 10;
    const side = Math.max(1, (inner - cornerGap) * Math.sqrt(2));
    const topLeftX = cx - side / 2;
    const topLeftY = cy - side / 2;

    // Draw SV gradient
    const off = document.createElement("canvas");
    const pxSide = Math.max(1, Math.round(side * dpr));
    off.width = pxSide; off.height = pxSide;
    const octx = off.getContext("2d");
    const img = octx.createImageData(pxSide, pxSide);
    for (let yy = 0; yy < pxSide; yy++) {
        const V = 1 - (yy / (pxSide - 1));
        for (let xx = 0; xx < pxSide; xx++) {
            const S = xx / (pxSide - 1);
            const [rr, gg, bb] = hsvToRgb(hueDeg, S, V);
            const idx = (yy * pxSide + xx) * 4;
            img.data[idx] = rr; img.data[idx+1] = gg; img.data[idx+2] = bb; img.data[idx+3] = 255;
        }
    }
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, topLeftX, topLeftY, side, side);

    // SV marker
    const svx = topLeftX + s * side;
    const svy = topLeftY + (1 - v) * side;
    ctx.beginPath();
    ctx.arc(svx, svy, 6, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(svx, svy, 4, 0, Math.PI * 2);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.stroke();

    return { cx, cy, outer, inner, side, topLeftX, topLeftY };
}

function positionContainer(node, container) {
    const ds = app.canvas?.ds;
    const canvas = app.canvas?.canvas;
    if (!ds || !canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const scale = ds.scale || 1;
    const [offX, offY] = ds.offset || [0, 0];

    const nodeX = (node.pos[0] + offX) * scale + rect.left;
    const nodeY = (node.pos[1] + offY) * scale + rect.top;
    const gap = 12;

    container.style.left = `${nodeX}px`;
    container.style.top = `${nodeY + node.size[1] * scale + gap}px`;
    container.style.transform = `scale(${scale})`;
}

function isNodeSelected(node) {
    const selectedNodes = app.canvas?.selected_nodes;
    if (!selectedNodes) return false;
    // selected_nodes is an object with node ids as keys
    return selectedNodes[node.id] !== undefined;
}

function attachPicker(node) {
    if (node.__vfx_color_picker__) return node.__vfx_color_picker__;

    const { container, wheel, preview } = createPickerContainer();

    let h = 0, s = 1, v = 1;
    let geometry = null;

    function redraw() {
        geometry = drawHueRingAndSV(wheel, h, s, v);
        const [r, g, b] = hsvToRgb(h, s, v);
        preview.style.background = `rgb(${r},${g},${b})`;
    }

    function updateWidgets() {
        const [r, g, b] = hsvToRgb(h, s, v);
        preview.style.background = `rgb(${r},${g},${b})`;
        
        const widgets = node.widgets || [];
        const wm = Object.fromEntries(widgets.map(w => [w.name, w]));
        if (wm.red && wm.green && wm.blue) {
            wm.red.value = r;
            wm.green.value = g;
            wm.blue.value = b;
            app.graph?.setDirtyCanvas(true, true);
        }
        redraw();
    }

    // Initialize from widget values
    function syncFromWidgets() {
        const widgets = node.widgets || [];
        const wm = Object.fromEntries(widgets.map(w => [w.name, w]));
        const r = wm.red?.value ?? 255;
        const g = wm.green?.value ?? 128;
        const b = wm.blue?.value ?? 0;
        [h, s, v] = rgbToHsv(r, g, b);
        redraw();
    }
    
    function updateVisibility() {
        const selected = isNodeSelected(node);
        container.style.display = selected ? "block" : "none";
    }

    syncFromWidgets();

    function handlePointer(ev) {
        const rect = wheel.getBoundingClientRect();
        const ds = app.canvas?.ds;
        const scale = ds?.scale || 1;
        const x = (ev.clientX - rect.left) / scale;
        const y = (ev.clientY - rect.top) / scale;
        
        if (!geometry) return false;
        
        const dx = x - geometry.cx;
        const dy = y - geometry.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Hue ring
        if (dist <= geometry.outer && dist >= geometry.inner) {
            let ang = Math.atan2(dy, dx) * 180 / Math.PI + 90;
            if (ang < 0) ang += 360;
            h = ang;
            updateWidgets();
            return true;
        }

        // SV square
        if (x >= geometry.topLeftX && x <= geometry.topLeftX + geometry.side &&
            y >= geometry.topLeftY && y <= geometry.topLeftY + geometry.side) {
            s = clamp((x - geometry.topLeftX) / geometry.side, 0, 1);
            v = 1 - clamp((y - geometry.topLeftY) / geometry.side, 0, 1);
            updateWidgets();
            return true;
        }
        
        return false;
    }

    function dragStart(ev) {
        if (!handlePointer(ev)) return;
        const move = (e) => handlePointer(e);
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    }

    wheel.addEventListener('mousedown', dragStart);

    // Watch for widget changes from sliders
    const widgets = node.widgets || [];
    for (const w of widgets) {
        if (['red', 'green', 'blue'].includes(w.name)) {
            const origCallback = w.callback;
            w.callback = function(value) {
                if (origCallback) origCallback.call(this, value);
                syncFromWidgets();
            };
        }
    }

    node.__vfx_color_picker__ = { container, wheel, preview, syncFromWidgets, updateVisibility };
    return node.__vfx_color_picker__;
}

app.registerExtension({
    name: EXT_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData, _app) {
        if (nodeData.name !== "ComfyVFX_ColorPicker") return;

        const onDrawForeground = nodeType.prototype.onDrawForeground;
        nodeType.prototype.onDrawForeground = function(ctx) {
            const r = onDrawForeground?.apply(this, arguments);
            const picker = attachPicker(this);
            picker.updateVisibility();
            if (isNodeSelected(this)) {
                positionContainer(this, picker.container);
            }
            return r;
        };

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            const r = onNodeCreated?.apply(this, arguments);
            attachPicker(this);
            return r;
        };

        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function() {
            const r = onConfigure?.apply(this, arguments);
            if (this.__vfx_color_picker__) {
                this.__vfx_color_picker__.syncFromWidgets();
            }
            return r;
        };
        
        const onSelected = nodeType.prototype.onSelected;
        nodeType.prototype.onSelected = function() {
            const r = onSelected?.apply(this, arguments);
            if (this.__vfx_color_picker__) {
                this.__vfx_color_picker__.updateVisibility();
            }
            return r;
        };
        
        const onDeselected = nodeType.prototype.onDeselected;
        nodeType.prototype.onDeselected = function() {
            const r = onDeselected?.apply(this, arguments);
            if (this.__vfx_color_picker__) {
                this.__vfx_color_picker__.updateVisibility();
            }
            return r;
        };

        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (this.__vfx_color_picker__) {
                try { this.__vfx_color_picker__.container.remove(); } catch {}
                this.__vfx_color_picker__ = null;
            }
            return onRemoved?.apply(this, arguments);
        };
    }
});
