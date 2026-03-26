import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

/**
 * ComfyVFX Layer Compositor — Live Preview
 *
 * After the first execution, per-layer frames are cached client-side.
 * When layer settings (opacity, offset, scale, blend mode) or compositor
 * settings (background color) change, the preview is re-composited
 * entirely in JS — no re-execution needed.
 *
 * A full Python re-execution is only required when:
 *   - Layer inputs are added/removed (click Update Layers)
 *   - Upstream image data changes (new generation)
 */

app.registerExtension({
    name: "ComfyVFX.LayerCompositor",
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_LayerCompositor") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            // Add Update Layers button
            this.addWidget("button", "Update Layers", null, () => {
                this.updateLayers();
            });
            
            // Preview container
            this.previewContainer = document.createElement("div");
            this.previewContainer.style.cssText = "display: flex; flex-direction: column; gap: 8px; padding: 8px;";
            
            // Canvas for live compositing
            this.previewCanvas = document.createElement("canvas");
            this.previewCanvas.style.cssText = "width: 100%; border: 1px solid #444; border-radius: 4px; image-rendering: auto; display: none;";
            
            // Fallback image for Python-rendered preview
            this.previewImage = document.createElement("img");
            this.previewImage.style.cssText = "width: 100%; border: 1px solid #444; border-radius: 4px; display: none;";
            
            // Placeholder
            this.placeholder = document.createElement("div");
            this.placeholder.style.cssText = "width: 100%; height: 200px; border: 1px solid #444; border-radius: 4px; background: #1a1a1a; display: flex; align-items: center; justify-content: center; color: #666;";
            this.placeholder.textContent = "Run workflow to see preview";
            
            // Live indicator
            this.liveIndicator = document.createElement("div");
            this.liveIndicator.style.cssText = "display: none; text-align: center; font-size: 10px; color: #e8793a; padding: 2px;";
            this.liveIndicator.textContent = "\u25cf LIVE PREVIEW";
            
            // Playback controls
            this.playbackContainer = document.createElement("div");
            this.playbackContainer.style.cssText = "display: flex; gap: 8px; align-items: center; justify-content: center;";
            
            const btnStyle = "padding: 6px 12px; background: #4a4a4a; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;";
            
            this.prevFrameBtn = document.createElement("button");
            this.prevFrameBtn.textContent = "\u23EE";
            this.prevFrameBtn.style.cssText = btnStyle;
            this.prevFrameBtn.addEventListener("click", () => this.prevFrame());
            
            this.playPauseBtn = document.createElement("button");
            this.playPauseBtn.textContent = "\u25B6";
            this.playPauseBtn.style.cssText = btnStyle + " min-width: 40px;";
            this.playPauseBtn.addEventListener("click", () => this.togglePlayback());
            
            this.nextFrameBtn = document.createElement("button");
            this.nextFrameBtn.textContent = "\u23ED";
            this.nextFrameBtn.style.cssText = btnStyle;
            this.nextFrameBtn.addEventListener("click", () => this.nextFrame());
            
            this.frameLabel = document.createElement("span");
            this.frameLabel.textContent = "Frame: 0/0";
            this.frameLabel.style.cssText = "color: #ccc; font-size: 12px; min-width: 100px;";
            
            this.playbackContainer.appendChild(this.prevFrameBtn);
            this.playbackContainer.appendChild(this.playPauseBtn);
            this.playbackContainer.appendChild(this.nextFrameBtn);
            this.playbackContainer.appendChild(this.frameLabel);
            
            // Info
            this.infoDisplay = document.createElement("div");
            this.infoDisplay.style.cssText = "color: #888; font-size: 11px; text-align: center;";
            
            this.previewContainer.appendChild(this.placeholder);
            this.previewContainer.appendChild(this.previewCanvas);
            this.previewContainer.appendChild(this.previewImage);
            this.previewContainer.appendChild(this.liveIndicator);
            this.previewContainer.appendChild(this.playbackContainer);
            this.previewContainer.appendChild(this.infoDisplay);
            
            // State
            this.allFrames = [];
            this.currentFrame = 0;
            this.isPlaying = false;
            this.playbackInterval = null;
            
            // -- Live compositing state --
            this._layerImages = {};        // { layerNum: [Image(), ...] }
            this._layerData = {};          // { layerNum: { blend_mode, opacity, ... } }
            this._bgColor = [0, 0, 0];
            this._compWidth = 512;
            this._compHeight = 512;
            this._numFrames = 60;
            this._layerNums = [];
            this._liveReady = false;
            this._hookedWidgets = new Set();
            this._compositeDebounce = null;
            
            this.addDOMWidget("preview", "div", this.previewContainer, { serialize: false, hideOnZoom: false });
            this.setSize([350, 500]);
        };
        
        // ============================================================
        // Update layer inputs
        // ============================================================
        
        nodeType.prototype.updateLayers = function() {
            const layerCountWidget = this.widgets.find(w => w.name === "layer_count");
            if (!layerCountWidget) return;
            
            const targetCount = layerCountWidget.value;
            const currentInputs = this.inputs ? this.inputs.filter(i => i.name.startsWith("layer_") && i.type === "COMPOSITOR_LAYER").length : 0;
            
            if (currentInputs === targetCount) return;
            
            if (currentInputs > targetCount) {
                for (let i = currentInputs; i > targetCount; i--) {
                    const idx = this.inputs.findIndex(inp => inp.name === `layer_${i}`);
                    if (idx >= 0) this.removeInput(idx);
                }
            } else {
                for (let i = currentInputs + 1; i <= targetCount; i++) {
                    this.addInput(`layer_${i}`, "COMPOSITOR_LAYER");
                }
            }
            
            this.setDirtyCanvas(true, true);
        };
        
        // ============================================================
        // Playback controls
        // ============================================================
        
        nodeType.prototype.togglePlayback = function() {
            if (this.isPlaying) this.stopPlayback();
            else this.startPlayback();
        };
        
        nodeType.prototype.startPlayback = function() {
            const totalFrames = this._liveReady ? this._numFrames : this.allFrames.length;
            if (totalFrames <= 1) return;
            this.isPlaying = true;
            this.playPauseBtn.textContent = "\u23F8";
            this.playbackInterval = setInterval(() => this.nextFrame(), 1000 / 24);
        };
        
        nodeType.prototype.stopPlayback = function() {
            this.isPlaying = false;
            this.playPauseBtn.textContent = "\u25B6";
            if (this.playbackInterval) {
                clearInterval(this.playbackInterval);
                this.playbackInterval = null;
            }
        };
        
        nodeType.prototype.nextFrame = function() {
            const totalFrames = this._liveReady ? this._numFrames : this.allFrames.length;
            if (totalFrames === 0) return;
            this.currentFrame = (this.currentFrame + 1) % totalFrames;
            this._syncFrameToConnectedNodes();
            this._showCurrentFrame();
        };
        
        nodeType.prototype.prevFrame = function() {
            const totalFrames = this._liveReady ? this._numFrames : this.allFrames.length;
            if (totalFrames === 0) return;
            this.currentFrame = (this.currentFrame - 1 + totalFrames) % totalFrames;
            this._syncFrameToConnectedNodes();
            this._showCurrentFrame();
        };
        
        // Sync compositor's current frame to all connected Layer and Camera nodes
        nodeType.prototype._syncFrameToConnectedNodes = function() {
            if (!this.inputs) return;
            const totalFrames = this._liveReady ? this._numFrames : this.allFrames.length;
            
            for (let i = 0; i < this.inputs.length; i++) {
                const input = this.inputs[i];
                if (!input.link) continue;
                
                // Only sync to layer and camera inputs
                if (!input.name.startsWith("layer_") && input.name !== "camera") continue;
                
                const linkInfo = app.graph.links[input.link];
                if (!linkInfo) continue;
                
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode) continue;
                
                // Update the connected node's keyframe current frame
                if (sourceNode.kfCurrentFrame !== undefined) {
                    sourceNode.kfCurrentFrame = this.currentFrame;
                    sourceNode.kfTotalFrames = totalFrames;
                    // Refresh their diamond display and frame label
                    if (sourceNode._updateFrameDisplay) sourceNode._updateFrameDisplay();
                    if (sourceNode.refreshAllDiamonds) sourceNode.refreshAllDiamonds();
                }
            }
        };
        
        // ============================================================
        // Display: show fallback OR live composite
        // ============================================================
        
        // Show Python-rendered fallback image
        nodeType.prototype._showFallbackFrame = function() {
            if (this.allFrames.length === 0) {
                this.placeholder.style.display = "flex";
                this.previewImage.style.display = "none";
                this.previewCanvas.style.display = "none";
                this.liveIndicator.style.display = "none";
                this.frameLabel.textContent = "Frame: 0/0";
                return;
            }
            
            this.placeholder.style.display = "none";
            this.previewCanvas.style.display = "none";
            this.liveIndicator.style.display = "none";
            
            const imgInfo = this.allFrames[Math.min(this.currentFrame, this.allFrames.length - 1)];
            if (imgInfo && imgInfo.filename) {
                const url = api.apiURL(`/view?filename=${encodeURIComponent(imgInfo.filename)}&subfolder=${encodeURIComponent(imgInfo.subfolder || "")}&type=${imgInfo.type}&t=${Date.now()}`);
                this.previewImage.src = url;
                this.previewImage.style.display = "block";
            }
            
            this.frameLabel.textContent = `Frame: ${this.currentFrame + 1}/${this.allFrames.length}`;
        };
        
        // Show live-composited frame via canvas
        nodeType.prototype._showLiveFrame = function() {
            this.placeholder.style.display = "none";
            this.previewImage.style.display = "none";
            this.previewCanvas.style.display = "block";
            this.liveIndicator.style.display = "block";
            
            this._compositeFrame(this.currentFrame);
            
            this.frameLabel.textContent = `Frame: ${this.currentFrame + 1}/${this._numFrames}`;
        };
        
        // Router: pick live or fallback
        nodeType.prototype._showCurrentFrame = function() {
            if (this._liveReady) {
                this._showLiveFrame();
            } else {
                this._showFallbackFrame();
            }
        };
        
        // Legacy alias
        nodeType.prototype.updatePreviewImage = function() {
            this._showCurrentFrame();
        };
        
        // ============================================================
        // Client-side compositing engine
        // ============================================================
        
        nodeType.prototype._compositeFrame = function(frameIdx) {
            const canvas = this.previewCanvas;
            const w = this._compWidth;
            const h = this._compHeight;
            
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }
            
            const ctx = canvas.getContext("2d");
            
            // Read latest bg color from connected node
            this._readLiveBgColor();
            
            // Background fill
            const bg = this._bgColor;
            ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
            ctx.fillRect(0, 0, w, h);
            
            // Read live settings from connected layer nodes
            const liveSettings = this._readLiveLayerSettings();
            
            // Composite each layer
            for (let li = 0; li < this._layerNums.length; li++) {
                const layerNum = this._layerNums[li];
                const images = this._layerImages[layerNum];
                if (!images || images.length === 0) continue;
                
                // Live settings from connected node → fallback to execution-time values
                const settings = liveSettings[layerNum] || this._layerData[layerNum] || {};
                
                const opacity = (settings.opacity !== undefined && settings.opacity !== null) ? settings.opacity : 1.0;
                const offsetX = settings.offset_x || 0.0;
                const offsetY = settings.offset_y || 0.0;
                const scale = (settings.scale !== undefined && settings.scale !== null && settings.scale > 0) ? settings.scale : 1.0;
                const blendMode = settings.blend_mode || "normal";
                const startFrame = settings.start_frame || 0;
                
                if (opacity <= 0) continue;
                
                const layerFrameIdx = frameIdx - startFrame;
                if (layerFrameIdx < 0) continue;
                
                const actualIdx = Math.min(layerFrameIdx, images.length - 1);
                if (actualIdx < 0) continue;
                
                const img = images[actualIdx];
                if (!img || !img.complete || img.naturalWidth === 0) continue;
                
                // Calculate draw dimensions
                const imgW = img.naturalWidth;
                const imgH = img.naturalHeight;
                let drawW, drawH;
                
                if (scale !== 1.0) {
                    drawW = Math.round(imgW * scale);
                    drawH = Math.round(imgH * scale);
                } else if (imgW !== w || imgH !== h) {
                    // Aspect-preserving center-fit
                    const fitScale = Math.min(w / imgW, h / imgH);
                    drawW = Math.round(imgW * fitScale);
                    drawH = Math.round(imgH * fitScale);
                } else {
                    drawW = imgW;
                    drawH = imgH;
                }
                
                const drawX = Math.round((w - drawW) / 2 + offsetX * w);
                const drawY = Math.round((h - drawH) / 2 + offsetY * h);
                
                // Set blend mode and opacity
                ctx.globalAlpha = opacity;
                ctx.globalCompositeOperation = this._cssBlendMode(blendMode);
                
                try {
                    ctx.drawImage(img, drawX, drawY, drawW, drawH);
                } catch (e) {
                    console.warn("[Compositor] drawImage failed for layer", layerNum, "frame", actualIdx, ":", e);
                }
            }
            
            // Reset context
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = "source-over";
        };
        
        nodeType.prototype._cssBlendMode = function(mode) {
            return {
                "normal": "source-over",
                "add": "lighter",
                "screen": "screen",
                "multiply": "multiply",
                "overlay": "overlay",
            }[mode] || "source-over";
        };
        
        // ============================================================
        // Read live settings from connected layer nodes
        // ============================================================
        
        nodeType.prototype._readLiveLayerSettings = function() {
            const settings = {};
            if (!this.inputs) return settings;
            
            for (let i = 0; i < this.inputs.length; i++) {
                const input = this.inputs[i];
                if (!input.name.startsWith("layer_") || input.type !== "COMPOSITOR_LAYER") continue;
                
                const layerNum = parseInt(input.name.split("_")[1]);
                if (isNaN(layerNum) || !input.link) continue;
                
                const linkInfo = app.graph.links[input.link];
                if (!linkInfo) continue;
                
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode || !sourceNode.widgets) continue;
                
                const s = {};
                for (const w of sourceNode.widgets) {
                    switch (w.name) {
                        case "opacity": s.opacity = w.value; break;
                        case "offset_x": s.offset_x = w.value; break;
                        case "offset_y": s.offset_y = w.value; break;
                        case "scale": s.scale = w.value; break;
                        case "blend_mode": s.blend_mode = w.value; break;
                        case "start_frame": s.start_frame = w.value; break;
                    }
                }
                
                // Apply keyframe interpolation if the layer node has keyframes
                if (sourceNode.paramKeyframes && typeof sourceNode.paramKeyframes === "object") {
                    const frame = this.currentFrame;
                    const total = this._liveReady ? this._numFrames : this.allFrames.length;
                    for (const [paramName, kfs] of Object.entries(sourceNode.paramKeyframes)) {
                        if (!kfs || kfs.length === 0) continue;
                        // Interpolate
                        const sorted = kfs.slice().sort((a, b) => a.frame - b.frame);
                        if (sorted[0].frame > 0) sorted.unshift({ frame: 0, value: sorted[0].value, easing: "linear" });
                        if (total > 1 && sorted[sorted.length - 1].frame < total - 1) sorted.push({ frame: total - 1, value: sorted[sorted.length - 1].value, easing: "linear" });
                        
                        let before = sorted[0], after = sorted[sorted.length - 1];
                        for (let j = 0; j < sorted.length - 1; j++) {
                            if (sorted[j].frame <= frame && frame <= sorted[j + 1].frame) {
                                before = sorted[j]; after = sorted[j + 1]; break;
                            }
                        }
                        const fs = before.frame || 0, fe = after.frame || 0;
                        let t = (fe === fs) ? 0 : (frame - fs) / (fe - fs);
                        // Apply easing
                        const easing = before.easing || "linear";
                        if (easing === "ease_in") t = t * t;
                        else if (easing === "ease_out") t = 1 - (1 - t) * (1 - t);
                        else if (easing === "ease_in_out") t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                        
                        const val = (before.value ?? 0) + ((after.value ?? 0) - (before.value ?? 0)) * t;
                        s[paramName] = val;
                    }
                }
                
                settings[layerNum] = s;
            }
            
            return settings;
        };
        
        // ============================================================
        // Read live background color from connected color node
        // ============================================================
        
        nodeType.prototype._readLiveBgColor = function() {
            if (!this.inputs) return;
            
            for (let i = 0; i < this.inputs.length; i++) {
                const input = this.inputs[i];
                if (input.name !== "background_color") continue;
                if (!input.link) return;
                
                const linkInfo = app.graph.links[input.link];
                if (!linkInfo) return;
                
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode || !sourceNode.widgets) return;
                
                // Search all widgets for a color value
                for (const w of sourceNode.widgets) {
                    const val = w.value;
                    if (val && typeof val === "string" && val.startsWith("#") && val.length >= 7) {
                        const r = parseInt(val.slice(1, 3), 16);
                        const g = parseInt(val.slice(3, 5), 16);
                        const b = parseInt(val.slice(5, 7), 16);
                        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
                            this._bgColor = [r, g, b];
                            return;
                        }
                    }
                }
                return;
            }
        };
        
        // ============================================================
        // Debounced live re-composite on widget change
        // ============================================================
        
        nodeType.prototype._triggerLiveComposite = function() {
            if (!this._liveReady) return;
            
            if (this._compositeDebounce) clearTimeout(this._compositeDebounce);
            this._compositeDebounce = setTimeout(() => {
                this._showLiveFrame();
            }, 16);
        };
        
        // ============================================================
        // Hook widget callbacks on connected nodes
        // ============================================================
        
        nodeType.prototype._setupWidgetListeners = function() {
            const compositorNode = this;
            if (!this.inputs) return;
            
            for (let i = 0; i < this.inputs.length; i++) {
                const input = this.inputs[i];
                if (!input.link) continue;
                
                const linkInfo = app.graph.links[input.link];
                if (!linkInfo) continue;
                
                const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                if (!sourceNode || !sourceNode.widgets) continue;
                
                for (const w of sourceNode.widgets) {
                    const watched = ["opacity", "offset_x", "offset_y", "scale",
                                     "blend_mode", "start_frame", "color", "value"];
                    if (!watched.includes(w.name) && w.type !== "color") continue;
                    
                    const hookKey = `${sourceNode.id}_${w.name}`;
                    if (this._hookedWidgets.has(hookKey)) continue;
                    this._hookedWidgets.add(hookKey);
                    
                    const origCb = w.callback;
                    w.callback = function(...args) {
                        if (origCb) origCb.apply(this, args);
                        compositorNode._triggerLiveComposite();
                    };
                }
            }
        };
        
        // ============================================================
        // Load per-layer images from flat lists
        // ============================================================
        
        nodeType.prototype._loadLayerImages = function(layerFrames, layerSettings) {
            this._layerImages = {};
            this._layerData = {};
            this._liveReady = false;
            
            // Parse layer_settings (flat list of {layer, blend_mode, opacity, ...})
            if (layerSettings && layerSettings.length > 0) {
                for (const s of layerSettings) {
                    this._layerData[s.layer] = {
                        blend_mode: s.blend_mode,
                        opacity: s.opacity,
                        start_frame: s.start_frame,
                        offset_x: s.offset_x,
                        offset_y: s.offset_y,
                        scale: s.scale,
                    };
                }
            }
            
            if (!layerFrames || layerFrames.length === 0) {
                console.log("[Compositor] No layer frames to load");
                return;
            }
            
            const compositorNode = this;
            const totalToLoad = layerFrames.length;
            let loaded = 0;
            
            console.log("[Compositor] Loading", totalToLoad, "layer frame images across", Object.keys(this._layerData).length, "layers...");
            
            // Group frames by layer number
            const framesByLayer = {};
            for (const f of layerFrames) {
                const ln = f.layer;
                if (!framesByLayer[ln]) framesByLayer[ln] = [];
                framesByLayer[ln].push(f);
            }
            
            // Pre-allocate arrays
            for (const [ln, arr] of Object.entries(framesByLayer)) {
                this._layerImages[ln] = new Array(arr.length);
            }
            
            const onAllLoaded = function() {
                compositorNode._liveReady = true;
                compositorNode._hookedWidgets.clear();
                compositorNode._setupWidgetListeners();
                compositorNode._showLiveFrame();
                console.log("[Compositor] Live preview ready:", Object.keys(compositorNode._layerImages).length, "layers,", loaded, "frames loaded");
            };
            
            for (const [lnStr, arr] of Object.entries(framesByLayer)) {
                const layerNum = parseInt(lnStr);
                const imgArr = this._layerImages[layerNum];
                
                for (let fi = 0; fi < arr.length; fi++) {
                    const imgInfo = arr[fi];
                    const frameIdx = imgInfo.frame !== undefined ? imgInfo.frame : fi;
                    const img = new Image();
                    const capturedIdx = frameIdx;
                    
                    img.onload = function() {
                        imgArr[capturedIdx] = img;
                        loaded++;
                        if (loaded >= totalToLoad) onAllLoaded();
                    };
                    img.onerror = function() {
                        console.warn("[Compositor] Failed to load layer", layerNum, "frame", capturedIdx, ":", imgInfo.filename);
                        loaded++;
                        if (loaded >= totalToLoad) onAllLoaded();
                    };
                    
                    img.src = api.apiURL(
                        `/view?filename=${encodeURIComponent(imgInfo.filename)}` +
                        `&subfolder=${encodeURIComponent(imgInfo.subfolder || "")}` +
                        `&type=${imgInfo.type}` +
                        `&t=${Date.now()}`
                    );
                    
                    imgArr[capturedIdx] = img;
                }
            }
        };
        
        // ============================================================
        // onExecuted — receive data from Python
        // ============================================================
        
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            
            console.log("[Compositor] onExecuted keys:", Object.keys(message || {}));
            
            // 1) Store Python composite preview frames
            if (message?.all_frames?.length > 0) {
                this.allFrames = message.all_frames;
                this.currentFrame = 0;
            }
            
            // 2) Store compositor metadata + bg color
            if (message?.compositor_info?.[0]) {
                const info = message.compositor_info[0];
                this._compWidth = info.width;
                this._compHeight = info.height;
                this._numFrames = info.num_frames;
                this._layerNums = info.layer_nums || [];
                this._bgColor = [info.bg_r || 0, info.bg_g || 0, info.bg_b || 0];
                this.infoDisplay.textContent = `${info.width}x${info.height} | ${info.num_frames} frames | ${info.num_layers} layers`;
            }
            
            // 3) ALWAYS show Python fallback immediately
            this._liveReady = false;
            this._showFallbackFrame();
            
            // 4) Check if any connected layer has keyframes
            // If so, DON'T use live mode — Python output has the correct keyframed values
            let hasKeyframes = false;
            if (this.inputs) {
                for (let i = 0; i < this.inputs.length; i++) {
                    const input = this.inputs[i];
                    if (!input.name.startsWith("layer_") || input.type !== "COMPOSITOR_LAYER" || !input.link) continue;
                    const linkInfo = app.graph.links[input.link];
                    if (!linkInfo) continue;
                    const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                    if (!sourceNode || !sourceNode.widgets) continue;
                    const kfWidget = sourceNode.widgets.find(w => w.name === "param_keyframes");
                    if (kfWidget && kfWidget.value && kfWidget.value !== "[]" && kfWidget.value !== "{}" && kfWidget.value.length > 4) {
                        hasKeyframes = true;
                        break;
                    }
                }
                // Also check camera
                for (let i = 0; i < this.inputs.length; i++) {
                    const input = this.inputs[i];
                    if (input.name !== "camera" || !input.link) continue;
                    const linkInfo = app.graph.links[input.link];
                    if (!linkInfo) continue;
                    const sourceNode = app.graph.getNodeById(linkInfo.origin_id);
                    if (!sourceNode || !sourceNode.widgets) continue;
                    const kfWidget = sourceNode.widgets.find(w => w.name === "param_keyframes");
                    if (kfWidget && kfWidget.value && kfWidget.value !== "[]" && kfWidget.value !== "{}" && kfWidget.value.length > 4) {
                        hasKeyframes = true;
                        break;
                    }
                }
            }
            
            if (hasKeyframes) {
                console.log("[Compositor] Keyframes detected — using Python-rendered frames (live preview disabled)");
                // Don't load layer images for live mode, just use fallback
                return;
            }
            
            // 5) Start loading per-layer images in background for live mode (no keyframes)
            const layerFrames = message?.layer_frames || [];
            const layerSettings = message?.layer_settings || [];
            console.log("[Compositor] layer_frames:", layerFrames.length, "layer_settings:", layerSettings.length);
            
            if (layerFrames.length > 0) {
                this._loadLayerImages(layerFrames, layerSettings);
            }
        };
        
        // ============================================================
        // Cleanup
        // ============================================================
        
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (onRemoved) onRemoved.apply(this, arguments);
            this.stopPlayback();
            if (this._compositeDebounce) clearTimeout(this._compositeDebounce);
        };
        
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => this.updateLayers(), 100);
        };
        
        const onConnectionsChange = nodeType.prototype.onConnectionsChange;
        nodeType.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
            if (onConnectionsChange) onConnectionsChange.apply(this, arguments);
            if (this._liveReady) {
                this._hookedWidgets.clear();
                this._setupWidgetListeners();
            }
        };
    },
});



// ═══════════════════════════════════════════════════════════════════════════
// CAMERA + LAYER — Per-Slider Keyframe System (DOM-based, matches openpose editor)
// ═══════════════════════════════════════════════════════════════════════════

const CAMERA_SLIDER_DEFAULTS = {
    pan_x: 0.0, pan_y: 0.0, zoom: 1.0, rotation: 0.0,
    shake_intensity: 0.0, shake_frequency: 1.0,
};

const LAYER_SLIDER_DEFAULTS = {
    opacity: 1.0, offset_x: 0.0, offset_y: 0.0, scale: 1.0,
};

function buildPerSliderKFNode(nodeType, DEFAULTS, domWidgetName) {
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
        if (onNodeCreated) onNodeCreated.apply(this, arguments);

        this.paramKeyframes = {};
        this.kfCurrentFrame = 0;
        this.kfTotalFrames = 60;
        this._kfInitialized = false;  // Flag to prevent reloading during active editing

        // DOM container
        this.kfEditorContainer = document.createElement("div");
        this.kfEditorContainer.style.cssText = "display: flex; flex-direction: column; gap: 2px; padding: 4px; background: #1e1e1e; border-radius: 4px;";

        // Frame controls
        const frameRow = document.createElement("div");
        frameRow.style.cssText = "display: flex; gap: 6px; align-items: center; justify-content: center; padding: 4px 0;";
        const prevBtn = document.createElement("button");
        prevBtn.textContent = "\u23EE"; prevBtn.style.cssText = "padding: 3px 8px; background: #4a4a4a; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;";
        prevBtn.addEventListener("click", () => { this.kfCurrentFrame = Math.max(0, this.kfCurrentFrame - 1); this._updateFrameDisplay(); this.refreshAllDiamonds(); });
        const nextBtn = document.createElement("button");
        nextBtn.textContent = "\u23ED"; nextBtn.style.cssText = "padding: 3px 8px; background: #4a4a4a; color: #fff; border: none; border-radius: 3px; cursor: pointer; font-size: 12px;";
        nextBtn.addEventListener("click", () => { this.kfCurrentFrame = Math.min(this.kfTotalFrames - 1, this.kfCurrentFrame + 1); this._updateFrameDisplay(); this.refreshAllDiamonds(); });
        this._frameLabel = document.createElement("span");
        this._frameLabel.style.cssText = "color: #ccc; font-size: 11px; min-width: 80px; text-align: center;";
        this._frameLabel.textContent = "Frame: 0/60";
        const totalInput = document.createElement("input");
        totalInput.type = "number"; totalInput.value = 60; totalInput.min = 1;
        totalInput.style.cssText = "width: 50px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; padding: 2px 4px; font-size: 10px; text-align: center;";
        totalInput.title = "Total frames";
        totalInput.addEventListener("change", () => { this.kfTotalFrames = Math.max(1, parseInt(totalInput.value) || 60); this._updateFrameDisplay(); this.refreshAllDiamonds(); });
        frameRow.append(prevBtn, this._frameLabel, nextBtn, totalInput);
        this.kfEditorContainer.appendChild(frameRow);

        // Build per-param slider rows with diamond tracks
        this._sliderWidgets = {};
        for (const [pName, pDefault] of Object.entries(DEFAULTS)) {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; align-items: center; gap: 4px; padding: 2px 4px; font-size: 11px;";
            const label = document.createElement("span");
            label.style.cssText = "color: #999; min-width: 90px; font-size: 10px;";
            label.textContent = pName.replace(/_/g, " ");

            const sliderWrap = document.createElement("div");
            sliderWrap.style.cssText = "flex: 1; position: relative; height: 18px; display: flex; align-items: center;";
            const slider = document.createElement("input");
            slider.type = "range";
            const nativeW = this.widgets?.find(x => x.name === pName);
            slider.min = nativeW?.options?.min ?? 0; slider.max = nativeW?.options?.max ?? 1; slider.step = 0.01;
            slider.value = nativeW?.value ?? pDefault;
            slider.style.cssText = "width: 100%; height: 4px; accent-color: #4a9eff; cursor: pointer; position: relative; z-index: 2;";
            const diamondLayer = document.createElement("div");
            diamondLayer.style.cssText = "position: absolute; top: 0; left: 8px; right: 8px; height: 100%; pointer-events: none; z-index: 3;";
            sliderWrap.append(slider, diamondLayer);

            const valDisplay = document.createElement("span");
            valDisplay.style.cssText = "color: #ddd; min-width: 36px; text-align: right; font-family: Consolas, monospace; font-size: 10px;";
            valDisplay.textContent = parseFloat(slider.value).toFixed(2);

            const kfBtn = document.createElement("span");
            kfBtn.textContent = "\u25C6"; kfBtn.style.cssText = "cursor: pointer; color: #555; font-size: 11px; padding: 0 1px; user-select: none;";
            kfBtn.title = "Add/remove keyframe at current frame";
            kfBtn.addEventListener("click", () => {
                this.toggleSliderKeyframe(pName, parseFloat(slider.value));
                this.refreshDiamonds(pName, diamondLayer);
                this._notifyCompositor();
            });

            slider.addEventListener("input", () => {
                const v = parseFloat(slider.value);
                valDisplay.textContent = v.toFixed(2);
                if (nativeW) { nativeW.value = v; }
                this.updateKeyframeValueAtCurrentFrame(pName, v);
                this._notifyCompositor();
            });
            slider.addEventListener("dblclick", () => {
                slider.value = pDefault; valDisplay.textContent = pDefault.toFixed(2);
                if (nativeW) { nativeW.value = pDefault; }
                this._notifyCompositor();
            });
            slider.title = "Double-click to reset. \u25C6 = keyframe.";

            row.append(label, sliderWrap, valDisplay, kfBtn);
            this.kfEditorContainer.appendChild(row);
            this._sliderWidgets[pName] = { slider, valDisplay, diamondLayer, nativeW };
        }

        // Clear All button
        const clearRow = document.createElement("div");
        clearRow.style.cssText = "display: flex; gap: 8px; justify-content: center; padding: 4px 0;";
        const clearBtn = document.createElement("button");
        clearBtn.textContent = "Clear All Keyframes";
        clearBtn.style.cssText = "padding: 4px 12px; font-size: 10px; border: none; border-radius: 3px; cursor: pointer; background: #8B0000; color: white;";
        clearBtn.addEventListener("click", () => { this.paramKeyframes = {}; this.syncParamKeyframesToWidget(); this.refreshAllDiamonds(); });
        clearRow.appendChild(clearBtn);
        this.kfEditorContainer.appendChild(clearRow);

        this.addDOMWidget(domWidgetName, "div", this.kfEditorContainer, { serialize: false, hideOnZoom: false });

        // Hide native slider widgets + param_keyframes
        setTimeout(() => {
            for (const w of this.widgets || []) {
                if (w.name === "param_keyframes" || DEFAULTS[w.name] !== undefined) {
                    if (w.element) w.element.style.display = "none";
                    if (w.inputEl) w.inputEl.style.display = "none";
                    w.computeSize = () => [0, -4];
                }
            }
            for (const [pName, sw] of Object.entries(this._sliderWidgets)) {
                if (sw.nativeW) { sw.slider.value = sw.nativeW.value; sw.valDisplay.textContent = parseFloat(sw.nativeW.value).toFixed(2); }
            }
            this.loadParamKeyframesFromWidget();
        }, 100);
    };

    nodeType.prototype._updateFrameDisplay = function() {
        if (this._frameLabel) this._frameLabel.textContent = `Frame: ${this.kfCurrentFrame}/${this.kfTotalFrames}`;
    };

    // Find connected Compositor node and trigger its live preview refresh
    nodeType.prototype._notifyCompositor = function() {
        // Debounce: only refresh every 30ms to avoid stuttering during slider drag
        if (this._notifyDebounce) return;
        this._notifyDebounce = true;
        requestAnimationFrame(() => {
            this._notifyDebounce = false;
            if (!this.outputs) return;
            for (const output of this.outputs) {
                if (!output.links) continue;
                for (const linkId of output.links) {
                    const linkInfo = app.graph.links[linkId];
                    if (!linkInfo) continue;
                    const targetNode = app.graph.getNodeById(linkInfo.target_id);
                    if (!targetNode) continue;
                    if (targetNode._showCurrentFrame && targetNode._liveReady) {
                        targetNode._showCurrentFrame();
                        return;
                    }
                }
            }
        });
    };

    nodeType.prototype.toggleSliderKeyframe = function(paramName, value) {
        if (!this.paramKeyframes) this.paramKeyframes = {};
        if (!this.paramKeyframes[paramName]) this.paramKeyframes[paramName] = [];
        const kfs = this.paramKeyframes[paramName];
        const existIdx = kfs.findIndex(k => k.frame === this.kfCurrentFrame);
        if (existIdx >= 0) {
            // Update existing keyframe value at this frame
            kfs[existIdx].value = value;
        } else {
            // Add new keyframe
            kfs.push({ frame: this.kfCurrentFrame, value, easing: "linear" });
            kfs.sort((a, b) => a.frame - b.frame);
        }
        this.syncParamKeyframesToWidget();
    };
    
    nodeType.prototype.removeSliderKeyframe = function(paramName, frame) {
        if (!this.paramKeyframes?.[paramName]) return;
        const kfs = this.paramKeyframes[paramName];
        const idx = kfs.findIndex(k => k.frame === frame);
        if (idx >= 0) {
            kfs.splice(idx, 1);
            if (kfs.length === 0) delete this.paramKeyframes[paramName];
        }
        this.syncParamKeyframesToWidget();
    };

    nodeType.prototype.updateKeyframeValueAtCurrentFrame = function(paramName, value) {
        if (!this.paramKeyframes?.[paramName]) return;
        const kf = this.paramKeyframes[paramName].find(k => k.frame === this.kfCurrentFrame);
        if (kf) { kf.value = value; this.syncParamKeyframesToWidget(); }
    };

    nodeType.prototype.refreshDiamonds = function(paramName, diamondLayer) {
        if (!diamondLayer) return;
        diamondLayer.replaceChildren();
        const total = this.kfTotalFrames || 60;
        const kfs = this.paramKeyframes?.[paramName] || [];
        for (const kf of kfs) {
            const pct = total > 1 ? (kf.frame / (total - 1)) * 100 : 50;
            const isCurrent = kf.frame === this.kfCurrentFrame;
            const d = document.createElement("div");
            d.style.cssText = `position: absolute; top: 50%; left: ${pct}%; width: 7px; height: 7px; background: ${isCurrent ? "#ffcc00" : "#e8a020"}; transform: translate(-50%, -50%) rotate(45deg); pointer-events: auto; cursor: pointer; border: 1px solid ${isCurrent ? "#fff" : "#886600"};`;
            d.title = `Frame ${kf.frame}: ${kf.value.toFixed(2)} (${kf.easing})\nClick=jump, Right-click=delete, Shift+right-click=easing`;
            d.addEventListener("click", (e) => { e.stopPropagation(); this.kfCurrentFrame = kf.frame; this._updateFrameDisplay(); this.refreshAllDiamonds(); });
            d.addEventListener("contextmenu", (e) => {
                e.preventDefault(); e.stopPropagation();
                if (e.shiftKey) {
                    // Shift+right-click: cycle easing
                    const modes = ["linear", "ease_in", "ease_out", "ease_in_out"];
                    kf.easing = modes[(modes.indexOf(kf.easing || "linear") + 1) % modes.length];
                    d.title = `Frame ${kf.frame}: ${kf.value.toFixed(2)} (${kf.easing})\nClick=jump, Right-click=delete, Shift+right-click=easing`;
                    this.syncParamKeyframesToWidget();
                } else {
                    // Right-click: delete this keyframe
                    this.removeSliderKeyframe(paramName, kf.frame);
                    this.refreshDiamonds(paramName, diamondLayer);
                }
            });
            diamondLayer.appendChild(d);
        }
    };

    nodeType.prototype.refreshAllDiamonds = function() {
        for (const [pName, sw] of Object.entries(this._sliderWidgets || {})) { this.refreshDiamonds(pName, sw.diamondLayer); }
    };

    nodeType.prototype.syncParamKeyframesToWidget = function() {
        this._kfSyncing = true;
        const w = this.widgets?.find(x => x.name === "param_keyframes");
        if (w) {
            w.value = JSON.stringify(this.paramKeyframes || {});
            if (this.setDirtyCanvas) this.setDirtyCanvas(true, true);
        }
        this._kfSyncing = false;
    };

    nodeType.prototype.loadParamKeyframesFromWidget = function() {
        if (this._kfSyncing) return;
        if (this._kfInitialized) return;
        const w = this.widgets?.find(x => x.name === "param_keyframes");
        if (w && w.value) {
            try {
                const parsed = JSON.parse(w.value);
                if (Array.isArray(parsed)) {
                    this.paramKeyframes = {};
                    for (const kf of parsed) {
                        for (const pn of Object.keys(DEFAULTS)) {
                            if (kf[pn] !== undefined && kf[pn] !== DEFAULTS[pn]) {
                                if (!this.paramKeyframes[pn]) this.paramKeyframes[pn] = [];
                                this.paramKeyframes[pn].push({ frame: kf.frame, value: kf[pn], easing: kf.easing || "linear" });
                            }
                        }
                    }
                } else if (typeof parsed === "object") { this.paramKeyframes = parsed; }
            } catch (e) { this.paramKeyframes = {}; }
        }
        this._kfInitialized = true;
        this.refreshAllDiamonds();
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function(o) {
        if (onConfigure) onConfigure.apply(this, arguments);
        // onConfigure runs when loading a saved workflow — reset flag to allow fresh load
        this._kfInitialized = false;
        setTimeout(() => { this.loadParamKeyframesFromWidget(); this.refreshAllDiamonds(); }, 200);
    };
}

app.registerExtension({
    name: "ComfyVFX.CompositorCameraKF",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_CompositorCamera") return;
        buildPerSliderKFNode(nodeType, CAMERA_SLIDER_DEFAULTS, "kf_camera_editor");
    },
});

app.registerExtension({
    name: "ComfyVFX.CompositorLayerKF",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_CompositorLayer") return;
        buildPerSliderKFNode(nodeType, LAYER_SLIDER_DEFAULTS, "kf_layer_editor");
    },
});
