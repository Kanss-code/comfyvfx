import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

app.registerExtension({
    name: "ComfyVFX.VideoLoader",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_VideoLoader") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            this.videoInfo = null;
            this.cropRect = { x:0, y:0, w:0, h:0 };
            this.cropDragging = false;
            this.cropHandle = null;
            this.cropDragStart = null;
            this.cropAspectLock = false;
            this.cropAspectRatio = 16/9;
            
            const S = { bd:"#333350", tx:"#c8c8d8", dim:"#777790", ac:"#4a9eff", dg:"#c0392b", btn:"#2d2d44", r:"4px" };
            const bS = `border:none;border-radius:${S.r};cursor:pointer;`;
            
            // Container
            this.container = document.createElement("div");
            this.container.style.cssText = "display:flex;flex-direction:column;gap:4px;width:100%;";
            
            // Upload row
            const uR = document.createElement("div");
            uR.style.cssText = "display:flex;justify-content:center;padding:2px 0;margin-top:8px;";
            this.uploadBtn = document.createElement("button");
            this.uploadBtn.textContent = "Load Video";
            this.uploadBtn.style.cssText = `${bS}background:#555;color:#ddd;font-weight:600;padding:6px 20px;font-size:12px;`;
            this.fileInput = document.createElement("input");
            this.fileInput.type = "file";
            this.fileInput.accept = "video/*,.mp4,.avi,.mov,.mkv,.webm,.flv,.wmv,.m4v,.gif";
            this.fileInput.style.display = "none";
            this.uploadBtn.addEventListener("click", () => this.fileInput.click());
            this.fileInput.addEventListener("change", async (e) => {
                const file = e.target.files[0]; if (!file) return;
                this.uploadBtn.textContent = "Uploading..."; this.uploadBtn.style.opacity = "0.6";
                try {
                    const fd = new FormData(); fd.append("image", file, file.name); fd.append("overwrite", "true");
                    const r = await api.fetchApi("/upload/image", { method: "POST", body: fd });
                    if (r.ok) { const d = await r.json(); const fn = d.name || file.name;
                        const vw = this.widgets?.find(w => w.name === "video");
                        if (vw) { if (vw.options?.values && !vw.options.values.includes(fn)) vw.options.values.push(fn); vw.value = fn; if (vw.callback) vw.callback(fn); }
                        this._loadVideoPreview(fn);
                        this.uploadBtn.textContent = "Loaded";
                    } else { this.uploadBtn.textContent = "Failed"; }
                } catch { this.uploadBtn.textContent = "Error"; }
                this.uploadBtn.style.opacity = "1";
                setTimeout(() => { this.uploadBtn.textContent = "Load Video"; }, 2500);
                this.fileInput.value = "";
            });
            uR.append(this.uploadBtn, this.fileInput);
            
            // Info
            this.infoBar = document.createElement("div");
            this.infoBar.style.cssText = `color:${S.dim};font-size:10px;text-align:center;padding:1px 0;`;
            this.infoBar.textContent = "No video loaded";
            
            // Video element for preview playback
            this.videoEl = document.createElement("video");
            this.videoEl.controls = false;
            this.videoEl.loop = true;
            this.videoEl.muted = true;
            this.videoEl.autoplay = true;
            this._audioMuted = false; // user preference — false means audio plays on hover
            this.videoEl.style.cssText = `width:100%;border-radius:${S.r};background:#0a0a14;display:none;`;
            this.videoEl.addEventListener("loadedmetadata", () => {
                this.videoEl.style.display = "block";
                this._autoResize();
            });
            this.videoEl.addEventListener("error", () => {
                console.warn("[VideoLoader] Video element error");
            });
            
            // Wrapper for video + crop overlay
            this.previewWrap = document.createElement("div");
            this.previewWrap.style.cssText = `position:relative;width:100%;border:1px solid ${S.bd};border-radius:${S.r};overflow:hidden;`;
            
            // Audio on hover — unmute when mouse enters, mute when it leaves
            this.previewWrap.addEventListener("mouseenter", () => {
                if (!this._audioMuted) this.videoEl.muted = false;
            });
            this.previewWrap.addEventListener("mouseleave", () => {
                this.videoEl.muted = true;
            });
            
            // Canvas overlays the video for crop drawing (transparent background)
            this.cropCanvas = document.createElement("canvas");
            this.cropCanvas.width = 640;
            this.cropCanvas.height = 360;
            this.cropCanvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair;display:none;";
            this.cropCanvas.addEventListener("mousedown", (e) => this._onCropMouseDown(e));
            this.cropCanvas.addEventListener("mousemove", (e) => this._onCropMouseMove(e));
            this.cropCanvas.addEventListener("mouseup", () => this._onCropMouseUp());
            this.cropCanvas.addEventListener("mouseleave", () => this._onCropMouseUp());
            
            this.previewWrap.append(this.videoEl, this.cropCanvas);
            
            // Crop row
            const cR = document.createElement("div");
            cR.style.cssText = "display:flex;gap:3px;align-items:center;justify-content:center;padding:2px 0;";
            this._aspectBtns = [];
            for (const a of [{l:"Free",r:0},{l:"16:9",r:16/9},{l:"9:16",r:9/16},{l:"4:3",r:4/3},{l:"1:1",r:1},{l:"2.39",r:2.39}]) {
                const b = document.createElement("button"); b.textContent = a.l;
                b.style.cssText = `${bS}padding:3px 7px;font-size:9px;background:${S.btn};color:${S.dim};border:1px solid ${S.bd};`;
                b.addEventListener("click", () => {
                    if (a.r === 0) this.cropAspectLock = false;
                    else { this.cropAspectLock = true; this.cropAspectRatio = a.r; this._enforceAspectRatio(); }
                    this._updateAspectBtnStyles(a.r);
                    this._drawCropCanvas();
                    this._syncCropToWidget();
                });
                cR.appendChild(b); this._aspectBtns.push({ btn: b, ratio: a.r });
            }
            const sep = document.createElement("span"); sep.style.cssText = `color:${S.bd};margin:0 2px;`; sep.textContent = "|"; cR.appendChild(sep);
            const rB = document.createElement("button"); rB.textContent = "Reset";
            rB.style.cssText = `${bS}padding:3px 7px;font-size:9px;background:${S.dg};color:#fff;`;
            rB.addEventListener("click", () => {
                this.cropRect = {x:0,y:0,w:0,h:0}; this.cropAspectLock = false;
                this._updateAspectBtnStyles(0); this._syncCropToWidget();
                if (this._cropModeActive) this._exitCropMode();
            });
            cR.appendChild(rB);
            
            // Edit Crop button — toggles between crop canvas and video playback
            this.editCropBtn = document.createElement("button");
            this.editCropBtn.textContent = "Crop";
            this.editCropBtn.style.cssText = `${bS}padding:3px 7px;font-size:9px;background:${S.btn};color:${S.dim};border:1px solid ${S.bd};`;
            this._cropModeActive = false;
            this.editCropBtn.addEventListener("click", () => {
                if (this._cropModeActive) {
                    this._exitCropMode();
                } else {
                    this._enterCropMode();
                }
            });
            cR.appendChild(this.editCropBtn);
            
            // Output res
            const oR = document.createElement("div");
            oR.style.cssText = `display:flex;gap:4px;align-items:center;justify-content:center;font-size:10px;color:${S.dim};padding:1px 0;`;
            const oL = document.createElement("span"); oL.textContent = "Output:";
            this.outputResLabel = document.createElement("span");
            this.outputResLabel.style.cssText = `color:${S.ac};font-weight:600;font-family:Consolas,monospace;`;
            this.outputResLabel.textContent = "\u2014";
            const swapBtn = document.createElement("button");
            swapBtn.textContent = "\u21C4";
            swapBtn.title = "Swap width and height";
            swapBtn.style.cssText = `${bS}padding:1px 6px;font-size:12px;background:${S.btn};color:${S.dim};border:1px solid ${S.bd};`;
            swapBtn.addEventListener("click", () => {
                const wW = this.widgets?.find(x => x.name === "output_width");
                const wH = this.widgets?.find(x => x.name === "output_height");
                if (wW && wH) {
                    const tmp = wW.value;
                    wW.value = wH.value;
                    wH.value = tmp;
                    if (wW.callback) wW.callback(wW.value);
                    if (wH.callback) wH.callback(wH.value);
                    this._updateOutputResLabel();
                    app.graph?.setDirtyCanvas(true, true);
                }
            });
            oR.append(oL, this.outputResLabel, swapBtn);
            
            // Playback controls (for video element)
            const pR = document.createElement("div");
            pR.style.cssText = "display:flex;gap:3px;align-items:center;justify-content:center;padding:2px 0;";
            const bPB = `${bS}padding:4px 7px;font-size:13px;background:${S.btn};color:${S.tx};min-width:28px;text-align:center;`;
            const mkB = (t, tip, fn) => { const b = document.createElement("button"); b.textContent = t; b.title = tip; b.style.cssText = bPB; b.addEventListener("click", fn); return b; };
            
            // --- Helpers to read the selected frame range from widgets ---
            const _getRange = () => {
                const fps = this.videoInfo?.fps || 24;
                const totalSource = this.videoInfo?.frame_count || 0;
                const sf = parseInt(this.widgets?.find(w => w.name === "start_frame")?.value) || 0;
                const nf = parseInt(this.widgets?.find(w => w.name === "num_frames")?.value) || 0;
                const endFrame = (nf > 0 && sf + nf < totalSource) ? sf + nf : totalSource;
                return {
                    startTime: sf / fps,
                    endTime:   endFrame / fps,
                    startFrame: sf,
                    frameCount: endFrame - sf,
                    fps,
                    totalSource,
                };
            };

            pR.appendChild(mkB("\u23EE","Start",() => { const r = _getRange(); this.videoEl.currentTime = r.startTime; }));
            pR.appendChild(mkB("-10","Back 10 frames",() => { const r = _getRange(); this.videoEl.currentTime = Math.max(r.startTime, this.videoEl.currentTime - 10/r.fps); }));
            pR.appendChild(mkB("\u25C0","Prev frame",() => { const r = _getRange(); this.videoEl.currentTime = Math.max(r.startTime, this.videoEl.currentTime - 1/r.fps); }));
            this.playPauseBtn = mkB("\u25B6","Play/Pause",() => {
                const r = _getRange();
                // If at or past end of range, reset to start of range before playing
                if (this.videoEl.currentTime >= r.endTime - 0.01 || this.videoEl.currentTime < r.startTime) {
                    this.videoEl.currentTime = r.startTime;
                }
                if (this.videoEl.paused) this.videoEl.play();
                else this.videoEl.pause();
            });
            this.playPauseBtn.style.cssText += `background:${S.ac};color:#fff;min-width:34px;`;
            pR.appendChild(this.playPauseBtn);
            pR.appendChild(mkB("\u25B6","Next frame",() => { const r = _getRange(); this.videoEl.currentTime = Math.min(r.endTime, this.videoEl.currentTime + 1/r.fps); }));
            pR.appendChild(mkB("+10","Fwd 10 frames",() => { const r = _getRange(); this.videoEl.currentTime = Math.min(r.endTime, this.videoEl.currentTime + 10/r.fps); }));
            pR.appendChild(mkB("\u23ED","End",() => { const r = _getRange(); this.videoEl.currentTime = r.endTime; }));
            
            // Mute toggle
            this.muteBtn = document.createElement("button");
            this.muteBtn.textContent = "\uD83D\uDD0A"; // speaker icon
            this.muteBtn.title = "Toggle audio preview (does not affect audio output)";
            this.muteBtn.style.cssText = `${bPB}font-size:11px;`;
            this.muteBtn.addEventListener("click", () => {
                this._audioMuted = !this._audioMuted;
                this.muteBtn.textContent = this._audioMuted ? "\uD83D\uDD07" : "\uD83D\uDD0A";
                this.muteBtn.style.color = this._audioMuted ? "#777790" : S.tx;
                if (this._audioMuted) this.videoEl.muted = true;
            });
            pR.appendChild(this.muteBtn);
            
            // Frame label
            this.frameInfo = document.createElement("div");
            this.frameInfo.style.cssText = `color:${S.dim};font-size:10px;text-align:center;font-family:Consolas,monospace;padding:1px 0;`;
            this.frameInfo.textContent = "";
            
            // Update frame counter during playback — show position within selected range
            this.videoEl.addEventListener("timeupdate", () => {
                const r = _getRange();
                const currentFrame = Math.round(this.videoEl.currentTime * r.fps);
                const displayFrame = Math.max(0, currentFrame - r.startFrame);
                this.frameInfo.textContent = `${displayFrame} / ${r.frameCount}`;
                this.playPauseBtn.textContent = this.videoEl.paused ? "\u25B6" : "\u23F8";
                
                // Auto-pause and loop back when reaching end of selected range
                if (!this.videoEl.paused && this.videoEl.currentTime >= r.endTime - 0.01) {
                    this.videoEl.currentTime = r.startTime;
                }
            });
            
            // Assemble
            this.container.append(uR, this.infoBar, this.previewWrap, cR, oR, pR, this.frameInfo);
            this.addDOMWidget("video_preview", "div", this.container, { serialize: false, hideOnZoom: false });
            this.setSize([420, 500]);
            this._videoLoaded = false;
            
            // Hide crop_data widget
            const hideWidgets = () => { for (const w of this.widgets || []) { if (w.name === "crop_data") { if (w.element) w.element.style.display = "none"; if (w.inputEl) w.inputEl.style.display = "none"; w.computeSize = () => [0, -4]; w.type = "converted-widget"; } } };
            setTimeout(hideWidgets, 50); setTimeout(hideWidgets, 200); setTimeout(hideWidgets, 500);
            
            // Watch video widget and load preview on init
            setTimeout(() => {
                const vw = this.widgets?.find(w => w.name === "video");
                if (vw) {
                    const origCb = vw.callback;
                    vw.callback = (value) => { if (origCb) origCb.call(vw, value); this._loadVideoPreview(value); };
                    if (vw.value && vw.value !== "none") this._loadVideoPreview(vw.value);
                }
            }, 300);
        };
        
        // Load video into the <video> element via streaming endpoint
        nodeType.prototype._loadVideoPreview = function(filename) {
            if (!filename || filename === "none") return;
            
            // Load video info
            fetch(api.apiURL(`/comfyvfx/video_info?filename=${encodeURIComponent(filename)}`))
                .then(r => r.ok ? r.json() : null)
                .then(info => {
                    if (!info) return;
                    this.videoInfo = info;
                    this.infoBar.textContent = `${info.width}\u00D7${info.height}  |  ${info.fps} fps  |  ${info.frame_count} frames  |  ${info.codec}`;
                    this._updateOutputResLabel();
                    
                    // Auto-fill num_frames: if -1 or 0, set to source frame count
                    const nfW = this.widgets?.find(w => w.name === "num_frames");
                    if (nfW && (nfW.value === -1 || nfW.value <= 0)) {
                        nfW.value = info.frame_count;
                    }
                    
                    // Auto-fill fps_override: if 0 (default), set to source fps
                    const fpsW = this.widgets?.find(w => w.name === "fps_override");
                    if (fpsW && (fpsW.value === 0 || fpsW.value <= 0)) {
                        fpsW.value = info.fps;
                    }
                    
                    app.graph?.setDirtyCanvas(true, true);
                }).catch(() => {});
            
            // Stream video into <video> element
            const url = api.apiURL(`/comfyvfx/video_stream?filename=${encodeURIComponent(filename)}&width=640`);
            this.videoEl.src = url;
            this.videoEl.style.display = "block";
            this._videoLoaded = true;
            this._autoResize();
        };
        
        // Crop mode — show transparent crop canvas overlay on top of playing video
        nodeType.prototype._enterCropMode = function() {
            if (!this._videoLoaded || !this.videoInfo) return;
            this._cropModeActive = true;
            this.editCropBtn.textContent = "Done";
            this.editCropBtn.style.background = "#4a9eff";
            this.editCropBtn.style.color = "#fff";
            
            // Size canvas to match video display
            const srcW = this.videoInfo.width;
            const srcH = this.videoInfo.height;
            const rect = this.videoEl.getBoundingClientRect();
            this.cropCanvas.width = Math.round(rect.width) || 640;
            this.cropCanvas.height = Math.round(rect.height) || 360;
            this._cropScale = this.cropCanvas.width / srcW;
            
            this.cropCanvas.style.display = "block";
            this._drawCropCanvas();
        };
        
        nodeType.prototype._exitCropMode = function() {
            this._cropModeActive = false;
            this.editCropBtn.textContent = "Crop";
            this.editCropBtn.style.background = "#2d2d44";
            this.editCropBtn.style.color = "#777790";
            this.cropCanvas.style.display = "none";
        };
        
        nodeType.prototype._drawCropCanvas = function() {
            const c = this.cropCanvas, ctx = c.getContext("2d");
            
            // Clear to transparent — video shows through
            ctx.clearRect(0, 0, c.width, c.height);
            
            if (this.cropRect.w > 0 && this.cropRect.h > 0) {
                const sc = this._cropScale || (c.width / (this.videoInfo?.width || c.width));
                const cx = this.cropRect.x * sc, cy = this.cropRect.y * sc;
                const cw = this.cropRect.w * sc, ch = this.cropRect.h * sc;
                
                // Darken outside crop area
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); ctx.rect(cx, cy, cw, ch); ctx.fill("evenodd");
                
                // Crop border
                ctx.strokeStyle = "#4a9eff"; ctx.lineWidth = 2; ctx.strokeRect(cx, cy, cw, ch);
                
                // Corner handles
                ctx.fillStyle = "#4a9eff";
                for (const [hx,hy] of [[cx,cy],[cx+cw,cy],[cx,cy+ch],[cx+cw,cy+ch]]) ctx.fillRect(hx-4, hy-4, 8, 8);
                
                // Dimension text (source pixels)
                ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = "bold 13px Consolas,monospace"; ctx.textAlign = "center";
                ctx.fillText(`${Math.round(this.cropRect.w)} \u00D7 ${Math.round(this.cropRect.h)}`, cx+cw/2, cy+ch/2+5);
            }
        };
        
        // Auto resize
        nodeType.prototype._autoResize = function() {
            let nativeH = 0;
            for (const w of this.widgets || []) { if (w.name === "video_preview" || w.type === "converted-widget") continue; nativeH += 28; }
            const nodeW = this.size?.[0] || 420;
            let previewH = 220;
            if (this.videoEl.videoWidth > 0 && this.videoEl.videoHeight > 0) {
                previewH = (nodeW - 16) * this.videoEl.videoHeight / this.videoEl.videoWidth;
            } else if (this.videoInfo?.width > 0) {
                previewH = (nodeW - 16) * this.videoInfo.height / this.videoInfo.width;
            }
            const controlsH = 36 + 18 + 28 + 18 + 34 + 18 + 16; // upload, info, crop, output, playback, frame, padding
            const headerH = 26 + 6 * 20; // title + output dots
            this.setSize([nodeW, headerH + nativeH + previewH + controlsH]);
            app.graph?.setDirtyCanvas(true, true);
        };
        
        // Crop mouse handlers — map canvas display coords to source video coords
        nodeType.prototype._c2v = function(mx, my) {
            const r = this.cropCanvas.getBoundingClientRect();
            const srcW = this.videoInfo?.width || this.cropCanvas.width;
            const srcH = this.videoInfo?.height || this.cropCanvas.height;
            const scaleX = srcW / r.width;
            const scaleY = srcH / r.height;
            return { x: Math.max(0, Math.min(srcW, mx * scaleX)), y: Math.max(0, Math.min(srcH, my * scaleY)) };
        };
        nodeType.prototype._hitH = function(mx, my) {
            if (this.cropRect.w <= 0) return null;
            const p = this._c2v(mx, my);
            const { x:cx, y:cy, w:cw, h:ch } = this.cropRect;
            const srcW = this.videoInfo?.width || 1920;
            const hs = 30 * (srcW / (this.cropCanvas.getBoundingClientRect().width || 400)); // scale hit area
            for (const {n,x:hx,y:hy} of [{n:'tl',x:cx,y:cy},{n:'tr',x:cx+cw,y:cy},{n:'bl',x:cx,y:cy+ch},{n:'br',x:cx+cw,y:cy+ch}])
                if (Math.abs(p.x-hx)<hs && Math.abs(p.y-hy)<hs) return n;
            if (p.x>=cx && p.x<=cx+cw && p.y>=cy && p.y<=cy+ch) return 'move';
            return null;
        };
        nodeType.prototype._onCropMouseDown = function(e) {
            const r = this.cropCanvas.getBoundingClientRect();
            const mx = e.clientX-r.left, my = e.clientY-r.top;
            const h = this._hitH(mx, my);
            if (h) { this.cropDragging=true; this.cropHandle=h; this.cropDragStart={mx,my,rect:{...this.cropRect}}; }
            else { const p=this._c2v(mx,my); this.cropRect={x:p.x,y:p.y,w:0,h:0}; this.cropDragging=true; this.cropHandle='br'; this.cropDragStart={mx,my,rect:{...this.cropRect}}; }
        };
        nodeType.prototype._onCropMouseMove = function(e) {
            if (!this.cropDragging) return;
            const r = this.cropCanvas.getBoundingClientRect();
            const mx = e.clientX-r.left, my = e.clientY-r.top;
            const p = this._c2v(mx, my), sp = this._c2v(this.cropDragStart.mx, this.cropDragStart.my);
            const dx = p.x-sp.x, dy = p.y-sp.y;
            const iW = this.videoInfo?.width || 1920, iH = this.videoInfo?.height || 1080;
            const s = this.cropDragStart.rect;
            if (this.cropHandle === 'move') { this.cropRect.x=Math.max(0,Math.min(iW-s.w,s.x+dx)); this.cropRect.y=Math.max(0,Math.min(iH-s.h,s.y+dy)); }
            else {
                let {x,y,w,h} = s;
                if (this.cropHandle==='br'||this.cropHandle==='tr') w=Math.max(10,s.w+dx);
                if (this.cropHandle==='bl'||this.cropHandle==='tl'){x=s.x+dx;w=Math.max(10,s.w-dx);}
                if (this.cropHandle==='bl'||this.cropHandle==='br') h=Math.max(10,s.h+dy);
                if (this.cropHandle==='tl'||this.cropHandle==='tr'){y=s.y+dy;h=Math.max(10,s.h-dy);}
                x=Math.max(0,x);y=Math.max(0,y);w=Math.min(w,iW-x);h=Math.min(h,iH-y);
                if (this.cropAspectLock&&this.cropAspectRatio>0){const th=w/this.cropAspectRatio;if(th<=iH-y)h=th;else{h=iH-y;w=h*this.cropAspectRatio;}}
                this.cropRect={x,y,w:Math.round(w),h:Math.round(h)};
            }
            this._drawCropCanvas();
        };
        nodeType.prototype._onCropMouseUp = function() {
            if (this.cropDragging) {
                this.cropDragging=false; this.cropHandle=null;
                if (this.cropRect.w<0){this.cropRect.x+=this.cropRect.w;this.cropRect.w=-this.cropRect.w;}
                if (this.cropRect.h<0){this.cropRect.y+=this.cropRect.h;this.cropRect.h=-this.cropRect.h;}
                if (this.cropRect.w<10||this.cropRect.h<10) this.cropRect={x:0,y:0,w:0,h:0};
                this._syncCropToWidget(); this._drawCropCanvas();
            }
        };
        nodeType.prototype._enforceAspectRatio = function() { if (!this.cropAspectLock||this.cropRect.w<=0) return; this.cropRect.h = Math.round(this.cropRect.w/this.cropAspectRatio); };
        nodeType.prototype._updateAspectBtnStyles = function(ar) { for (const {btn:b,ratio:r} of this._aspectBtns) { const a=(r===ar)||(r===0&&!this.cropAspectLock); b.style.background=a?"#4a9eff":"#2d2d44"; b.style.color=a?"#fff":"#777790"; b.style.borderColor=a?"#4a9eff":"#333350"; } };
        nodeType.prototype._syncCropToWidget = function() {
            const d = JSON.stringify({x:Math.round(this.cropRect.x),y:Math.round(this.cropRect.y),w:Math.round(this.cropRect.w),h:Math.round(this.cropRect.h)});
            const w = this.widgets?.find(x=>x.name==="crop_data"); if(w) w.value=d; this._updateOutputResLabel();
        };
        nodeType.prototype._updateOutputResLabel = function() {
            const ow=this.widgets?.find(x=>x.name==="output_width")?.value||0,oh=this.widgets?.find(x=>x.name==="output_height")?.value||0;
            if (ow>0&&oh>0) this.outputResLabel.textContent=`${ow} \u00D7 ${oh} (scaled)`;
            else if (this.cropRect.w>0) this.outputResLabel.textContent=`${Math.round(this.cropRect.w)} \u00D7 ${Math.round(this.cropRect.h)} (crop)`;
            else if (this.videoInfo) this.outputResLabel.textContent=`${this.videoInfo.width} \u00D7 ${this.videoInfo.height} (source)`;
            else this.outputResLabel.textContent="\u2014";
        };
        
        // onExecuted — update info from Python results
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(msg) {
            if (onExecuted) onExecuted.apply(this, arguments);
            if (msg?.video_info?.[0]) {
                this.videoInfo = msg.video_info[0];
                this.infoBar.textContent = `${this.videoInfo.width}\u00D7${this.videoInfo.height}  |  ${this.videoInfo.fps} fps  |  ${this.videoInfo.frame_count} frames  |  ${this.videoInfo.codec}`;
                this._updateOutputResLabel();
            }
        };
        
        // onConfigure — restore state when loading workflow
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => {
                const w = this.widgets?.find(x=>x.name==="crop_data");
                if (w?.value && w.value !== "{}") { try { const c=JSON.parse(w.value); if(c.w>0&&c.h>0) this.cropRect=c; } catch{} }
                const vw = this.widgets?.find(x=>x.name==="video");
                if (vw?.value && vw.value !== "none") this._loadVideoPreview(vw.value);
            }, 300);
        };
        
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (onRemoved) onRemoved.apply(this, arguments);
            this.videoEl.pause(); this.videoEl.src = "";
        };
    },
});
