"""
ComfyVFX Video Loader — Advanced video loader with visual crop, caching, and playback.

Features:
- Load multiple video formats (mp4, avi, mov, mkv, webm, etc.)
- Visual drag-crop system with aspect ratio locking
- Output resolution control with upscaling
- Frame selection: start point, count, nth frame, reverse
- Caching: only reloads when source or settings actually change
- Outputs: IMAGE batch, audio (if available), fps, resolution
"""

import os
import json
import hashlib
import subprocess
import numpy as np
import torch
from PIL import Image

try:
    import folder_paths
except ImportError:
    folder_paths = None


# ---------------------------------------------------------------------------
# Security: allowlist of video extensions and path sanitization
# ---------------------------------------------------------------------------
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv',
                            '.wmv', '.m4v', '.gif', '.mpg', '.mpeg'}

# Executable allowlist — only these binaries may be invoked via subprocess.
_ALLOWED_EXECUTABLES = {'ffmpeg', 'ffprobe'}


def _safe_subprocess_run(cmd: list, **kwargs) -> subprocess.CompletedProcess:
    """Run *cmd* via ``subprocess.run`` after validating the executable.

    Raises ``ValueError`` if ``cmd[0]`` is not in ``_ALLOWED_EXECUTABLES``.
    Always enforces ``shell=False``.
    """
    exe = os.path.basename(cmd[0])
    # Strip .exe suffix for cross-platform compatibility
    if exe.endswith('.exe'):
        exe = exe[:-4]
    if exe not in _ALLOWED_EXECUTABLES:
        raise ValueError(f"Blocked execution of non-allowlisted program: {exe!r}")
    kwargs.pop('shell', None)  # never allow shell=True
    return subprocess.run(cmd, shell=False, **kwargs)  # noqa: S603


def _safe_video_path(filename: str) -> str | None:
    """
    Resolve *filename* to an absolute path inside the ComfyUI input directory.

    Returns the resolved path if it is safe, or ``None`` if:
    - ``folder_paths`` is unavailable
    - the filename contains path separators / traversal components
    - the resolved path escapes the input directory
    - the extension is not in the allowlist
    """
    if not folder_paths or not filename:
        return None

    # Strip to bare filename — reject anything with directory components
    basename = os.path.basename(filename)
    if not basename or basename != filename:
        return None

    # Extension allowlist
    _, ext = os.path.splitext(basename)
    if ext.lower() not in ALLOWED_VIDEO_EXTENSIONS:
        return None

    input_dir = os.path.realpath(folder_paths.get_input_directory())
    candidate = os.path.realpath(os.path.join(input_dir, basename))

    # Ensure the resolved path is still inside input_dir
    if not candidate.startswith(input_dir + os.sep) and candidate != input_dir:
        return None

    return candidate


def get_video_files():
    """Get list of video files from ComfyUI input directory."""
    if folder_paths is None:
        return []
    input_dir = folder_paths.get_input_directory()
    extensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv', '.wmv', '.m4v', '.gif', '.mpg', '.mpeg']
    files = []
    for f in os.listdir(input_dir):
        if any(f.lower().endswith(ext) for ext in extensions):
            files.append(f)
    return sorted(files)


def get_video_info(video_path):
    """Get video metadata using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-print_format', 'json',
            '-show_format', '-show_streams', video_path
        ]
        # Security: callers must validate video_path before calling this function.
        # Executable is allowlisted by _safe_subprocess_run; shell=False enforced.
        result = _safe_subprocess_run(cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            return None
        data = json.loads(result.stdout)
        
        video_stream = None
        audio_stream = None
        for stream in data.get('streams', []):
            if stream.get('codec_type') == 'video' and video_stream is None:
                video_stream = stream
            elif stream.get('codec_type') == 'audio' and audio_stream is None:
                audio_stream = stream
        
        if not video_stream:
            return None
        
        width = int(video_stream.get('width', 0))
        height = int(video_stream.get('height', 0))
        
        # Get FPS
        fps_str = video_stream.get('r_frame_rate', '24/1')
        if '/' in fps_str:
            num, den = fps_str.split('/')
            fps = float(num) / float(den) if float(den) != 0 else 24.0
        else:
            fps = float(fps_str)
        
        # Get frame count
        nb_frames = int(video_stream.get('nb_frames', 0))
        if nb_frames == 0:
            duration = float(data.get('format', {}).get('duration', 0))
            nb_frames = int(duration * fps) if duration > 0 else 0
        
        # Get duration
        duration = float(data.get('format', {}).get('duration', 0))
        
        return {
            'width': width,
            'height': height,
            'fps': round(fps, 3),
            'frame_count': nb_frames,
            'duration': duration,
            'has_audio': audio_stream is not None,
            'codec': video_stream.get('codec_name', 'unknown'),
        }
    except Exception as e:
        print(f"[VideoLoader] ffprobe error: {e}")
        return None


def extract_frames(video_path, start_frame=0, num_frames=-1, nth_frame=1, 
                   crop_x=0, crop_y=0, crop_w=0, crop_h=0,
                   output_w=0, output_h=0, fps_override=0):
    """Extract frames from video using ffmpeg."""
    info = get_video_info(video_path)
    if not info:
        return [], info
    
    src_w, src_h = info['width'], info['height']
    src_fps = info['fps']
    
    # Build ffmpeg filter chain
    filters = []
    
    # FPS override
    if fps_override > 0:
        filters.append(f"fps={fps_override}")
    
    # Frame selection: start + count
    # Use trim filter for start point
    if start_frame > 0:
        start_time = start_frame / (fps_override if fps_override > 0 else src_fps)
        filters.append(f"trim=start={start_time:.4f}")
        filters.append("setpts=PTS-STARTPTS")
    
    # Select every nth frame
    if nth_frame > 1:
        filters.append(f"select=not(mod(n\\,{nth_frame}))")
        filters.append("setpts=N/FRAME_RATE/TB")
    
    # Crop — clamp values to source dimensions
    if crop_w > 0 and crop_h > 0:
        crop_x = max(0, min(crop_x, src_w - 1))
        crop_y = max(0, min(crop_y, src_h - 1))
        crop_w = min(crop_w, src_w - crop_x)
        crop_h = min(crop_h, src_h - crop_y)
        # Ensure even dimensions for codec compatibility
        crop_w = crop_w - (crop_w % 2)
        crop_h = crop_h - (crop_h % 2)
        if crop_w > 0 and crop_h > 0 and (crop_x > 0 or crop_y > 0 or crop_w < src_w or crop_h < src_h):
            filters.append(f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y}")
    
    # Resize to output resolution
    if output_w > 0 and output_h > 0:
        filters.append(f"scale={output_w}:{output_h}:flags=lanczos")
    
    filter_str = ",".join(filters) if filters else None
    
    # Calculate how many frames to extract
    total_available = info['frame_count']
    if num_frames <= 0 or num_frames > total_available:
        frame_limit = total_available - start_frame
    else:
        frame_limit = num_frames
    
    if nth_frame > 1:
        frame_limit = frame_limit // nth_frame
    
    frame_limit = max(1, min(frame_limit, 9999))
    
    # Build ffmpeg command
    # Security: callers must validate video_path before calling this function.
    # filter_str is built from numeric parameters only (fps, trim, crop, scale).
    cmd = ['ffmpeg', '-v', 'quiet', '-i', video_path]
    
    if filter_str:
        cmd.extend(['-vf', filter_str])
    
    cmd.extend([
        '-frames:v', str(frame_limit),
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-'
    ])
    
    # Determine output frame dimensions
    if output_w > 0 and output_h > 0:
        out_w, out_h = output_w, output_h
    elif crop_w > 0 and crop_h > 0:
        out_w, out_h = crop_w, crop_h
    else:
        out_w, out_h = src_w, src_h
    
    try:
        result = _safe_subprocess_run(cmd, capture_output=True, timeout=300)
        if result.returncode != 0:
            print(f"[VideoLoader] ffmpeg error: {result.stderr[:200]}")
            return [], info
        
        raw = result.stdout
        frame_size = out_w * out_h * 3
        
        if len(raw) < frame_size:
            print(f"[VideoLoader] Not enough data: got {len(raw)} bytes, need {frame_size} per frame")
            return [], info
        
        actual_frames = len(raw) // frame_size
        frames = []
        
        for i in range(actual_frames):
            frame_data = raw[i * frame_size:(i + 1) * frame_size]
            frame = np.frombuffer(frame_data, dtype=np.uint8).reshape(out_h, out_w, 3)
            frames.append(torch.from_numpy(frame.copy().astype(np.float32) / 255.0))
        
        print(f"[VideoLoader] Extracted {len(frames)} frames at {out_w}x{out_h}")
        return frames, info
        
    except subprocess.TimeoutExpired:
        print("[VideoLoader] ffmpeg timed out")
        return [], info
    except Exception as e:
        print(f"[VideoLoader] Frame extraction error: {e}")
        return [], info


def extract_audio(video_path):
    """Extract audio as WAV bytes.

    Security: callers must validate video_path before calling.
    """
    try:
        cmd = [
            'ffmpeg', '-v', 'quiet', '-i', video_path,
            '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2',
            '-f', 'wav', '-'
        ]
        result = _safe_subprocess_run(cmd, capture_output=True, timeout=120)
        if result.returncode == 0 and len(result.stdout) > 44:
            return result.stdout
        return None
    except Exception:
        return None


# =============================================================================
# VIDEO LOADER NODE
# =============================================================================

class ComfyVFX_VideoLoader:
    """
    Advanced video loader with visual crop, caching, and full playback control.
    """
    
    # Class-level cache
    _cache = {}  # {hash: {frames, info, audio}}
    
    @classmethod
    def INPUT_TYPES(cls):
        video_files = get_video_files()
        if not video_files:
            video_files = ["none"]
        
        return {
            "required": {
                "video": (video_files, {"default": video_files[0] if video_files else "none"}),
                "start_frame": ("INT", {"default": 0, "min": 0, "max": 99999, "step": 1}),
                "num_frames": ("INT", {"default": -1, "min": -1, "max": 9999, "step": 1,
                    "tooltip": "Number of frames to load. -1 = all frames."}),
                "select_every_nth": ("INT", {"default": 1, "min": 1, "max": 30, "step": 1}),
                "reverse_output": ("BOOLEAN", {"default": False}),
                "fps_override": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 120.0, "step": 1.0,
                    "tooltip": "Override FPS. 0 = use source FPS."}),
                "output_width": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2,
                    "tooltip": "Output width. 0 = use crop/source size."}),
                "output_height": ("INT", {"default": 0, "min": 0, "max": 8192, "step": 2,
                    "tooltip": "Output height. 0 = use crop/source size."}),
            },
            "optional": {
                "crop_data": ("STRING", {"default": "{}", "multiline": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("IMAGE", "AUDIO", "FLOAT", "INT", "INT", "INT")
    RETURN_NAMES = ("images", "audio", "fps", "frame_count", "width", "height")
    FUNCTION = "load_video"
    CATEGORY = "ComfyVFX/io"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Only re-run when actual settings change."""
        import hashlib as _hl
        parts = []
        for k in ["video", "start_frame", "num_frames", "select_every_nth", "reverse_output",
                   "fps_override", "output_width", "output_height", "crop_data"]:
            parts.append(f"{k}={kwargs.get(k, '')}")
        return _hl.md5("|".join(parts).encode()).hexdigest()
    
    @classmethod
    def VALIDATE_INPUTS(cls, video, **kwargs):
        if video == "none":
            return "No video file selected"
        return True
    
    def _compute_cache_hash(self, **kwargs):
        parts = []
        for k in ["video", "start_frame", "num_frames", "select_every_nth", "reverse_output",
                   "fps_override", "output_width", "output_height", "crop_data"]:
            parts.append(f"{k}={kwargs.get(k, '')}")
        
        # Also include file modification time for cache invalidation
        video = kwargs.get("video", "")
        if video and video != "none":
            video_path = _safe_video_path(video)
            if video_path and os.path.exists(video_path):
                parts.append(f"mtime={os.path.getmtime(video_path)}")
        
        return hashlib.md5("|".join(parts).encode()).hexdigest()
    
    def load_video(self, video, start_frame, num_frames, select_every_nth, reverse_output,
                   fps_override, output_width, output_height,
                   crop_data="{}", unique_id=None, **kwargs):
        
        # Empty audio placeholder (ComfyUI needs a valid value, not None)
        empty_audio = {"waveform": torch.zeros(1, 2, 1), "sample_rate": 44100}
        
        if video == "none":
            empty = torch.zeros(1, 64, 64, 3)
            return {"ui": {"video_info": [{}]}, "result": (empty, empty_audio, 24.0, 0, 64, 64)}
        
        # Resolve video path — use the same validation as the HTTP endpoints
        video_path = _safe_video_path(video)
        if video_path is None:
            print(f"[VideoLoader] Rejected unsafe video path: {video!r}")
            empty = torch.zeros(1, 64, 64, 3)
            return {"ui": {"video_info": [{}]}, "result": (empty, empty_audio, 24.0, 0, 64, 64)}
        
        if not os.path.exists(video_path):
            print(f"[VideoLoader] File not found: {video_path}")
            empty = torch.zeros(1, 64, 64, 3)
            return {"ui": {"video_info": [{}]}, "result": (empty, empty_audio, 24.0, 0, 64, 64)}
        
        # Parse crop from crop_data JSON
        crop_x, crop_y, crop_w, crop_h = 0, 0, 0, 0
        try:
            crop_json = json.loads(str(crop_data)) if crop_data and str(crop_data) != "{}" else {}
            if crop_json:
                crop_x = int(crop_json.get("x", 0))
                crop_y = int(crop_json.get("y", 0))
                crop_w = int(crop_json.get("w", 0))
                crop_h = int(crop_json.get("h", 0))
        except:
            pass
        
        # Check cache
        cache_hash = self._compute_cache_hash(
            video=video, start_frame=start_frame, num_frames=num_frames,
            select_every_nth=select_every_nth, reverse_output=reverse_output,
            fps_override=fps_override, crop_x=crop_x, crop_y=crop_y,
            crop_w=crop_w, crop_h=crop_h, output_width=output_width,
            output_height=output_height, crop_data=crop_data
        )
        
        if cache_hash in ComfyVFX_VideoLoader._cache:
            cached = ComfyVFX_VideoLoader._cache[cache_hash]
            print(f"[VideoLoader] CACHE HIT — {cached['info'].get('frame_count', 0)} frames")
            return cached['result']
        
        # Get video info first
        info = get_video_info(video_path)
        if not info:
            print(f"[VideoLoader] Could not read video info")
            empty = torch.zeros(1, 64, 64, 3)
            return {"ui": {"video_info": [{}]}, "result": (empty, empty_audio, 24.0, 0, 64, 64)}
        
        print(f"[VideoLoader] Loading: {video} ({info['width']}x{info['height']}, "
              f"{info['fps']}fps, {info['frame_count']} frames)")
        
        # Extract frames
        frames, _ = extract_frames(
            video_path, start_frame=start_frame, num_frames=num_frames,
            nth_frame=select_every_nth,
            crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
            output_w=output_width, output_h=output_height,
            fps_override=fps_override
        )
        
        if not frames:
            print("[VideoLoader] No frames extracted")
            empty = torch.zeros(1, 64, 64, 3)
            return {"ui": {"video_info": [info]}, "result": (empty, empty_audio, info['fps'], 0, 64, 64)}
        
        # Reverse if requested
        if reverse_output:
            frames = frames[::-1]
        
        # Stack frames
        image_batch = torch.stack(frames, dim=0)
        out_h, out_w = image_batch.shape[1], image_batch.shape[2]
        
        # Output FPS
        out_fps = fps_override if fps_override > 0 else info['fps']
        if select_every_nth > 1:
            out_fps = out_fps / select_every_nth
        
        # Extract audio
        audio = empty_audio
        if info.get('has_audio'):
            audio_bytes = extract_audio(video_path)
            if audio_bytes and len(audio_bytes) > 44:
                try:
                    # Parse WAV manually — ffmpeg outputs pcm_s16le, 44100Hz, stereo
                    # WAV header is 44 bytes, then raw PCM data
                    import struct
                    
                    # Read sample rate from WAV header (bytes 24-27)
                    sr = struct.unpack_from('<I', audio_bytes, 24)[0]
                    num_channels = struct.unpack_from('<H', audio_bytes, 22)[0]
                    
                    # Find data chunk
                    data_offset = 44  # standard WAV
                    pcm_data = audio_bytes[data_offset:]
                    
                    # Convert s16le PCM to float32 tensor
                    samples = np.frombuffer(pcm_data, dtype=np.int16).astype(np.float32) / 32768.0
                    
                    # Reshape to (channels, num_samples)
                    if num_channels > 1:
                        samples = samples.reshape(-1, num_channels).T
                    else:
                        samples = samples.reshape(1, -1)
                    
                    audio_tensor = torch.from_numpy(samples)
                    # ComfyUI AUDIO format: {"waveform": (batch, channels, samples), "sample_rate": int}
                    audio = {"waveform": audio_tensor.unsqueeze(0), "sample_rate": sr}
                    print(f"[VideoLoader] Audio extracted: {sr}Hz, {num_channels}ch, {audio_tensor.shape[1]} samples")
                except Exception as e:
                    print(f"[VideoLoader] Audio parsing failed: {e}")
                    audio = empty_audio
        
        # Build preview thumbnails for JS
        preview_frames = []
        if folder_paths:
            temp_dir = folder_paths.get_temp_directory()
            # Send ALL frames as small thumbnails for smooth playback
            max_dim = 480
            for i in range(len(frames)):
                thumb = frames[i]
                pil_img = Image.fromarray((thumb.numpy() * 255).astype(np.uint8))
                tw, th = pil_img.width, pil_img.height
                if tw > max_dim or th > max_dim:
                    scale = max_dim / max(tw, th)
                    pil_img = pil_img.resize((int(tw * scale), int(th * scale)), Image.Resampling.LANCZOS)
                
                fname = f"vl_preview_{unique_id}_{i}.jpg"
                fpath = os.path.join(temp_dir, fname)
                pil_img.save(fpath, quality=75)
                preview_frames.append({
                    "filename": fname,
                    "subfolder": "",
                    "type": "temp",
                    "frame_idx": i,
                })
        
        # Also save first frame full-size for crop preview
        first_frame_info = None
        if folder_paths and len(frames) > 0:
            temp_dir = folder_paths.get_temp_directory()
            # Save original (pre-crop) first frame for crop UI
            orig_frames, _ = extract_frames(video_path, start_frame=start_frame, num_frames=1,
                                            nth_frame=1, crop_x=0, crop_y=0, crop_w=0, crop_h=0,
                                            output_w=0, output_h=0, fps_override=0)
            if orig_frames:
                pil_orig = Image.fromarray((orig_frames[0].numpy() * 255).astype(np.uint8))
                fname = f"vl_original_{unique_id}.jpg"
                fpath = os.path.join(temp_dir, fname)
                pil_orig.save(fpath, quality=90)
                first_frame_info = {
                    "filename": fname, "subfolder": "", "type": "temp",
                    "width": pil_orig.width, "height": pil_orig.height,
                }
        
        ui_data = {
            "video_info": [{
                "width": info['width'],
                "height": info['height'],
                "fps": info['fps'],
                "frame_count": info['frame_count'],
                "duration": info['duration'],
                "has_audio": info.get('has_audio', False),
                "codec": info.get('codec', 'unknown'),
                "output_width": out_w,
                "output_height": out_h,
                "output_fps": out_fps,
                "output_frames": len(frames),
            }],
            "preview_frames": preview_frames,
            "original_frame": [first_frame_info] if first_frame_info else [],
        }
        
        result = {
            "ui": ui_data,
            "result": (image_batch, audio, out_fps, len(frames), out_w, out_h)
        }
        
        # Cache the result
        ComfyVFX_VideoLoader._cache = {cache_hash: {"result": result, "info": info}}
        
        print(f"[VideoLoader] Output: {len(frames)} frames at {out_w}x{out_h}, {out_fps:.2f}fps")
        
        return result


# =============================================================================
# SERVER API — Live video preview (no execution needed)
# =============================================================================

try:
    from aiohttp import web
    from server import PromptServer
    import asyncio
    
    @PromptServer.instance.routes.get("/comfyvfx/video_preview")
    async def video_preview_handler(request):
        """Return a single frame as JPEG."""
        filename = request.query.get("filename", "")
        try:
            frame_idx = max(0, int(request.query.get("frame", 0)))
        except (ValueError, TypeError):
            frame_idx = 0
        
        video_path = _safe_video_path(filename)
        if video_path is None:
            return web.json_response({"error": "Invalid filename"}, status=400)
        
        if not os.path.exists(video_path):
            return web.json_response({"error": "File not found"}, status=404)
        
        info = get_video_info(video_path)
        if not info:
            return web.json_response({"error": "Cannot read video"}, status=500)
        
        ss_args = []
        if frame_idx > 0 and info['fps'] > 0:
            ss_args = ['-ss', str(frame_idx / info['fps'])]
        
        # Security: video_path is validated by _safe_video_path() above (extension
        # allowlist + directory containment).  ss_args is derived from numeric
        # frame_idx / fps.  Executable allowlisted by _safe_subprocess_run; shell=False enforced.
        cmd = ['ffmpeg', '-v', 'quiet'] + ss_args + ['-i', video_path,
               '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', '-']
        
        try:
            result = _safe_subprocess_run(cmd, capture_output=True, timeout=10)
            if result.returncode != 0 or len(result.stdout) < 100:
                return web.json_response({"error": "Frame extraction failed"}, status=500)
            
            return web.Response(body=result.stdout, content_type="image/jpeg",
                headers={"X-Video-Width": str(info['width']), "X-Video-Height": str(info['height']),
                         "X-Video-FPS": str(info['fps']), "X-Video-Frames": str(info['frame_count'])})
        except Exception as e:
            return web.json_response({"error": str(e)}, status=500)
    
    @PromptServer.instance.routes.get("/comfyvfx/video_stream")
    async def video_stream_handler(request):
        """Stream video as webm for native <video> element playback."""
        filename = request.query.get("filename", "")

        video_path = _safe_video_path(filename)
        if video_path is None:
            return web.Response(status=400)
        
        if not os.path.exists(video_path):
            return web.Response(status=404)
        
        try:
            target_width = max(64, min(3840, int(request.query.get("width", 640))))
        except (ValueError, TypeError):
            target_width = 640
        
        # Security: video_path validated by _safe_video_path(); target_width is
        # clamped to int in [64, 3840].  All args passed as list (no shell).
        args = ['ffmpeg', '-v', 'error', '-i', video_path,
                '-vf', f"scale={target_width}:-2",
                '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8',
                '-b:v', '0', '-crf', '40',
                '-c:a', 'libopus', '-b:a', '64k',
                '-f', 'webm', '-']
        
        try:
            proc = await asyncio.create_subprocess_exec(  # noqa: S603
                *args,
                stdout=asyncio.subprocess.PIPE, stdin=asyncio.subprocess.DEVNULL)
            resp = web.StreamResponse()
            resp.content_type = 'video/webm'
            await resp.prepare(request)
            while True:
                chunk = await proc.stdout.read(2**20)
                if not chunk:
                    break
                await resp.write(chunk)
            await proc.wait()
        except (ConnectionResetError, ConnectionError, BrokenPipeError):
            try:
                proc.kill()
            except:
                pass
        return resp
    
    @PromptServer.instance.routes.get("/comfyvfx/video_info")
    async def video_info_handler(request):
        """Return video metadata."""
        filename = request.query.get("filename", "")

        video_path = _safe_video_path(filename)
        if video_path is None:
            return web.json_response({"error": "Invalid filename"}, status=400)
        
        if not os.path.exists(video_path):
            return web.json_response({"error": "File not found"}, status=404)
        
        info = get_video_info(video_path)
        if not info:
            return web.json_response({"error": "Cannot read video"}, status=500)
        
        return web.json_response(info)

    print("[VideoLoader] API routes registered: /comfyvfx/video_preview, /comfyvfx/video_stream, /comfyvfx/video_info")

except Exception as e:
    print(f"[VideoLoader] Could not register API routes: {e}")


# =============================================================================
# NODE REGISTRATION
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_VideoLoader": ComfyVFX_VideoLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_VideoLoader": "Video Loader (ComfyVFX)",
}
