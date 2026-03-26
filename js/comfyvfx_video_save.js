/**
 * ComfyVFX Video Save - Professional Video Preview with Timeline
 * Features: Scrubbing timeline, playback controls, clean minimal UI
 */

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const EXT_NAME = "ComfyVFX.VideoSave";

// Styles for the video player UI
const PLAYER_STYLES = `
.comfyvfx-video-player {
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    border-radius: 8px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.comfyvfx-video-container {
    position: relative;
    width: 100%;
    background: #000;
    aspect-ratio: 16/9;
    display: flex;
    align-items: center;
    justify-content: center;
}

.comfyvfx-video-container video,
.comfyvfx-video-container img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

.comfyvfx-placeholder {
    color: #666;
    font-size: 14px;
    text-align: center;
    padding: 40px;
}

.comfyvfx-controls {
    display: flex;
    flex-direction: column;
    padding: 8px 12px;
    gap: 8px;
    background: #252525;
}

/* Timeline/Scrubber */
.comfyvfx-timeline {
    position: relative;
    height: 6px;
    background: #3a3a3a;
    border-radius: 3px;
    cursor: pointer;
    margin: 4px 0;
}

.comfyvfx-timeline-progress {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: linear-gradient(90deg, #4a9eff, #7b68ee);
    border-radius: 3px;
    pointer-events: none;
    transition: width 0.05s linear;
}

.comfyvfx-timeline-handle {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 14px;
    height: 14px;
    background: #fff;
    border-radius: 50%;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    pointer-events: none;
    transition: transform 0.1s ease;
}

.comfyvfx-timeline:hover .comfyvfx-timeline-handle {
    transform: translate(-50%, -50%) scale(1.2);
}

/* Playback Buttons Row */
.comfyvfx-buttons-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
}

.comfyvfx-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: #ccc;
    cursor: pointer;
    transition: all 0.15s ease;
    font-size: 14px;
}

.comfyvfx-btn:hover {
    background: #3a3a3a;
    color: #fff;
}

.comfyvfx-btn:active {
    transform: scale(0.95);
}

.comfyvfx-btn-play {
    width: 40px;
    height: 40px;
    background: #4a9eff;
    color: #fff;
    font-size: 16px;
}

.comfyvfx-btn-play:hover {
    background: #5aabff;
}

/* Frame Counter */
.comfyvfx-frame-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: #888;
    padding: 0 4px;
}

.comfyvfx-frame-counter {
    font-family: "SF Mono", Monaco, monospace;
    font-variant-numeric: tabular-nums;
}

.comfyvfx-time-display {
    font-family: "SF Mono", Monaco, monospace;
    font-variant-numeric: tabular-nums;
}

/* Video Info Bar */
.comfyvfx-info-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 6px 12px;
    background: #1e1e1e;
    font-size: 10px;
    color: #666;
    border-top: 1px solid #333;
}

.comfyvfx-info-item {
    display: flex;
    align-items: center;
    gap: 4px;
}

.comfyvfx-info-label {
    color: #888;
}

/* Speed Control */
.comfyvfx-speed-btn {
    font-size: 10px;
    width: auto;
    padding: 0 8px;
    height: 24px;
}

/* Loading state */
.comfyvfx-loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #666;
}

@keyframes spin {
    to { transform: translate(-50%, -50%) rotate(360deg); }
}

.comfyvfx-loading.active {
    animation: spin 1s linear infinite;
}
`;

// SVG Icons
const ICONS = {
    skipStart: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>`,
    prevFrame: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm10 0l-8 6 8 6z"/></svg>`,
    playBackward: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M19 12L8 5v14l11-7zm-9 0L2 5v14l8-7z"/></svg>`,
    pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>`,
    play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    playForward: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5 12l11-7v14L5 12zm9 0l8-7v14l-8-7z"/></svg>`,
    nextFrame: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-8 0l8 6-8 6z"/></svg>`,
    skipEnd: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>`,
};

// Speed presets
const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2];

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

function injectStyles() {
    if (document.getElementById('comfyvfx-video-styles')) return;
    const style = document.createElement('style');
    style.id = 'comfyvfx-video-styles';
    style.textContent = PLAYER_STYLES;
    document.head.appendChild(style);
}

class VideoPlayerWidget {
    constructor(node) {
        this.node = node;
        this.currentFrame = 0;
        this.totalFrames = 0;
        this.fps = 24;
        this.isPlaying = false;
        this.playDirection = 1; // 1 forward, -1 backward
        this.playbackSpeed = 1;
        this.playInterval = null;
        this.frames = [];
        this.videoInfo = null;
        this.videoElement = null;
        this.useVideo = false;
        
        this.createElement();
    }
    
    createElement() {
        injectStyles();
        
        this.container = document.createElement('div');
        this.container.className = 'comfyvfx-video-player';
        
        // Video/Image container
        this.mediaContainer = document.createElement('div');
        this.mediaContainer.className = 'comfyvfx-video-container';
        
        // Placeholder
        this.placeholder = document.createElement('div');
        this.placeholder.className = 'comfyvfx-placeholder';
        this.placeholder.textContent = 'Run workflow to preview video';
        this.mediaContainer.appendChild(this.placeholder);
        
        // Video element (for actual video playback)
        this.videoElement = document.createElement('video');
        this.videoElement.loop = false;
        this.videoElement.muted = true;
        this.videoElement.style.display = 'none';
        this.videoElement.addEventListener('loadedmetadata', () => {
            this.onVideoLoaded();
        });
        this.videoElement.addEventListener('timeupdate', () => {
            if (this.useVideo && !this.isScrubbing) {
                this.updateTimelineFromVideo();
            }
        });
        this.videoElement.addEventListener('ended', () => {
            if (this.playDirection === 1) {
                this.pause();
                this.currentFrame = this.totalFrames - 1;
                this.updateUI();
            }
        });
        this.mediaContainer.appendChild(this.videoElement);
        
        // Image element (for frame-by-frame)
        this.imageElement = document.createElement('img');
        this.imageElement.style.display = 'none';
        this.mediaContainer.appendChild(this.imageElement);
        
        this.container.appendChild(this.mediaContainer);
        
        // Controls container
        this.controlsContainer = document.createElement('div');
        this.controlsContainer.className = 'comfyvfx-controls';
        
        // Timeline
        this.timeline = document.createElement('div');
        this.timeline.className = 'comfyvfx-timeline';
        
        this.timelineProgress = document.createElement('div');
        this.timelineProgress.className = 'comfyvfx-timeline-progress';
        this.timeline.appendChild(this.timelineProgress);
        
        this.timelineHandle = document.createElement('div');
        this.timelineHandle.className = 'comfyvfx-timeline-handle';
        this.timeline.appendChild(this.timelineHandle);
        
        this.setupTimelineEvents();
        this.controlsContainer.appendChild(this.timeline);
        
        // Frame info row
        this.frameInfoRow = document.createElement('div');
        this.frameInfoRow.className = 'comfyvfx-frame-info';
        
        this.frameCounter = document.createElement('span');
        this.frameCounter.className = 'comfyvfx-frame-counter';
        this.frameCounter.textContent = '0 / 0';
        
        this.timeDisplay = document.createElement('span');
        this.timeDisplay.className = 'comfyvfx-time-display';
        this.timeDisplay.textContent = '0:00.00 / 0:00.00';
        
        this.frameInfoRow.appendChild(this.frameCounter);
        this.frameInfoRow.appendChild(this.timeDisplay);
        this.controlsContainer.appendChild(this.frameInfoRow);
        
        // Buttons row
        this.buttonsRow = document.createElement('div');
        this.buttonsRow.className = 'comfyvfx-buttons-row';
        
        // Create buttons
        this.btnSkipStart = this.createButton(ICONS.skipStart, () => this.skipToStart());
        this.btnPrevFrame = this.createButton(ICONS.prevFrame, () => this.prevFrame());
        this.btnPlayBackward = this.createButton(ICONS.playBackward, () => this.playBackward());
        this.btnPlayPause = this.createButton(ICONS.play, () => this.togglePlay(), 'comfyvfx-btn-play');
        this.btnPlayForward = this.createButton(ICONS.playForward, () => this.playForward());
        this.btnNextFrame = this.createButton(ICONS.nextFrame, () => this.nextFrame());
        this.btnSkipEnd = this.createButton(ICONS.skipEnd, () => this.skipToEnd());
        
        // Speed button
        this.btnSpeed = document.createElement('button');
        this.btnSpeed.className = 'comfyvfx-btn comfyvfx-speed-btn';
        this.btnSpeed.textContent = '1x';
        this.btnSpeed.addEventListener('click', () => this.cycleSpeed());
        
        this.buttonsRow.appendChild(this.btnSkipStart);
        this.buttonsRow.appendChild(this.btnPrevFrame);
        this.buttonsRow.appendChild(this.btnPlayBackward);
        this.buttonsRow.appendChild(this.btnPlayPause);
        this.buttonsRow.appendChild(this.btnPlayForward);
        this.buttonsRow.appendChild(this.btnNextFrame);
        this.buttonsRow.appendChild(this.btnSkipEnd);
        this.buttonsRow.appendChild(this.btnSpeed);
        
        this.controlsContainer.appendChild(this.buttonsRow);
        this.container.appendChild(this.controlsContainer);
        
        // Info bar
        this.infoBar = document.createElement('div');
        this.infoBar.className = 'comfyvfx-info-bar';
        const readySpan = document.createElement('span');
        readySpan.className = 'comfyvfx-info-item';
        readySpan.textContent = 'Ready';
        this.infoBar.appendChild(readySpan);
        this.container.appendChild(this.infoBar);
    }
    
    createButton(iconHtml, onClick, extraClass = '') {
        const btn = document.createElement('button');
        btn.className = `comfyvfx-btn ${extraClass}`;
        // ICONS are trusted static SVG constants defined in this file
        btn.insertAdjacentHTML('afterbegin', iconHtml);
        btn.addEventListener('click', onClick);
        return btn;
    }
    
    setupTimelineEvents() {
        this.isScrubbing = false;
        
        const handleScrub = (e) => {
            const rect = this.timeline.getBoundingClientRect();
            const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
            const progress = x / rect.width;
            this.scrubTo(progress);
        };
        
        this.timeline.addEventListener('mousedown', (e) => {
            this.isScrubbing = true;
            this.wasPlaying = this.isPlaying;
            if (this.isPlaying) this.pause();
            handleScrub(e);
            
            const onMouseMove = (e) => handleScrub(e);
            const onMouseUp = () => {
                this.isScrubbing = false;
                if (this.wasPlaying) {
                    this.play();
                }
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }
    
    scrubTo(progress) {
        const frame = Math.round(progress * (this.totalFrames - 1));
        this.currentFrame = Math.max(0, Math.min(frame, this.totalFrames - 1));
        
        if (this.useVideo && this.videoElement.duration) {
            this.videoElement.currentTime = progress * this.videoElement.duration;
        }
        
        this.updateUI();
        this.showFrame(this.currentFrame);
    }
    
    updateTimelineFromVideo() {
        if (!this.videoElement.duration) return;
        const progress = this.videoElement.currentTime / this.videoElement.duration;
        this.currentFrame = Math.round(progress * (this.totalFrames - 1));
        this.updateUI();
    }
    
    onVideoLoaded() {
        this.placeholder.style.display = 'none';
        this.videoElement.style.display = 'block';
        this.imageElement.style.display = 'none';
        this.useVideo = true;
        
        // Update aspect ratio
        const ratio = this.videoElement.videoWidth / this.videoElement.videoHeight;
        this.mediaContainer.style.aspectRatio = ratio.toString();
        
        this.updateUI();
    }
    
    setVideoSource(videoInfo, frames) {
        this.videoInfo = videoInfo;
        this.frames = frames || [];
        this.totalFrames = videoInfo.frame_count || frames.length || 0;
        this.fps = videoInfo.fps || 24;
        this.currentFrame = 0;
        
        // Try to load actual video file
        if (videoInfo.filename && !videoInfo.filename.endsWith('.png')) {
            const params = new URLSearchParams({
                filename: videoInfo.filename,
                subfolder: videoInfo.subfolder || '',
                type: videoInfo.type || 'output',
            });
            this.videoElement.src = api.apiURL(`/view?${params}`);
            this.videoElement.style.display = 'block';
            this.imageElement.style.display = 'none';
            this.useVideo = true;
        } else if (frames.length > 0) {
            // Use frame-by-frame mode
            this.useVideo = false;
            this.videoElement.style.display = 'none';
            this.imageElement.style.display = 'block';
            this.showFrame(0);
        }
        
        this.placeholder.style.display = 'none';
        this.updateInfoBar();
        this.updateUI();
    }
    
    showFrame(frameIndex) {
        if (this.useVideo) {
            // For video mode, seek to time
            if (this.videoElement.duration && !this.isPlaying) {
                const time = (frameIndex / this.totalFrames) * this.videoElement.duration;
                this.videoElement.currentTime = time;
            }
            return;
        }
        
        // Frame-by-frame mode
        if (!this.frames.length) return;
        
        // Find closest frame in our preview frames
        let closestFrame = this.frames[0];
        let closestDist = Math.abs(this.frames[0].frame_index - frameIndex);
        
        for (const f of this.frames) {
            const dist = Math.abs(f.frame_index - frameIndex);
            if (dist < closestDist) {
                closestDist = dist;
                closestFrame = f;
            }
        }
        
        if (closestFrame) {
            const params = new URLSearchParams({
                filename: closestFrame.filename,
                subfolder: closestFrame.subfolder || '',
                type: closestFrame.type || 'temp',
            });
            this.imageElement.src = api.apiURL(`/view?${params}`);
            
            // Update aspect ratio on first load
            if (!this.imageElement.dataset.loaded) {
                this.imageElement.onload = () => {
                    const ratio = this.imageElement.naturalWidth / this.imageElement.naturalHeight;
                    this.mediaContainer.style.aspectRatio = ratio.toString();
                    this.imageElement.dataset.loaded = 'true';
                };
            }
        }
    }
    
    updateUI() {
        // Update timeline
        const progress = this.totalFrames > 1 ? this.currentFrame / (this.totalFrames - 1) : 0;
        this.timelineProgress.style.width = `${progress * 100}%`;
        this.timelineHandle.style.left = `${progress * 100}%`;
        
        // Update frame counter
        this.frameCounter.textContent = `${this.currentFrame + 1} / ${this.totalFrames}`;
        
        // Update time display
        const currentTime = this.currentFrame / this.fps;
        const totalTime = this.totalFrames / this.fps;
        this.timeDisplay.textContent = `${formatTime(currentTime)} / ${formatTime(totalTime)}`;
        
        // Update play button icon — ICONS are trusted static SVG constants
        this.btnPlayPause.textContent = '';
        this.btnPlayPause.insertAdjacentHTML('afterbegin', this.isPlaying ? ICONS.pause : ICONS.play);
    }
    
    updateInfoBar() {
        this.infoBar.textContent = '';
        if (!this.videoInfo) {
            const readySpan = document.createElement('span');
            readySpan.className = 'comfyvfx-info-item';
            readySpan.textContent = 'Ready';
            this.infoBar.appendChild(readySpan);
            return;
        }
        
        const { width, height, fps, format, duration } = this.videoInfo;
        const items = [];
        
        if (width && height) items.push(`${width}×${height}`);
        if (fps) items.push(`${fps}fps`);
        if (format) items.push(String(format).toUpperCase());
        if (duration) items.push(`${Number(duration).toFixed(2)}s`);
        
        for (const text of items) {
            const span = document.createElement('span');
            span.className = 'comfyvfx-info-item';
            span.textContent = text;
            this.infoBar.appendChild(span);
        }
    }
    
    // Playback controls
    play() {
        if (this.isPlaying) return;
        this.isPlaying = true;
        
        if (this.useVideo) {
            this.videoElement.playbackRate = this.playbackSpeed * this.playDirection;
            if (this.playDirection === -1) {
                // For reverse playback with video, use frame stepping
                this.startFrameStepping();
            } else {
                this.videoElement.play();
            }
        } else {
            this.startFrameStepping();
        }
        
        this.updateUI();
    }
    
    pause() {
        this.isPlaying = false;
        this.videoElement.pause();
        this.stopFrameStepping();
        this.updateUI();
    }
    
    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.playDirection = 1;
            this.play();
        }
    }
    
    playForward() {
        this.playDirection = 1;
        if (this.useVideo) {
            this.stopFrameStepping();
            this.videoElement.playbackRate = this.playbackSpeed;
            this.videoElement.play();
        }
        this.play();
    }
    
    playBackward() {
        this.playDirection = -1;
        this.play();
    }
    
    startFrameStepping() {
        this.stopFrameStepping();
        const interval = 1000 / (this.fps * this.playbackSpeed);
        
        this.playInterval = setInterval(() => {
            this.currentFrame += this.playDirection;
            
            if (this.currentFrame >= this.totalFrames) {
                this.currentFrame = this.totalFrames - 1;
                this.pause();
            } else if (this.currentFrame < 0) {
                this.currentFrame = 0;
                this.pause();
            }
            
            this.showFrame(this.currentFrame);
            this.updateUI();
        }, interval);
    }
    
    stopFrameStepping() {
        if (this.playInterval) {
            clearInterval(this.playInterval);
            this.playInterval = null;
        }
    }
    
    nextFrame() {
        this.pause();
        this.currentFrame = Math.min(this.currentFrame + 1, this.totalFrames - 1);
        this.showFrame(this.currentFrame);
        this.updateUI();
    }
    
    prevFrame() {
        this.pause();
        this.currentFrame = Math.max(this.currentFrame - 1, 0);
        this.showFrame(this.currentFrame);
        this.updateUI();
    }
    
    skipToStart() {
        this.pause();
        this.currentFrame = 0;
        this.showFrame(0);
        this.updateUI();
    }
    
    skipToEnd() {
        this.pause();
        this.currentFrame = this.totalFrames - 1;
        this.showFrame(this.currentFrame);
        this.updateUI();
    }
    
    cycleSpeed() {
        const currentIndex = SPEED_PRESETS.indexOf(this.playbackSpeed);
        const nextIndex = (currentIndex + 1) % SPEED_PRESETS.length;
        this.playbackSpeed = SPEED_PRESETS[nextIndex];
        this.btnSpeed.textContent = `${this.playbackSpeed}x`;
        
        if (this.isPlaying && this.useVideo && this.playDirection === 1) {
            this.videoElement.playbackRate = this.playbackSpeed;
        } else if (this.isPlaying) {
            // Restart frame stepping with new speed
            this.startFrameStepping();
        }
    }
    
    destroy() {
        this.pause();
        this.container.remove();
    }
}

app.registerExtension({
    name: EXT_NAME,
    
    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "ComfyVFX_VideoSave") return;
        
        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function() {
            if (onNodeCreated) onNodeCreated.apply(this, arguments);
            
            // Create video player widget
            this.videoPlayer = new VideoPlayerWidget(this);
            
            // Add as DOM widget
            this.addDOMWidget("video_preview", "div", this.videoPlayer.container, {
                serialize: false,
                hideOnZoom: false,
            });
            
            // Set initial size
            this.setSize([380, 500]);
        };
        
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            
            if (message?.videos?.[0]) {
                const videoInfo = message.videos[0];
                const frames = message.frames || [];
                this.videoPlayer.setVideoSource(videoInfo, frames);
            }
        };
        
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function() {
            if (onRemoved) onRemoved.apply(this, arguments);
            if (this.videoPlayer) {
                this.videoPlayer.destroy();
            }
        };
        
        // Add context menu options
        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function(_, options) {
            if (getExtraMenuOptions) getExtraMenuOptions.apply(this, arguments);
            
            const videoInfo = this.videoPlayer?.videoInfo;
            if (!videoInfo?.filename) return;
            
            const newOptions = [];
            
            // Open in new tab
            newOptions.push({
                content: "Open Video",
                callback: () => {
                    const params = new URLSearchParams({
                        filename: videoInfo.filename,
                        subfolder: videoInfo.subfolder || '',
                        type: videoInfo.type || 'output',
                    });
                    window.open(api.apiURL(`/view?${params}`), '_blank');
                }
            });
            
            // Download
            newOptions.push({
                content: "Download Video",
                callback: () => {
                    const params = new URLSearchParams({
                        filename: videoInfo.filename,
                        subfolder: videoInfo.subfolder || '',
                        type: videoInfo.type || 'output',
                    });
                    const a = document.createElement('a');
                    a.href = api.apiURL(`/view?${params}`);
                    a.download = videoInfo.filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                }
            });
            
            // Copy path
            if (videoInfo.fullpath) {
                newOptions.push({
                    content: "Copy File Path",
                    callback: async () => {
                        await navigator.clipboard.writeText(videoInfo.fullpath);
                    }
                });
            }
            
            if (newOptions.length > 0) {
                options.unshift(null); // Separator
                options.unshift(...newOptions);
            }
        };
    }
});

console.log(`[${EXT_NAME}] loaded`);
