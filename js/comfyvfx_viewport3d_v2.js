/**
 * ComfyVFX - 3D Viewport V2 (Beta)
 */
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

let THREE=null,OrbitControls=null,GLTFLoader=null,OBJLoader=null,TransformControls=null;

async function loadThree(){
    if(THREE)return;
    const load=(url)=>new Promise((res,rej)=>{const s=document.createElement('script');s.src=url;s.onload=res;s.onerror=rej;document.head.appendChild(s);});
    await load('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');
    THREE=window.THREE;
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/TransformControls.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js');
    await load('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js');
    OrbitControls=THREE.OrbitControls;TransformControls=THREE.TransformControls;GLTFLoader=THREE.GLTFLoader;OBJLoader=THREE.OBJLoader;
}

function lerp(a,b,t){return a+(b-a)*t;}
function lerpVec3(a,b,t){return[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];}
function easeInOut(t){return t*t*(3.0-2.0*t);}

app.registerExtension({
    name:"ComfyVFX.3DViewportV2",
    async beforeRegisterNodeDef(nodeType,nodeData,app){
        if(nodeData.name!=="ComfyVFX_3DViewportV2")return;
        
        const onCreated=nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated=async function(){
            if(onCreated)onCreated.apply(this,arguments);
            await loadThree();
            const self=this;
            
            this.addWidget("button","Update Sprites",null,()=>this.updateInputs("sprite","sprite_count","3D_SPRITE"));
            this.addWidget("button","Update Models",null,()=>this.updateInputs("model","model_count","3D_MODEL"));
            
            // Main container - explicit width
            this.container=document.createElement("div");
            this.container.style.cssText="display:flex;flex-direction:column;gap:4px;padding:4px;width:100%;box-sizing:border-box;";
            
            // Top row: transform tools + canvas
            this.topRow=document.createElement("div");
            this.topRow.style.cssText="display:flex;gap:4px;width:100%;box-sizing:border-box;";
            
            // Transform toolbar (vertical)
            this.transformToolbar=document.createElement("div");
            this.transformToolbar.style.cssText="display:flex;flex-direction:column;gap:3px;flex-shrink:0;";
            const btnStyle="padding:4px 6px;background:#3a3a3a;color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;text-align:center;min-width:24px;";
            
            this.grabBtn=document.createElement("button");this.grabBtn.textContent="⬌";this.grabBtn.title="Move";this.grabBtn.style.cssText=btnStyle+"background:#4a6a8a;";this.grabBtn.onclick=()=>this.setTransformMode("translate");
            this.rotateBtn=document.createElement("button");this.rotateBtn.textContent="↻";this.rotateBtn.title="Rotate";this.rotateBtn.style.cssText=btnStyle;this.rotateBtn.onclick=()=>this.setTransformMode("rotate");
            this.scaleBtn=document.createElement("button");this.scaleBtn.textContent="⤢";this.scaleBtn.title="Scale";this.scaleBtn.style.cssText=btnStyle;this.scaleBtn.onclick=()=>this.setTransformMode("scale");
            this.deselectBtn=document.createElement("button");this.deselectBtn.textContent="✕";this.deselectBtn.title="Deselect";this.deselectBtn.style.cssText=btnStyle;this.deselectBtn.onclick=()=>this.deselectObject();
            
            this.transformToolbar.appendChild(this.grabBtn);
            this.transformToolbar.appendChild(this.rotateBtn);
            this.transformToolbar.appendChild(this.scaleBtn);
            this.transformToolbar.appendChild(this.deselectBtn);
            
            // Canvas container
            this.canvasContainer=document.createElement("div");
            this.canvasContainer.style.cssText="flex:1;height:180px;background:#222;border:1px solid #444;border-radius:4px;overflow:hidden;min-width:50px;";
            
            this.topRow.appendChild(this.transformToolbar);
            this.topRow.appendChild(this.canvasContainer);
            
            // Timeline bar - explicit width 100%
            this.timelineBar=document.createElement("div");
            this.timelineBar.style.cssText="position:relative;height:20px;background:#2a2a2a;border:1px solid #555;border-radius:3px;cursor:pointer;overflow:hidden;width:100%;box-sizing:border-box;margin-top:2px;";
            
            this.timelineTrack=document.createElement("div");
            this.timelineTrack.style.cssText="position:absolute;top:0;left:0;height:100%;background:linear-gradient(to right,#3a5a7a,#4a6a8a);width:0%;pointer-events:none;";
            
            this.playhead=document.createElement("div");
            this.playhead.style.cssText="position:absolute;top:0;width:3px;height:100%;background:#fff;box-shadow:0 0 6px #fff;left:0%;pointer-events:none;z-index:10;";
            
            this.keyframeMarkers=document.createElement("div");
            this.keyframeMarkers.style.cssText="position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";
            
            this.timelineBar.appendChild(this.timelineTrack);
            this.timelineBar.appendChild(this.keyframeMarkers);
            this.timelineBar.appendChild(this.playhead);
            
            // Timeline scrubbing
            let isDragging=false;
            this.timelineBar.addEventListener("mousedown",(e)=>{isDragging=true;this.scrubTimeline(e);});
            document.addEventListener("mousemove",(e)=>{if(isDragging)this.scrubTimeline(e);});
            document.addEventListener("mouseup",()=>{isDragging=false;});
            
            // Playback controls row
            this.playbackRow=document.createElement("div");
            this.playbackRow.style.cssText="display:flex;align-items:center;justify-content:center;gap:2px;flex-wrap:wrap;margin-top:2px;";
            const pbStyle="padding:3px 6px;background:#3a3a3a;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:11px;min-width:22px;text-align:center;";
            
            this.skipStartBtn=document.createElement("button");this.skipStartBtn.textContent="⏮";this.skipStartBtn.title="Skip to Start";this.skipStartBtn.style.cssText=pbStyle;this.skipStartBtn.onclick=()=>this.gotoFrame(0);
            this.prevKeyBtn=document.createElement("button");this.prevKeyBtn.textContent="◆←";this.prevKeyBtn.title="Prev Keyframe";this.prevKeyBtn.style.cssText=pbStyle;this.prevKeyBtn.onclick=()=>this.gotoPrevKeyframe();
            this.frameBackBtn=document.createElement("button");this.frameBackBtn.textContent="⏪";this.frameBackBtn.title="Frame Back";this.frameBackBtn.style.cssText=pbStyle;this.frameBackBtn.onclick=()=>this.gotoFrame(this.frame-1);
            this.playBackBtn=document.createElement("button");this.playBackBtn.textContent="◀";this.playBackBtn.title="Play Reverse";this.playBackBtn.style.cssText=pbStyle;this.playBackBtn.onclick=()=>this.togglePlayReverse();
            this.playFwdBtn=document.createElement("button");this.playFwdBtn.textContent="▶";this.playFwdBtn.title="Play Forward";this.playFwdBtn.style.cssText=pbStyle+"background:#4a6a4a;";this.playFwdBtn.onclick=()=>this.togglePlay();
            this.frameFwdBtn=document.createElement("button");this.frameFwdBtn.textContent="⏩";this.frameFwdBtn.title="Frame Forward";this.frameFwdBtn.style.cssText=pbStyle;this.frameFwdBtn.onclick=()=>this.gotoFrame(this.frame+1);
            this.nextKeyBtn=document.createElement("button");this.nextKeyBtn.textContent="→◆";this.nextKeyBtn.title="Next Keyframe";this.nextKeyBtn.style.cssText=pbStyle;this.nextKeyBtn.onclick=()=>this.gotoNextKeyframe();
            this.skipEndBtn=document.createElement("button");this.skipEndBtn.textContent="⏭";this.skipEndBtn.title="Skip to End";this.skipEndBtn.style.cssText=pbStyle;this.skipEndBtn.onclick=()=>this.gotoFrame(this.totalFrames-1);
            this.frameCounter=document.createElement("span");this.frameCounter.style.cssText="color:#aaa;font-size:10px;min-width:55px;text-align:center;font-family:monospace;";this.frameCounter.textContent="1/1";
            
            [this.skipStartBtn,this.prevKeyBtn,this.frameBackBtn,this.playBackBtn,this.playFwdBtn,this.frameFwdBtn,this.nextKeyBtn,this.skipEndBtn,this.frameCounter].forEach(el=>this.playbackRow.appendChild(el));
            
            // Keyframe/camera controls row
            this.keyframeRow=document.createElement("div");
            this.keyframeRow.style.cssText="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-top:2px;";
            
            this.cameraModeDiv=document.createElement("div");this.cameraModeDiv.style.cssText="display:flex;gap:2px;";
            this.freeCamBtn=document.createElement("button");this.freeCamBtn.textContent="Free";this.freeCamBtn.title="Free Camera";this.freeCamBtn.style.cssText=pbStyle+"background:#4a6a8a;";this.freeCamBtn.onclick=()=>this.setFreeCam(true);
            this.sceneCamBtn=document.createElement("button");this.sceneCamBtn.textContent="Scene";this.sceneCamBtn.title="Scene Camera";this.sceneCamBtn.style.cssText=pbStyle;this.sceneCamBtn.onclick=()=>this.setFreeCam(false);
            this.cameraModeDiv.appendChild(this.freeCamBtn);this.cameraModeDiv.appendChild(this.sceneCamBtn);
            
            this.keyframeBtnDiv=document.createElement("div");this.keyframeBtnDiv.style.cssText="display:flex;gap:2px;";
            this.addKeyframeBtn=document.createElement("button");this.addKeyframeBtn.textContent="◆+";this.addKeyframeBtn.title="Add Keyframe";this.addKeyframeBtn.style.cssText=pbStyle+"background:#6a5a3a;";this.addKeyframeBtn.onclick=()=>this.addCameraKeyframe();
            this.removeKeyframeBtn=document.createElement("button");this.removeKeyframeBtn.textContent="◆−";this.removeKeyframeBtn.title="Remove Keyframe";this.removeKeyframeBtn.style.cssText=pbStyle;this.removeKeyframeBtn.onclick=()=>this.removeCameraKeyframe();
            this.keyframeBtnDiv.appendChild(this.addKeyframeBtn);this.keyframeBtnDiv.appendChild(this.removeKeyframeBtn);
            
            this.renderBtn=document.createElement("button");this.renderBtn.textContent="🎬 Render";this.renderBtn.title="Render All Frames";this.renderBtn.style.cssText=pbStyle+"background:#2a6a2a;";this.renderBtn.onclick=()=>this.renderAllFrames();
            
            this.keyframeRow.appendChild(this.cameraModeDiv);this.keyframeRow.appendChild(this.keyframeBtnDiv);this.keyframeRow.appendChild(this.renderBtn);
            
            // Info display
            this.infoDisplay=document.createElement("div");this.infoDisplay.style.cssText="color:#888;font-size:9px;text-align:center;margin-top:2px;";this.infoDisplay.textContent="3D Viewport V2";
            
            // Assemble container
            this.container.appendChild(this.topRow);
            this.container.appendChild(this.timelineBar);
            this.container.appendChild(this.playbackRow);
            this.container.appendChild(this.keyframeRow);
            this.container.appendChild(this.infoDisplay);
            
            // State variables
            this.scene=null;this.camera=null;this.renderer=null;this.orbit=null;this.transform=null;this.grid=null;
            this.sprites=[];this.models=[];this.camFrames=[];this.keyframes={};this.keyframeList=[];
            this.frame=0;this.totalFrames=120;this.fps=24;this.playing=false;this.playReverse=false;this.freeCam=true;
            this.selectedObject=null;this.nodeId=null;this.outputWidth=1280;this.outputHeight=720;this.isRendering=false;
            this.useEasing=true;this.defaultCamera={position:[0,1.5,5],rotation:[0,0,0],fov:50};
            this.lastW=0;this.lastH=0;
            
            this.addDOMWidget("viewport_v2","div",this.container,{serialize:false});
            this.setSize([400,480]);
            setTimeout(()=>this.init3D(),150);
        };
        
        nodeType.prototype.init3D=function(){
            if(!THREE||this.renderer)return;
            const rect=this.canvasContainer.getBoundingClientRect();
            let w=Math.max(100,Math.min(600,rect.width||300));
            let h=Math.max(60,Math.min(400,rect.height||170));
            this.lastW=w;this.lastH=h;
            
            this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x222222);
            this.camera=new THREE.PerspectiveCamera(50,w/h,0.1,1000);this.camera.position.set(0,1.5,5);
            this.renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
            this.renderer.setSize(w,h);
            this.renderer.domElement.style.width="100%";this.renderer.domElement.style.height="100%";
            this.canvasContainer.appendChild(this.renderer.domElement);
            
            this.orbit=new OrbitControls(this.camera,this.renderer.domElement);this.orbit.enableDamping=true;
            this.transform=new TransformControls(this.camera,this.renderer.domElement);
            this.transform.addEventListener('dragging-changed',(e)=>{this.orbit.enabled=!e.value;});
            this.scene.add(this.transform);
            
            this.scene.add(new THREE.AmbientLight(0xffffff,0.6));
            const dl=new THREE.DirectionalLight(0xffffff,0.8);dl.position.set(5,10,5);this.scene.add(dl);
            this.grid=new THREE.GridHelper(20,20,0x444444,0x333333);this.scene.add(this.grid);
            this.scene.add(new THREE.AxesHelper(2));
            
            this.cameraHelper=new THREE.Group();
            const cone=new THREE.Mesh(new THREE.ConeGeometry(0.15,0.3,4),new THREE.MeshBasicMaterial({color:0xffaa00,wireframe:true}));
            cone.rotation.x=Math.PI/2;this.cameraHelper.add(cone);this.scene.add(this.cameraHelper);
            
            this.raycaster=new THREE.Raycaster();this.mouse=new THREE.Vector2();
            this.renderer.domElement.addEventListener('click',(e)=>this.onCanvasClick(e));
            
            this.resizeInterval=setInterval(()=>{
                if(this.isRendering)return;
                const r=this.canvasContainer.getBoundingClientRect();
                const nw=Math.floor(r.width),nh=Math.floor(r.height);
                if(nw>50&&nh>50&&(Math.abs(nw-this.lastW)>10||Math.abs(nh-this.lastH)>10)){
                    this.lastW=nw;this.lastH=nh;
                    this.camera.aspect=nw/nh;this.camera.updateProjectionMatrix();
                    this.renderer.setSize(nw,nh);
                }
            },500);
            this.animate();
        };
        
        nodeType.prototype.animate=function(){
            if(!this.renderer||this.isRendering)return;
            requestAnimationFrame(()=>this.animate());
            if(this.orbit&&this.freeCam)this.orbit.update();
            for(const s of this.sprites){
                if(s.textures&&s.textures.length>1){
                    const idx=this.frame%s.textures.length;
                    if(s.currentIdx!==idx&&s.textures[idx]){s.mesh.material.map=s.textures[idx];s.mesh.material.needsUpdate=true;s.currentIdx=idx;}
                }
            }
            if(this.cameraHelper&&this.camFrames.length>0){
                const cd=this.camFrames[Math.min(this.frame,this.camFrames.length-1)];
                if(cd){this.cameraHelper.position.set(cd.position[0],cd.position[1],cd.position[2]);this.cameraHelper.rotation.set(THREE.MathUtils.degToRad(cd.rotation[0]),THREE.MathUtils.degToRad(cd.rotation[1]),THREE.MathUtils.degToRad(cd.rotation[2]));}
                this.cameraHelper.visible=this.freeCam;
            }
            this.renderer.render(this.scene,this.camera);
        };
        
        nodeType.prototype.scrubTimeline=function(e){
            const rect=this.timelineBar.getBoundingClientRect();
            if(rect.width<=0)return;
            let x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
            this.gotoFrame(Math.round(x*(this.totalFrames-1)));
        };
        
        nodeType.prototype.updateTimelineDisplay=function(){
            const p=this.totalFrames>1?this.frame/(this.totalFrames-1):0;
            this.timelineTrack.style.width=(p*100)+"%";
            this.playhead.style.left=(p*100)+"%";
            this.frameCounter.textContent=(this.frame+1)+"/"+this.totalFrames;
        };
        
        nodeType.prototype.updateKeyframeMarkers=function(){
            this.keyframeMarkers.replaceChildren();
            for(const kf of this.keyframeList){
                const m=document.createElement("div");
                const pos=this.totalFrames>1?(kf/(this.totalFrames-1))*100:0;
                m.style.cssText="position:absolute;top:4px;left:"+pos+"%;width:8px;height:8px;margin-left:-4px;background:#ffaa00;transform:rotate(45deg);pointer-events:none;box-shadow:0 0 3px #ffaa00;";
                this.keyframeMarkers.appendChild(m);
            }
        };
        
        nodeType.prototype.gotoFrame=function(n){
            this.frame=((n%this.totalFrames)+this.totalFrames)%this.totalFrames;
            this.updateTimelineDisplay();this.applyCamFrame();
        };
        
        nodeType.prototype.gotoPrevKeyframe=function(){
            if(!this.keyframeList.length)return;
            let prev=null;for(const kf of this.keyframeList){if(kf<this.frame)prev=kf;else break;}
            if(prev===null)prev=this.keyframeList[this.keyframeList.length-1];
            this.gotoFrame(prev);
        };
        
        nodeType.prototype.gotoNextKeyframe=function(){
            if(!this.keyframeList.length)return;
            let next=null;for(const kf of this.keyframeList){if(kf>this.frame){next=kf;break;}}
            if(next===null)next=this.keyframeList[0];
            this.gotoFrame(next);
        };
        
        nodeType.prototype.togglePlay=function(){
            if(this.playReverse)this.stopPlayback();
            this.playing=!this.playing;this.playReverse=false;
            this.playFwdBtn.style.background=this.playing?"#2a6a2a":"#3a3a3a";this.playBackBtn.style.background="#3a3a3a";
            if(this.playing)this.playInterval=setInterval(()=>this.gotoFrame(this.frame+1),1000/this.fps);
            else this.stopPlayback();
        };
        
        nodeType.prototype.togglePlayReverse=function(){
            if(this.playing&&!this.playReverse)this.stopPlayback();
            this.playReverse=!this.playReverse;this.playing=this.playReverse;
            this.playBackBtn.style.background=this.playReverse?"#6a2a2a":"#3a3a3a";this.playFwdBtn.style.background="#3a3a3a";
            if(this.playReverse)this.playInterval=setInterval(()=>this.gotoFrame(this.frame-1),1000/this.fps);
            else this.stopPlayback();
        };
        
        nodeType.prototype.stopPlayback=function(){
            this.playing=false;this.playReverse=false;
            if(this.playInterval){clearInterval(this.playInterval);this.playInterval=null;}
            this.playFwdBtn.style.background="#3a3a3a";this.playBackBtn.style.background="#3a3a3a";
        };
        
        nodeType.prototype.setFreeCam=function(free){
            this.freeCam=free;
            this.freeCamBtn.style.background=free?"#4a6a8a":"#3a3a3a";
            this.sceneCamBtn.style.background=free?"#3a3a3a":"#4a6a8a";
            this.orbit.enabled=free;if(!free)this.applyCamFrame();
        };
        
        nodeType.prototype.applyCamFrame=function(){
            if(this.freeCam||!this.camFrames||!this.camFrames.length)return;
            const f=this.camFrames[Math.min(this.frame,this.camFrames.length-1)];if(!f)return;
            this.camera.position.set(f.position[0],f.position[1],f.position[2]);
            this.camera.rotation.set(THREE.MathUtils.degToRad(f.rotation[0]),THREE.MathUtils.degToRad(f.rotation[1]),THREE.MathUtils.degToRad(f.rotation[2]));
            if(f.fov&&f.fov!==this.camera.fov){this.camera.fov=f.fov;this.camera.updateProjectionMatrix();}
        };
        
        nodeType.prototype.addCameraKeyframe=function(){
            const pos=[this.camera.position.x,this.camera.position.y,this.camera.position.z];
            const rot=[THREE.MathUtils.radToDeg(this.camera.rotation.x),THREE.MathUtils.radToDeg(this.camera.rotation.y),THREE.MathUtils.radToDeg(this.camera.rotation.z)];
            this.keyframes[this.frame]={position:pos,rotation:rot,fov:this.camera.fov};
            this.rebuildKeyframeList();this.rebuildCameraFrames();this.updateKeyframeMarkers();this.updateKeyframeWidget();
            this.infoDisplay.textContent="Keyframe added at frame "+(this.frame+1);
        };
        
        nodeType.prototype.removeCameraKeyframe=function(){
            if(this.keyframes[this.frame]){
                delete this.keyframes[this.frame];
                this.rebuildKeyframeList();this.rebuildCameraFrames();this.updateKeyframeMarkers();this.updateKeyframeWidget();
                this.infoDisplay.textContent="Keyframe removed";
            }else this.infoDisplay.textContent="No keyframe here";
        };
        
        nodeType.prototype.rebuildKeyframeList=function(){this.keyframeList=Object.keys(this.keyframes).map(k=>parseInt(k)).sort((a,b)=>a-b);};
        
        nodeType.prototype.rebuildCameraFrames=function(){
            if(!this.keyframeList.length){
                this.camFrames=[];for(let i=0;i<this.totalFrames;i++)this.camFrames.push({position:[...this.defaultCamera.position],rotation:[...this.defaultCamera.rotation],fov:this.defaultCamera.fov});
                return;
            }
            this.camFrames=[];for(let i=0;i<this.totalFrames;i++)this.camFrames.push(this.getInterpolatedCamera(i));
        };
        
        nodeType.prototype.getInterpolatedCamera=function(frame){
            if(this.keyframes[frame])return{...this.keyframes[frame]};
            let prevFrame=null,nextFrame=null;
            for(const kf of this.keyframeList){if(kf<frame)prevFrame=kf;else if(kf>frame&&nextFrame===null){nextFrame=kf;break;}}
            if(prevFrame===null&&nextFrame!==null)return{...this.keyframes[nextFrame]};
            if(nextFrame===null&&prevFrame!==null)return{...this.keyframes[prevFrame]};
            if(prevFrame!==null&&nextFrame!==null){
                let t=(frame-prevFrame)/(nextFrame-prevFrame);if(this.useEasing)t=easeInOut(t);
                const prev=this.keyframes[prevFrame],next=this.keyframes[nextFrame];
                return{position:lerpVec3(prev.position,next.position,t),rotation:lerpVec3(prev.rotation,next.rotation,t),fov:lerp(prev.fov,next.fov,t)};
            }
            return{position:[...this.defaultCamera.position],rotation:[...this.defaultCamera.rotation],fov:this.defaultCamera.fov};
        };
        
        nodeType.prototype.updateKeyframeWidget=function(){
            // Store keyframe data internally for saving with workflow
            this._keyframeData=JSON.stringify({keyframes:this.keyframes});
        };
        
        nodeType.prototype.setTransformMode=function(mode){
            if(this.transform)this.transform.setMode(mode);
            this.grabBtn.style.background=(mode==="translate")?"#4a6a8a":"#3a3a3a";
            this.rotateBtn.style.background=(mode==="rotate")?"#4a6a8a":"#3a3a3a";
            this.scaleBtn.style.background=(mode==="scale")?"#4a6a8a":"#3a3a3a";
        };
        
        nodeType.prototype.onCanvasClick=function(e){
            if(!this.renderer||!this.raycaster||this.isRendering)return;
            const rect=this.renderer.domElement.getBoundingClientRect();
            this.mouse.x=((e.clientX-rect.left)/rect.width)*2-1;this.mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
            this.raycaster.setFromCamera(this.mouse,this.camera);
            const clickables=[];
            for(const s of this.sprites)clickables.push(s.mesh);
            for(const m of this.models)if(m.obj)m.obj.traverse(c=>{if(c.isMesh)clickables.push(c);});
            const hits=this.raycaster.intersectObjects(clickables,true);
            if(hits.length>0){let obj=hits[0].object;while(obj.parent&&this.scene.children.indexOf(obj)===-1)obj=obj.parent;this.selectObject(obj);}
        };
        
        nodeType.prototype.selectObject=function(obj){this.selectedObject=obj;this.transform.attach(obj);this.infoDisplay.textContent="Selected: "+(obj.name||"Object");};
        nodeType.prototype.deselectObject=function(){this.selectedObject=null;this.transform.detach();this.infoDisplay.textContent="Deselected";};
        
        nodeType.prototype.loadModel=function(filePath,pos,rot,scl){
            if(!filePath||filePath==="none")return;
            const parts=filePath.split("/"),filename=parts.pop(),subfolder=parts.join("/");
            let url="/view?filename="+encodeURIComponent(filename)+"&type=input";if(subfolder)url+="&subfolder="+encodeURIComponent(subfolder);
            const ext=filename.split(".").pop().toLowerCase();
            const onLoad=(obj)=>{obj.name=filename;if(pos)obj.position.set(pos[0],pos[1],pos[2]);if(rot)obj.rotation.set(THREE.MathUtils.degToRad(rot[0]),THREE.MathUtils.degToRad(rot[1]),THREE.MathUtils.degToRad(rot[2]));if(scl)obj.scale.setScalar(scl);this.scene.add(obj);this.models.push({obj,file:filePath});};
            if(ext==="gltf"||ext==="glb")new GLTFLoader().load(url,gltf=>onLoad(gltf.scene));
            else if(ext==="obj")new OBJLoader().load(url,obj=>{obj.traverse(c=>{if(c.isMesh)c.material=new THREE.MeshStandardMaterial({color:0x888888});});onLoad(obj);});
        };
        
        nodeType.prototype.addSprite=function(data){
            if(!data||!data.frames||!data.frames.length)return;
            const textures=[];let loaded=0;
            for(let i=0;i<data.frames.length;i++){
                ((idx)=>{const img=new Image();img.onload=()=>{const t=new THREE.Texture(img);t.needsUpdate=true;textures[idx]=t;loaded++;
                    if(loaded===1){const mesh=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:t,transparent:true,side:THREE.DoubleSide,alphaTest:0.1,opacity:data.opacity||1}));
                    mesh.position.set(data.position[0],data.position[1],data.position[2]);mesh.scale.setScalar(data.scale||1);mesh.name="Sprite_"+this.sprites.length;this.scene.add(mesh);this.sprites.push({mesh,textures,currentIdx:0});}
                };img.src="data:image/png;base64,"+data.frames[idx];})(i);
            }
        };
        
        nodeType.prototype.updateInputs=function(prefix,countWidget,type){
            const w=this.widgets.find(x=>x.name===countWidget);if(!w)return;
            const target=w.value,currentInputs=this.inputs?this.inputs.filter(inp=>inp.name.indexOf(prefix+"_")===0&&inp.type===type):[],current=currentInputs.length;
            if(current>target)for(let i=current;i>target;i--){const idx=this.inputs.findIndex(x=>x.name===prefix+"_"+i);if(idx>=0)this.removeInput(idx);}
            else for(let i=current+1;i<=target;i++)this.addInput(prefix+"_"+i,type);
            this.setDirtyCanvas(true,true);
        };
        
        nodeType.prototype.renderAllFrames=async function(){
            if(!this.renderer||!this.camFrames.length){this.infoDisplay.textContent="No camera frames";return;}
            if(!this.nodeId){this.infoDisplay.textContent="Run workflow first";return;}
            this.isRendering=true;this.renderBtn.disabled=true;this.renderBtn.textContent="...";
            const origW=this.renderer.domElement.width,origH=this.renderer.domElement.height;
            this.renderer.setSize(this.outputWidth,this.outputHeight);this.camera.aspect=this.outputWidth/this.outputHeight;this.camera.updateProjectionMatrix();
            if(this.grid)this.grid.visible=false;if(this.transform)this.transform.visible=false;if(this.cameraHelper)this.cameraHelper.visible=false;
            try{
                for(let fi=0;fi<this.totalFrames;fi++){
                    const cf=this.camFrames[Math.min(fi,this.camFrames.length-1)];
                    this.camera.position.set(cf.position[0],cf.position[1],cf.position[2]);
                    this.camera.rotation.set(THREE.MathUtils.degToRad(cf.rotation[0]),THREE.MathUtils.degToRad(cf.rotation[1]),THREE.MathUtils.degToRad(cf.rotation[2]));
                    if(cf.fov){this.camera.fov=cf.fov;this.camera.updateProjectionMatrix();}
                    for(const s of this.sprites)if(s.textures&&s.textures.length){const ti=fi%s.textures.length;if(s.textures[ti]){s.mesh.material.map=s.textures[ti];s.mesh.material.needsUpdate=true;}}
                    this.renderer.render(this.scene,this.camera);
                    const d=this.renderer.domElement.toDataURL('image/png').split(',')[1];
                    const fn="viewport3d_v2_"+this.nodeId+"_"+String(fi).padStart(4,'0')+".png";
                    await this.uploadFrame(fn,d);
                    this.infoDisplay.textContent="Render: "+(fi+1)+"/"+this.totalFrames;
                    await new Promise(r=>setTimeout(r,1));
                }
                this.infoDisplay.textContent="Done! Run workflow.";
            }catch(e){this.infoDisplay.textContent="Error: "+e.message;}
            if(this.grid)this.grid.visible=true;if(this.transform)this.transform.visible=true;if(this.cameraHelper)this.cameraHelper.visible=true;
            this.renderer.setSize(origW,origH);this.camera.aspect=origW/origH;this.camera.updateProjectionMatrix();
            this.isRendering=false;this.renderBtn.disabled=false;this.renderBtn.textContent="🎬 Render";
            this.animate();
        };
        
        nodeType.prototype.uploadFrame=async function(filename,base64Data){
            const bs=atob(base64Data),ab=new ArrayBuffer(bs.length),ia=new Uint8Array(ab);
            for(let i=0;i<bs.length;i++)ia[i]=bs.charCodeAt(i);
            const blob=new Blob([ab],{type:'image/png'}),fd=new FormData();
            fd.append('image',blob,filename);fd.append('type','temp');fd.append('overwrite','true');
            const r=await api.fetchApi('/upload/image',{method:'POST',body:fd});
            if(!r.ok)throw new Error('Upload failed');return r.json();
        };
        
        const onExecuted=nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted=function(msg){
            if(onExecuted)onExecuted.apply(this,arguments);
            const cfg=msg&&msg.viewport_config_v2&&msg.viewport_config_v2[0];if(!cfg)return;
            this.nodeId=cfg.node_id;this.outputWidth=cfg.width;this.outputHeight=cfg.height;
            this.fps=cfg.fps||24;this.totalFrames=cfg.num_frames||120;this.useEasing=cfg.use_easing!==false;
            if(cfg.default_camera)this.defaultCamera=cfg.default_camera;
            if(cfg.keyframe_data&&cfg.keyframe_data.keyframes){
                this.keyframes={};for(const[k,v]of Object.entries(cfg.keyframe_data.keyframes))this.keyframes[parseInt(k)]=v;
                this.rebuildKeyframeList();
            }
            this.updateTimelineDisplay();this.updateKeyframeMarkers();
            if(this.scene&&cfg.background_color)this.scene.background=new THREE.Color(cfg.background_color);
            if(this.grid)this.grid.visible=cfg.show_grid!==false;
            this.camFrames=cfg.camera_frames||[];if(this.keyframeList.length>0)this.rebuildCameraFrames();
            for(const s of this.sprites)this.scene.remove(s.mesh);this.sprites=[];
            for(const m of this.models)this.scene.remove(m.obj);this.models=[];
            if(cfg.sprites)for(const sp of cfg.sprites)this.addSprite(sp);
            if(cfg.models)for(const m of cfg.models)this.loadModel(m.file,m.position,m.rotation,m.scale);
            this.infoDisplay.textContent=cfg.width+"x"+cfg.height+" @ "+this.fps+"fps | "+this.totalFrames+" frames";
        };
        
        const onRemoved=nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved=function(){
            if(onRemoved)onRemoved.apply(this,arguments);
            this.stopPlayback();if(this.resizeInterval)clearInterval(this.resizeInterval);if(this.renderer)this.renderer.dispose();
        };
        
        const onConfigure=nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure=function(o){
            if(onConfigure)onConfigure.apply(this,arguments);
            setTimeout(()=>{
                this.updateInputs("sprite","sprite_count","3D_SPRITE");
                this.updateInputs("model","model_count","3D_MODEL");
                if(!this.renderer)this.init3D();
            },100);
        };
    }
});
