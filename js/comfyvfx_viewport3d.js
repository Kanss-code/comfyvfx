import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

let THREE = null, OrbitControls = null, GLTFLoader = null, OBJLoader = null, TransformControls = null;

async function loadThree() {
    if (THREE) return;
    const load = (url) => new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = url; s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
    });
    await load('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
    THREE = window.THREE;
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js');
    OrbitControls = THREE.OrbitControls;
    TransformControls = THREE.TransformControls;
    GLTFLoader = THREE.GLTFLoader;
    OBJLoader = THREE.OBJLoader;
    console.log("[ComfyVFX 3D] Three.js loaded");
}

app.registerExtension({
    name: "ComfyVFX.3DViewport",
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_3DViewport") return;
        
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function() {
            onCreated?.apply(this, arguments);
            await loadThree();
            
            this.addWidget("button", "Update Sprites", null, () => this.updateInputs("sprite", "sprite_count", "3D_SPRITE"));
            this.addWidget("button", "Update Models", null, () => this.updateInputs("model", "model_count", "3D_MODEL"));
            
            // Main container
            this.container = document.createElement("div");
            this.container.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:4px;";
            
            // Transform toolbar
            this.transformBar = document.createElement("div");
            this.transformBar.style.cssText = "display:flex;gap:3px;flex-wrap:wrap;";
            
            var btnStyle = "padding:2px 6px;background:#4a4a4a;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:9px;";
            var self = this;
            
            this.moveBtn = document.createElement("button");
            this.moveBtn.textContent = "↔ Move";
            this.moveBtn.style.cssText = btnStyle + "background:#666;";
            this.moveBtn.onclick = function() { self.setTransformMode("translate"); };
            
            this.rotBtn = document.createElement("button");
            this.rotBtn.textContent = "↻ Rotate";
            this.rotBtn.style.cssText = btnStyle;
            this.rotBtn.onclick = function() { self.setTransformMode("rotate"); };
            
            this.sclBtn = document.createElement("button");
            this.sclBtn.textContent = "⤢ Scale";
            this.sclBtn.style.cssText = btnStyle;
            this.sclBtn.onclick = function() { self.setTransformMode("scale"); };
            
            this.deselectBtn = document.createElement("button");
            this.deselectBtn.textContent = "✕";
            this.deselectBtn.style.cssText = btnStyle;
            this.deselectBtn.onclick = function() { self.deselectObject(); };
            
            this.transformBar.appendChild(this.moveBtn);
            this.transformBar.appendChild(this.rotBtn);
            this.transformBar.appendChild(this.sclBtn);
            this.transformBar.appendChild(this.deselectBtn);
            
            // Canvas container
            this.canvasContainer = document.createElement("div");
            this.canvasContainer.style.cssText = "width:100%;aspect-ratio:1/1;border:1px solid #444;border-radius:4px;overflow:hidden;min-height:200px;";
            
            // Playback toolbar
            this.playBar = document.createElement("div");
            this.playBar.style.cssText = "display:flex;gap:3px;align-items:center;flex-wrap:wrap;";
            
            this.freeBtn = document.createElement("button");
            this.freeBtn.textContent = "Free";
            this.freeBtn.style.cssText = btnStyle + "background:#666;";
            this.freeBtn.onclick = function() { self.setFreeCam(true); };
            
            this.sceneBtn = document.createElement("button");
            this.sceneBtn.textContent = "Scene";
            this.sceneBtn.style.cssText = btnStyle;
            this.sceneBtn.onclick = function() { self.setFreeCam(false); };
            
            this.prevBtn = document.createElement("button");
            this.prevBtn.textContent = "⏮";
            this.prevBtn.style.cssText = btnStyle;
            this.prevBtn.onclick = function() { self.gotoFrame(self.frame - 1); };
            
            this.playBtn = document.createElement("button");
            this.playBtn.textContent = "▶";
            this.playBtn.style.cssText = btnStyle + "min-width:24px;";
            this.playBtn.onclick = function() { self.togglePlay(); };
            
            this.nextBtn = document.createElement("button");
            this.nextBtn.textContent = "⏭";
            this.nextBtn.style.cssText = btnStyle;
            this.nextBtn.onclick = function() { self.gotoFrame(self.frame + 1); };
            
            this.frameLabel = document.createElement("span");
            this.frameLabel.style.cssText = "color:#aaa;font-size:9px;margin-left:4px;";
            this.frameLabel.textContent = "1/1";
            
            // RENDER FRAMES BUTTON
            this.renderBtn = document.createElement("button");
            this.renderBtn.textContent = "🎬 Render Frames";
            this.renderBtn.style.cssText = btnStyle + "background:#2a6a2a;margin-left:auto;";
            this.renderBtn.onclick = function() { self.renderAllFrames(); };
            
            this.playBar.appendChild(this.freeBtn);
            this.playBar.appendChild(this.sceneBtn);
            this.playBar.appendChild(this.prevBtn);
            this.playBar.appendChild(this.playBtn);
            this.playBar.appendChild(this.nextBtn);
            this.playBar.appendChild(this.frameLabel);
            this.playBar.appendChild(this.renderBtn);
            
            // Info/progress display
            this.info = document.createElement("div");
            this.info.style.cssText = "color:#888;font-size:9px;";
            this.info.textContent = "3D Viewport - Click 'Render Frames' to export";
            
            this.container.appendChild(this.transformBar);
            this.container.appendChild(this.canvasContainer);
            this.container.appendChild(this.playBar);
            this.container.appendChild(this.info);
            
            // State
            this.scene = null;
            this.camera = null;
            this.renderer = null;
            this.orbit = null;
            this.transform = null;
            this.grid = null;
            this.sprites = [];
            this.models = [];
            this.camFrames = [];
            this.frame = 0;
            this.totalFrames = 1;
            this.playing = false;
            this.freeCam = true;
            this.selectedObject = null;
            this.nodeId = null;
            this.outputWidth = 512;
            this.outputHeight = 512;
            this.isRendering = false;
            
            this.addDOMWidget("viewport", "div", this.container, {serialize: false});
            this.setSize([400, 480]);
            
            setTimeout(function() { self.init3D(); }, 100);
        };
        
        nodeType.prototype.init3D = function() {
            if (!THREE || this.renderer) return;
            
            var rect = this.canvasContainer.getBoundingClientRect();
            var w = rect.width || 360;
            var h = rect.height || 360;
            
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x222222);
            
            this.camera = new THREE.PerspectiveCamera(50, w/h, 0.1, 1000);
            this.camera.position.set(0, 2, 5);
            
            this.renderer = new THREE.WebGLRenderer({antialias: true, preserveDrawingBuffer: true});
            this.renderer.setSize(w, h);
            this.canvasContainer.appendChild(this.renderer.domElement);
            
            this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
            this.orbit.enableDamping = true;
            
            this.transform = new TransformControls(this.camera, this.renderer.domElement);
            var self = this;
            this.transform.addEventListener('dragging-changed', function(e) {
                self.orbit.enabled = !e.value;
            });
            this.scene.add(this.transform);
            
            // Lights
            this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
            var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(5, 10, 5);
            this.scene.add(dirLight);
            
            // Grid
            this.grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
            this.scene.add(this.grid);
            
            // Click to select
            this.raycaster = new THREE.Raycaster();
            this.mouse = new THREE.Vector2();
            this.renderer.domElement.addEventListener('click', function(e) { self.onCanvasClick(e); });
            
            // Resize observer
            new ResizeObserver(function() {
                if (self.isRendering) return;
                var rect = self.canvasContainer.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0 && self.renderer) {
                    self.camera.aspect = rect.width / rect.height;
                    self.camera.updateProjectionMatrix();
                    self.renderer.setSize(rect.width, rect.height);
                }
            }).observe(this.canvasContainer);
            
            this.animate();
        };
        
        nodeType.prototype.animate = function() {
            if (!this.renderer || this.isRendering) return;
            var self = this;
            requestAnimationFrame(function() { self.animate(); });
            
            if (this.orbit && this.freeCam) {
                this.orbit.update();
            }
            
            // Update sprite textures for current frame
            for (var i = 0; i < this.sprites.length; i++) {
                var s = this.sprites[i];
                if (s.textures && s.textures.length > 1) {
                    var idx = this.frame % s.textures.length;
                    if (s.currentIdx !== idx && s.textures[idx]) {
                        s.mesh.material.map = s.textures[idx];
                        s.mesh.material.needsUpdate = true;
                        s.currentIdx = idx;
                    }
                }
            }
            
            this.renderer.render(this.scene, this.camera);
        };
        
        // RENDER ALL FRAMES FUNCTION
        nodeType.prototype.renderAllFrames = async function() {
            if (!this.renderer || !this.camFrames || this.camFrames.length === 0) {
                this.info.textContent = "Error: No camera frames available. Run workflow first.";
                return;
            }
            if (!this.nodeId) {
                this.info.textContent = "Error: Node ID not set. Run workflow first.";
                return;
            }
            
            this.isRendering = true;
            this.renderBtn.disabled = true;
            this.renderBtn.textContent = "Rendering...";
            
            var self = this;
            var originalWidth = this.renderer.domElement.width;
            var originalHeight = this.renderer.domElement.height;
            
            // Resize to output dimensions
            this.renderer.setSize(this.outputWidth, this.outputHeight);
            this.camera.aspect = this.outputWidth / this.outputHeight;
            this.camera.updateProjectionMatrix();
            
            // Hide grid and transform controls
            if (this.grid) this.grid.visible = false;
            if (this.transform) this.transform.visible = false;
            
            console.log("[ComfyVFX 3D] Rendering", this.totalFrames, "frames at", this.outputWidth, "x", this.outputHeight);
            
            try {
                for (var frameIdx = 0; frameIdx < this.totalFrames; frameIdx++) {
                    // Apply camera for this frame
                    var camFrame = this.camFrames[Math.min(frameIdx, this.camFrames.length - 1)];
                    this.camera.position.set(camFrame.position[0], camFrame.position[1], camFrame.position[2]);
                    this.camera.rotation.set(
                        THREE.MathUtils.degToRad(camFrame.rotation[0]),
                        THREE.MathUtils.degToRad(camFrame.rotation[1]),
                        THREE.MathUtils.degToRad(camFrame.rotation[2])
                    );
                    if (camFrame.fov) {
                        this.camera.fov = camFrame.fov;
                        this.camera.updateProjectionMatrix();
                    }
                    
                    // Update sprite textures
                    for (var i = 0; i < this.sprites.length; i++) {
                        var s = this.sprites[i];
                        if (s.textures && s.textures.length > 0) {
                            var texIdx = frameIdx % s.textures.length;
                            if (s.textures[texIdx]) {
                                s.mesh.material.map = s.textures[texIdx];
                                s.mesh.material.needsUpdate = true;
                            }
                        }
                    }
                    
                    // Render
                    this.renderer.render(this.scene, this.camera);
                    
                    // Get image data
                    var dataUrl = this.renderer.domElement.toDataURL('image/png');
                    var base64Data = dataUrl.split(',')[1];
                    
                    // Upload to temp folder
                    var filename = "viewport3d_" + this.nodeId + "_" + String(frameIdx).padStart(4, '0') + ".png";
                    
                    await this.uploadFrame(filename, base64Data);
                    
                    // Update progress
                    this.info.textContent = "Rendering: " + (frameIdx + 1) + "/" + this.totalFrames;
                    
                    // Small delay to allow UI update
                    await new Promise(r => setTimeout(r, 1));
                }
                
                this.info.textContent = "Rendered " + this.totalFrames + " frames. Run workflow to load output.";
                console.log("[ComfyVFX 3D] Rendering complete!");
                
            } catch (err) {
                console.error("[ComfyVFX 3D] Render error:", err);
                this.info.textContent = "Error: " + err.message;
            }
            
            // Restore
            if (this.grid) this.grid.visible = true;
            if (this.transform) this.transform.visible = true;
            this.renderer.setSize(originalWidth, originalHeight);
            this.camera.aspect = originalWidth / originalHeight;
            this.camera.updateProjectionMatrix();
            
            this.isRendering = false;
            this.renderBtn.disabled = false;
            this.renderBtn.textContent = "🎬 Render Frames";
            
            // Resume animation
            this.animate();
        };
        
        nodeType.prototype.uploadFrame = async function(filename, base64Data) {
            // Convert base64 to blob
            var byteString = atob(base64Data);
            var ab = new ArrayBuffer(byteString.length);
            var ia = new Uint8Array(ab);
            for (var i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            var blob = new Blob([ab], {type: 'image/png'});
            
            // Upload using ComfyUI API
            var formData = new FormData();
            formData.append('image', blob, filename);
            formData.append('type', 'temp');
            formData.append('overwrite', 'true');
            
            var response = await api.fetchApi('/upload/image', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error('Upload failed: ' + response.status);
            }
            
            return await response.json();
        };
        
        nodeType.prototype.onCanvasClick = function(e) {
            if (!this.renderer || !this.raycaster || this.isRendering) return;
            
            var rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.raycaster.setFromCamera(this.mouse, this.camera);
            
            var clickables = [];
            for (var i = 0; i < this.sprites.length; i++) {
                clickables.push(this.sprites[i].mesh);
            }
            for (var i = 0; i < this.models.length; i++) {
                if (this.models[i].obj) {
                    this.models[i].obj.traverse(function(c) {
                        if (c.isMesh) clickables.push(c);
                    });
                }
            }
            
            var hits = this.raycaster.intersectObjects(clickables, true);
            if (hits.length > 0) {
                var obj = hits[0].object;
                while (obj.parent && this.scene.children.indexOf(obj) === -1) {
                    obj = obj.parent;
                }
                this.selectObject(obj);
            }
        };
        
        nodeType.prototype.selectObject = function(obj) {
            this.selectedObject = obj;
            this.transform.attach(obj);
            this.info.textContent = "Selected: " + (obj.name || "Object");
        };
        
        nodeType.prototype.deselectObject = function() {
            this.selectedObject = null;
            this.transform.detach();
            this.info.textContent = "Deselected";
        };
        
        nodeType.prototype.setTransformMode = function(mode) {
            if (this.transform) {
                this.transform.setMode(mode);
            }
            this.moveBtn.style.background = (mode === "translate") ? "#666" : "#4a4a4a";
            this.rotBtn.style.background = (mode === "rotate") ? "#666" : "#4a4a4a";
            this.sclBtn.style.background = (mode === "scale") ? "#666" : "#4a4a4a";
        };
        
        nodeType.prototype.setFreeCam = function(free) {
            this.freeCam = free;
            this.freeBtn.style.background = free ? "#666" : "#4a4a4a";
            this.sceneBtn.style.background = free ? "#4a4a4a" : "#666";
            this.orbit.enabled = free;
            if (!free) this.applyCamFrame();
        };
        
        nodeType.prototype.applyCamFrame = function() {
            if (this.freeCam || !this.camFrames || this.camFrames.length === 0) return;
            var idx = Math.min(this.frame, this.camFrames.length - 1);
            var f = this.camFrames[idx];
            if (!f) return;
            
            this.camera.position.set(f.position[0], f.position[1], f.position[2]);
            this.camera.rotation.set(
                THREE.MathUtils.degToRad(f.rotation[0]),
                THREE.MathUtils.degToRad(f.rotation[1]),
                THREE.MathUtils.degToRad(f.rotation[2])
            );
            if (f.fov && f.fov !== this.camera.fov) {
                this.camera.fov = f.fov;
                this.camera.updateProjectionMatrix();
            }
        };
        
        nodeType.prototype.gotoFrame = function(n) {
            this.frame = ((n % this.totalFrames) + this.totalFrames) % this.totalFrames;
            this.frameLabel.textContent = (this.frame + 1) + "/" + this.totalFrames;
            this.applyCamFrame();
        };
        
        nodeType.prototype.togglePlay = function() {
            this.playing = !this.playing;
            this.playBtn.textContent = this.playing ? "⏸" : "▶";
            var self = this;
            if (this.playing) {
                this.playInterval = setInterval(function() { self.gotoFrame(self.frame + 1); }, 1000/24);
            } else {
                clearInterval(this.playInterval);
            }
        };
        
        nodeType.prototype.loadModel = function(filePath, pos, rot, scl) {
            if (!filePath || filePath === "none") return;
            
            var parts = filePath.split("/");
            var filename = parts.pop();
            var subfolder = parts.join("/");
            
            var url = "/view?filename=" + encodeURIComponent(filename) + "&type=input";
            if (subfolder) {
                url += "&subfolder=" + encodeURIComponent(subfolder);
            }
            
            var ext = filename.split(".").pop().toLowerCase();
            var self = this;
            
            console.log("[ComfyVFX 3D] Loading:", filePath);
            
            var onLoad = function(obj) {
                obj.name = filename;
                if (pos) obj.position.set(pos[0], pos[1], pos[2]);
                if (rot) obj.rotation.set(
                    THREE.MathUtils.degToRad(rot[0]),
                    THREE.MathUtils.degToRad(rot[1]),
                    THREE.MathUtils.degToRad(rot[2])
                );
                if (scl) obj.scale.setScalar(scl);
                self.scene.add(obj);
                self.models.push({obj: obj, file: filePath});
                console.log("[ComfyVFX 3D] Loaded:", filename);
            };
            
            var onError = function(err) {
                console.error("[ComfyVFX 3D] Error loading", filePath, err);
            };
            
            if (ext === "gltf" || ext === "glb") {
                new GLTFLoader().load(url, function(gltf) { onLoad(gltf.scene); }, null, onError);
            } else if (ext === "obj") {
                new OBJLoader().load(url, function(obj) {
                    obj.traverse(function(c) {
                        if (c.isMesh) c.material = new THREE.MeshStandardMaterial({color: 0x888888});
                    });
                    onLoad(obj);
                }, null, onError);
            }
        };
        
        nodeType.prototype.addSprite = function(data) {
            if (!data || !data.frames || data.frames.length === 0) return;
            
            var textures = [];
            var loaded = 0;
            var self = this;
            
            for (var i = 0; i < data.frames.length; i++) {
                (function(idx) {
                    var img = new Image();
                    img.onload = function() {
                        var t = new THREE.Texture(img);
                        t.needsUpdate = true;
                        textures[idx] = t;
                        loaded++;
                        
                        if (loaded === 1) {
                            var mesh = new THREE.Mesh(
                                new THREE.PlaneGeometry(1, 1),
                                new THREE.MeshBasicMaterial({
                                    map: t,
                                    transparent: true,
                                    side: THREE.DoubleSide,
                                    alphaTest: 0.1,
                                    opacity: data.opacity || 1
                                })
                            );
                            mesh.position.set(data.position[0], data.position[1], data.position[2]);
                            mesh.scale.setScalar(data.scale || 1);
                            mesh.name = "Sprite_" + self.sprites.length;
                            self.scene.add(mesh);
                            self.sprites.push({mesh: mesh, textures: textures, currentIdx: 0});
                        }
                    };
                    img.src = "data:image/png;base64," + data.frames[idx];
                })(i);
            }
        };
        
        nodeType.prototype.updateInputs = function(prefix, countWidget, type) {
            var w = this.widgets.find(function(x) { return x.name === countWidget; });
            if (!w) return;
            
            var target = w.value;
            var currentInputs = this.inputs ? this.inputs.filter(function(inp) {
                return inp.name.indexOf(prefix + "_") === 0 && inp.type === type;
            }) : [];
            var current = currentInputs.length;
            
            if (current > target) {
                for (var i = current; i > target; i--) {
                    var idx = this.inputs.findIndex(function(x) { return x.name === prefix + "_" + i; });
                    if (idx >= 0) this.removeInput(idx);
                }
            } else {
                for (var i = current + 1; i <= target; i++) {
                    this.addInput(prefix + "_" + i, type);
                }
            }
            this.setDirtyCanvas(true, true);
        };
        
        var onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(msg) {
            if (onExecuted) onExecuted.apply(this, arguments);
            
            var cfg = msg && msg.viewport_config && msg.viewport_config[0];
            if (!cfg) return;
            
            // Store config
            this.nodeId = cfg.node_id;
            this.outputWidth = cfg.width;
            this.outputHeight = cfg.height;
            this.totalFrames = cfg.num_frames || 1;
            this.frameLabel.textContent = "1/" + this.totalFrames;
            
            if (this.scene && cfg.background_color) {
                this.scene.background = new THREE.Color(cfg.background_color);
            }
            if (this.grid) {
                this.grid.visible = cfg.show_grid !== false;
            }
            
            this.camFrames = cfg.camera_frames || [];
            console.log("[ComfyVFX 3D] Received", this.camFrames.length, "camera frames, node_id:", this.nodeId);
            
            // Clear old objects
            var self = this;
            for (var i = 0; i < this.sprites.length; i++) {
                this.scene.remove(this.sprites[i].mesh);
            }
            this.sprites = [];
            
            for (var i = 0; i < this.models.length; i++) {
                this.scene.remove(this.models[i].obj);
            }
            this.models = [];
            
            // Add sprites
            if (cfg.sprites) {
                for (var i = 0; i < cfg.sprites.length; i++) {
                    this.addSprite(cfg.sprites[i]);
                }
            }
            
            // Add models
            if (cfg.models) {
                for (var i = 0; i < cfg.models.length; i++) {
                    var m = cfg.models[i];
                    this.loadModel(m.file, m.position, m.rotation, m.scale);
                }
            }
            
            this.info.textContent = cfg.width + "x" + cfg.height + " | " + this.totalFrames + " frames - Click 'Render Frames' to export";
        };
        
        var onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (onRemoved) onRemoved.apply(this, arguments);
            clearInterval(this.playInterval);
            if (this.renderer) this.renderer.dispose();
        };
        
        var onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function(o) {
            if (onConfigure) onConfigure.apply(this, arguments);
            var self = this;
            setTimeout(function() {
                self.updateInputs("sprite", "sprite_count", "3D_SPRITE");
                self.updateInputs("model", "model_count", "3D_MODEL");
                if (!self.renderer) self.init3D();
            }, 100);
        };
    }
});
