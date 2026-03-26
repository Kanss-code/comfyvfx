"""
ComfyVFX - 3D Viewport V2 (Beta)

Enhanced 3D Viewport with:
- 16:9 aspect ratio display (1280x720 default)
- Scrubbing timeline with playhead
- Transform tools (Grab, Rotate, Scale) 
- Full playback controls with keyframe navigation
- Camera keyframe system with A/B point interpolation
- Camera file loader for GLTF/GLB camera data
- All original viewport functionality preserved
"""

import math
import json
import os
import struct
import base64
import numpy as np
import torch
from PIL import Image

try:
    import folder_paths
except ImportError:
    folder_paths = None



def hex_to_rgb(hex_color):
    """Convert hex color string to RGB tuple."""
    if not hex_color:
        return (0, 0, 0)
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    return (0, 0, 0)


def get_3d_files():
    """Get list of 3D files in input/3d directory."""
    files = ["none"]
    if folder_paths:
        input_dir = folder_paths.get_input_directory()
        dir_3d = os.path.join(input_dir, "3d")
        if os.path.exists(dir_3d):
            for root, dirs, filenames in os.walk(dir_3d):
                for f in filenames:
                    if f.lower().endswith(('.gltf', '.glb', '.obj', '.fbx')):
                        rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                        files.append(rel_path.replace('\\', '/'))
    return files


def get_camera_files():
    """Get list of camera-compatible 3D files (GLTF/GLB with camera data)."""
    files = ["none"]
    if folder_paths:
        input_dir = folder_paths.get_input_directory()
        dir_3d = os.path.join(input_dir, "3d")
        if os.path.exists(dir_3d):
            for root, dirs, filenames in os.walk(dir_3d):
                for f in filenames:
                    if f.lower().endswith(('.gltf', '.glb')):
                        rel_path = os.path.relpath(os.path.join(root, f), input_dir)
                        files.append(rel_path.replace('\\', '/'))
    return files


def image_to_base64_rgba(img_tensor, remove_black=True):
    """Convert tensor to base64 PNG with transparency."""
    if img_tensor.dim() == 4:
        img_tensor = img_tensor[0]
    
    img_np = (img_tensor.cpu().numpy() * 255).astype(np.uint8)
    pil_img = Image.fromarray(img_np).convert('RGBA')
    
    if remove_black:
        data = np.array(pil_img)
        mask = (data[:,:,0] < 15) & (data[:,:,1] < 15) & (data[:,:,2] < 15)
        data[mask, 3] = 0
        pil_img = Image.fromarray(data, 'RGBA')
    
    import io
    buffer = io.BytesIO()
    pil_img.save(buffer, format='PNG')
    return base64.b64encode(buffer.getvalue()).decode('utf-8')


def lerp(a, b, t):
    """Linear interpolation between a and b by t."""
    return a + (b - a) * t


def lerp_vec3(a, b, t):
    """Linear interpolation for 3D vectors."""
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]


def ease_in_out(t):
    """Smooth ease in-out function."""
    return t * t * (3.0 - 2.0 * t)


# =============================================================================
# 3D MATH UTILITIES
# =============================================================================

def rotation_matrix_x(angle_deg):
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

def rotation_matrix_y(angle_deg):
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def rotation_matrix_z(angle_deg):
    a = math.radians(angle_deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def euler_to_rotation_matrix(rx, ry, rz):
    return rotation_matrix_z(rz) @ rotation_matrix_y(ry) @ rotation_matrix_x(rx)

def project_point(point, cam_pos, cam_rot_matrix, fov, width, height):
    """Project 3D point to screen using camera position and rotation."""
    rel_pos = np.array(point) - np.array(cam_pos)
    cam_space = cam_rot_matrix.T @ rel_pos
    
    x, y, z = cam_space
    
    if z >= -0.01:
        return None
    
    depth = -z
    
    aspect = width / height
    fov_rad = math.radians(fov)
    tan_fov = math.tan(fov_rad / 2)
    
    ndc_x = x / (depth * tan_fov * aspect)
    ndc_y = y / (depth * tan_fov)
    
    screen_x = (ndc_x + 1) * width / 2
    screen_y = (1 - ndc_y) * height / 2
    
    return (screen_x, screen_y, depth)


# =============================================================================
# GLTF PARSER FOR CAMERA DATA
# =============================================================================

class GLTFCameraParser:
    """Parse GLTF/GLB files to extract camera animation data."""
    
    def __init__(self, file_path):
        self.file_path = file_path
        self.gltf = None
        self.buffers = []
        
    def parse(self):
        ext = self.file_path.lower()
        if ext.endswith('.glb'):
            self._load_glb()
        else:
            self._load_gltf()
        
        if not self.gltf:
            return []
        
        return self._extract_camera_frames()
    
    def _load_glb(self):
        try:
            with open(self.file_path, 'rb') as f:
                if f.read(4) != b'glTF':
                    return
                f.read(8)
                while True:
                    header = f.read(8)
                    if len(header) < 8:
                        break
                    length = struct.unpack('<I', header[:4])[0]
                    ctype = header[4:]
                    data = f.read(length)
                    if ctype == b'JSON':
                        self.gltf = json.loads(data.decode('utf-8'))
                    elif ctype == b'BIN\x00':
                        self.buffers.append(data)
        except Exception as e:
            print(f"[3D Viewport V2] GLB Error: {e}")
    
    def _load_gltf(self):
        try:
            with open(self.file_path, 'r') as f:
                self.gltf = json.load(f)
            base_dir = os.path.dirname(self.file_path)
            for buf in self.gltf.get('buffers', []):
                uri = buf.get('uri', '')
                if uri.startswith('data:'):
                    self.buffers.append(base64.b64decode(uri.split(',')[1]))
                elif uri:
                    path = os.path.join(base_dir, uri)
                    if os.path.exists(path):
                        with open(path, 'rb') as f:
                            self.buffers.append(f.read())
        except Exception as e:
            print(f"[3D Viewport V2] GLTF Error: {e}")
    
    def _get_accessor(self, idx):
        if idx is None or not self.gltf:
            return []
        accessors = self.gltf.get('accessors', [])
        if idx >= len(accessors):
            return []
        acc = accessors[idx]
        bv_idx = acc.get('bufferView')
        if bv_idx is None:
            return []
        bv = self.gltf['bufferViews'][bv_idx]
        buf_idx = bv.get('buffer', 0)
        if buf_idx >= len(self.buffers):
            return []
        buf = self.buffers[buf_idx]
        offset = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        count = acc['count']
        
        ctypes = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5122: ('h', 2), 5121: ('B', 1), 5120: ('b', 1)}
        fmt, sz = ctypes.get(acc['componentType'], ('f', 4))
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}.get(acc['type'], 1)
        
        data = []
        for i in range(count):
            o = offset + i * nc * sz
            if o + nc * sz > len(buf):
                break
            vals = struct.unpack_from(f'<{nc}{fmt}', buf, o)
            data.append(vals[0] if nc == 1 else list(vals))
        return data
    
    def _quat_to_euler(self, q):
        x, y, z, w = q
        roll = math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y))
        sinp = 2*(w*y - z*x)
        pitch = math.copysign(math.pi/2, sinp) if abs(sinp) >= 1 else math.asin(sinp)
        yaw = math.atan2(2*(w*z + x*y), 1 - 2*(y*y + z*z))
        return [math.degrees(roll), math.degrees(pitch), math.degrees(yaw)]
    
    def _extract_camera_frames(self):
        nodes = self.gltf.get('nodes', [])
        cameras = self.gltf.get('cameras', [])
        anims = self.gltf.get('animations', [])
        
        cam_node_idx = None
        cam_node = None
        for i, n in enumerate(nodes):
            if 'camera' in n:
                cam_node_idx, cam_node = i, n
                break
        
        if not cam_node:
            return []
        
        cam = cameras[cam_node.get('camera', 0)] if cameras else {}
        fov = math.degrees(cam.get('perspective', {}).get('yfov', math.radians(50)))
        static_pos = cam_node.get('translation', [0, 0, 5])
        static_rot = cam_node.get('rotation', [0, 0, 0, 1])
        
        frames = []
        
        for anim in anims:
            channels = anim.get('channels', [])
            samplers = anim.get('samplers', [])
            trans_samp = rot_samp = None
            
            for ch in channels:
                tgt = ch.get('target', {})
                if tgt.get('node') == cam_node_idx:
                    s = samplers[ch.get('sampler', 0)] if ch.get('sampler', 0) < len(samplers) else None
                    if s:
                        if tgt.get('path') == 'translation':
                            trans_samp = s
                        elif tgt.get('path') == 'rotation':
                            rot_samp = s
            
            if trans_samp or rot_samp:
                times = self._get_accessor((trans_samp or rot_samp).get('input'))
                positions = self._get_accessor(trans_samp.get('output')) if trans_samp else None
                rotations = self._get_accessor(rot_samp.get('output')) if rot_samp else None
                
                print(f"[3D Viewport V2] Found animation with {len(times)} keyframes")
                
                for i, t in enumerate(times):
                    pos = positions[i] if positions and i < len(positions) else static_pos
                    rot = rotations[i] if rotations and i < len(rotations) else static_rot
                    frames.append({
                        "frame": i,
                        "time": t,
                        "position": list(pos),
                        "rotation": self._quat_to_euler(rot),
                        "fov": fov
                    })
                
                break
        
        if not frames:
            frames.append({
                "frame": 0,
                "time": 0,
                "position": list(static_pos), 
                "rotation": self._quat_to_euler(static_rot), 
                "fov": fov
            })
        
        return frames


# =============================================================================
# CAMERA KEYFRAME SYSTEM
# =============================================================================

class CameraKeyframeSystem:
    """
    Manages camera keyframes and interpolation between them.
    Supports A/B point animation with easing.
    """
    
    def __init__(self):
        self.keyframes = {}  # frame_number -> keyframe_data
        
    def add_keyframe(self, frame, position, rotation, fov):
        """Add a camera keyframe at the specified frame."""
        self.keyframes[frame] = {
            "position": list(position),
            "rotation": list(rotation),
            "fov": float(fov)
        }
        return True
    
    def remove_keyframe(self, frame):
        """Remove keyframe at specified frame."""
        if frame in self.keyframes:
            del self.keyframes[frame]
            return True
        return False
    
    def get_keyframe(self, frame):
        """Get keyframe at specific frame, or None if not exists."""
        return self.keyframes.get(frame)
    
    def get_sorted_keyframes(self):
        """Get list of keyframes sorted by frame number."""
        return sorted(self.keyframes.keys())
    
    def get_camera_at_frame(self, frame, default_pos, default_rot, default_fov, easing=True):
        """
        Get interpolated camera data at specified frame.
        Interpolates between surrounding keyframes.
        """
        if not self.keyframes:
            return {
                "position": list(default_pos),
                "rotation": list(default_rot),
                "fov": float(default_fov)
            }
        
        sorted_frames = self.get_sorted_keyframes()
        
        # Exact keyframe match
        if frame in self.keyframes:
            return self.keyframes[frame].copy()
        
        # Find surrounding keyframes
        prev_frame = None
        next_frame = None
        
        for kf in sorted_frames:
            if kf < frame:
                prev_frame = kf
            elif kf > frame and next_frame is None:
                next_frame = kf
                break
        
        # Before first keyframe
        if prev_frame is None and next_frame is not None:
            return self.keyframes[next_frame].copy()
        
        # After last keyframe
        if next_frame is None and prev_frame is not None:
            return self.keyframes[prev_frame].copy()
        
        # Between two keyframes - interpolate
        if prev_frame is not None and next_frame is not None:
            t = (frame - prev_frame) / (next_frame - prev_frame)
            if easing:
                t = ease_in_out(t)
            
            prev_kf = self.keyframes[prev_frame]
            next_kf = self.keyframes[next_frame]
            
            return {
                "position": lerp_vec3(prev_kf["position"], next_kf["position"], t),
                "rotation": lerp_vec3(prev_kf["rotation"], next_kf["rotation"], t),
                "fov": lerp(prev_kf["fov"], next_kf["fov"], t)
            }
        
        # Fallback
        return {
            "position": list(default_pos),
            "rotation": list(default_rot),
            "fov": float(default_fov)
        }
    
    def get_next_keyframe(self, current_frame):
        """Get the frame number of the next keyframe after current_frame."""
        sorted_frames = self.get_sorted_keyframes()
        for kf in sorted_frames:
            if kf > current_frame:
                return kf
        return sorted_frames[0] if sorted_frames else None
    
    def get_prev_keyframe(self, current_frame):
        """Get the frame number of the previous keyframe before current_frame."""
        sorted_frames = self.get_sorted_keyframes()
        prev = None
        for kf in sorted_frames:
            if kf >= current_frame:
                break
            prev = kf
        if prev is None and sorted_frames:
            return sorted_frames[-1]
        return prev
    
    def to_dict(self):
        """Serialize keyframes to dictionary."""
        return {"keyframes": self.keyframes.copy()}
    
    def from_dict(self, data):
        """Load keyframes from dictionary."""
        if data and "keyframes" in data:
            # Convert string keys back to integers
            self.keyframes = {int(k): v for k, v in data["keyframes"].items()}
    
    def generate_all_frames(self, total_frames, default_pos, default_rot, default_fov, easing=True):
        """Generate camera data for all frames."""
        frames = []
        for i in range(total_frames):
            cam_data = self.get_camera_at_frame(i, default_pos, default_rot, default_fov, easing)
            frames.append(cam_data)
        return frames


# =============================================================================
# 3D MODEL NODE (V2 Compatible)
# =============================================================================

class ComfyVFX_3DModelV2:
    """Load a 3D model for the viewport V2."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_file": (get_3d_files(), {"default": "none"}),
                "position_x": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "position_y": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "position_z": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "rotation_x": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "rotation_y": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "rotation_z": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.001, "max": 100.0, "step": 0.1}),
            }
        }
    
    RETURN_TYPES = ("3D_MODEL",)
    RETURN_NAMES = ("model",)
    FUNCTION = "create"
    CATEGORY = "ComfyVFX/3d_v2"
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")
    
    def create(self, model_file, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z, scale):
        return ({
            "file": model_file,
            "position": [position_x, position_y, position_z],
            "rotation": [rotation_x, rotation_y, rotation_z],
            "scale": scale
        },)


# =============================================================================
# 3D SPRITE NODE (V2 Compatible)
# =============================================================================

class ComfyVFX_3DSpriteV2:
    """Place an image in 3D space for viewport V2."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "position_x": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "position_y": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "position_z": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 100.0, "step": 0.01}),
                "opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "billboard": ("BOOLEAN", {"default": True}),
            },
            "optional": {
                "param_keyframes": ("STRING", {
                    "default": "[]",
                    "tooltip": "JSON array of sprite keyframes (managed by JS frontend)"}),
            }
        }
    
    RETURN_TYPES = ("3D_SPRITE",)
    RETURN_NAMES = ("sprite",)
    FUNCTION = "create"
    CATEGORY = "ComfyVFX/3d_v2"
    
    def create(self, image, position_x, position_y, position_z, scale, opacity, billboard, param_keyframes="[]"):
        return ({
            "image": image,
            "position_x": position_x,
            "position_y": position_y,
            "position_z": position_z,
            "scale": scale,
            "opacity": opacity,
            "billboard": billboard,
            "param_keyframes": param_keyframes
        },)


# =============================================================================
# 3D VIEWPORT V2 - MAIN NODE
# =============================================================================

class ComfyVFX_3DViewportV2:
    """
    3D Viewport Version 2 (Beta)
    
    Enhanced features:
    - 16:9 aspect ratio display (1280x720 default, configurable)
    - Scrubbing timeline with visual playhead
    - Transform tools: Grab (Move), Rotate, Scale
    - Full playback: |< << < > >> >| and keyframe navigation *< >*
    - Camera keyframe system with interpolation
    - Camera file loader for GLTF/GLB camera animation
    - All original viewport functionality preserved
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Resolution with 16:9 default
                "width": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 720, "min": 64, "max": 4096, "step": 64}),
                "fps": ("INT", {"default": 24, "min": 1, "max": 120, "step": 1}),
                "num_frames": ("INT", {"default": 120, "min": 1, "max": 9999, "step": 1}),
                
                # Camera file loader (optional external camera animation)
                "camera_file": (get_camera_files(), {"default": "none"}),
                
                # Display options
                "show_grid": ("BOOLEAN", {"default": True}),
                "grid_size": ("INT", {"default": 20, "min": 2, "max": 100, "step": 2}),
                "use_easing": ("BOOLEAN", {"default": True}),
                
                # Input counts
                "sprite_count": ("INT", {"default": 1, "min": 1, "max": 16, "step": 1}),
                "model_count": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
            },
            "optional": {
                "background_color": ("COLOR",),
                "sprite_1": ("3D_SPRITE",),
                "model_1": ("3D_MODEL",),
            },
            "hidden": {
                "keyframe_data": ("STRING", {"default": ""}),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "CAMERA_DATA")
    RETURN_NAMES = ("frames", "camera_data")
    FUNCTION = "process"
    CATEGORY = "ComfyVFX/3d_v2"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")
    
    def process(self, width, height, fps, num_frames, camera_file,
               show_grid, grid_size, use_easing,
               sprite_count, model_count, background_color=None, keyframe_data="", **kwargs):
        
        bg_rgb = hex_to_rgb(background_color) if background_color else (32, 32, 32)
        
        # Initialize keyframe system
        keyframe_system = CameraKeyframeSystem()
        
        # Load keyframes from input data if provided
        if keyframe_data and keyframe_data.strip():
            try:
                kf_dict = json.loads(keyframe_data)
                keyframe_system.from_dict(kf_dict)
                print(f"[3D Viewport V2] Loaded {len(keyframe_system.keyframes)} keyframes from input")
            except json.JSONDecodeError:
                print("[3D Viewport V2] Warning: Could not parse keyframe data")
        
        # Load camera animation from file if specified
        file_camera_frames = []
        if camera_file and camera_file != "none" and folder_paths:
            file_path = os.path.join(folder_paths.get_input_directory(), camera_file)
            if os.path.exists(file_path):
                parser = GLTFCameraParser(file_path)
                file_camera_frames = parser.parse()
                print(f"[3D Viewport V2] Loaded {len(file_camera_frames)} camera frames from {camera_file}")
        
        # Default camera position/rotation (hardcoded defaults - camera is controlled visually in viewport)
        default_pos = [0.0, 1.5, 5.0]
        default_rot = [0.0, 0.0, 0.0]
        default_fov = 50.0
        
        # Build camera data for all frames
        output_camera_data = {
            "frames": [], 
            "type": "3d_camera_v2", 
            "fps": fps,
            "width": width,
            "height": height,
            "keyframes": keyframe_system.to_dict()
        }
        
        for frame_idx in range(num_frames):
            # Priority: 1. Manual keyframes, 2. File camera, 3. Default
            
            if keyframe_system.keyframes:
                # Use keyframe system with interpolation
                cam_data = keyframe_system.get_camera_at_frame(
                    frame_idx, default_pos, default_rot, default_fov, use_easing
                )
                pos = cam_data["position"]
                rot = cam_data["rotation"]
                fov = cam_data["fov"]
            elif file_camera_frames:
                # Use loaded camera file
                kf_idx = min(frame_idx, len(file_camera_frames) - 1)
                kf = file_camera_frames[kf_idx]
                pos = kf["position"]
                rot = kf["rotation"]
                fov = kf["fov"]
            else:
                # Use default values
                pos = default_pos
                rot = default_rot
                fov = default_fov
            
            output_camera_data["frames"].append({
                "position": list(pos),
                "rotation": list(rot),
                "fov": float(fov)
            })
        
        # Collect sprites
        sprites = []
        for i in range(1, sprite_count + 1):
            s = kwargs.get(f"sprite_{i}")
            if s:
                sprites.append(s)
        
        # Collect models
        models = []
        for i in range(1, model_count + 1):
            m = kwargs.get(f"model_{i}")
            if m and m.get("file") != "none":
                models.append(m)
        
        # Check for rendered frames
        rendered_frames = []
        if folder_paths:
            temp_dir = folder_paths.get_temp_directory()
            node_id = id(self)
            
            for frame_idx in range(num_frames):
                frame_path = os.path.join(temp_dir, f"viewport3d_v2_{node_id}_{frame_idx:04d}.png")
                if os.path.exists(frame_path):
                    img = Image.open(frame_path).convert('RGB')
                    img_np = np.array(img).astype(np.float32) / 255.0
                    rendered_frames.append(torch.from_numpy(img_np)[None,])
        
        if len(rendered_frames) == num_frames:
            print(f"[3D Viewport V2] Loaded {num_frames} rendered frames")
            batch_tensor = torch.cat(rendered_frames, dim=0)
        else:
            print(f"[3D Viewport V2] No rendered frames. Click 'Render Frames' in viewport.")
            placeholder = np.zeros((height, width, 3), dtype=np.float32)
            placeholder[:, :] = [bg_rgb[0]/255, bg_rgb[1]/255, bg_rgb[2]/255]
            batch_tensor = torch.from_numpy(placeholder)[None,].repeat(num_frames, 1, 1, 1)
        
        # Prepare sprite data for JS
        js_sprites = []
        for s in sprites:
            img = s.get("image")
            if img is not None:
                frames_b64 = []
                if img.dim() == 4:
                    for fi in range(min(img.shape[0], num_frames)):
                        frames_b64.append(image_to_base64_rgba(img[fi]))
                else:
                    frames_b64.append(image_to_base64_rgba(img))
                
                js_sprites.append({
                    "frames": frames_b64,
                    "position": [s.get("position_x", 0), s.get("position_y", 0), s.get("position_z", 0)],
                    "scale": s.get("scale", 1.0),
                    "opacity": s.get("opacity", 1.0),
                    "billboard": s.get("billboard", True),
                })
        
        # Keyframe list for timeline display
        keyframe_list = keyframe_system.get_sorted_keyframes()
        
        # Serialize keyframe data for output
        keyframe_output = json.dumps(keyframe_system.to_dict())
        
        # UI data for JS
        ui_data = {
            "viewport_config_v2": [{
                "node_id": id(self),
                "version": 2,
                "width": width,
                "height": height,
                "fps": fps,
                "num_frames": num_frames,
                "background_color": f"#{bg_rgb[0]:02x}{bg_rgb[1]:02x}{bg_rgb[2]:02x}",
                "camera_file": camera_file if camera_file != "none" else None,
                "camera_frames": output_camera_data["frames"],
                "show_grid": show_grid,
                "grid_size": grid_size,
                "use_easing": use_easing,
                "sprites": js_sprites,
                "models": models,
                "keyframes": keyframe_list,
                "keyframe_data": keyframe_system.to_dict(),
                "default_camera": {
                    "position": default_pos,
                    "rotation": default_rot,
                    "fov": default_fov
                }
            }]
        }
        
        return {"ui": ui_data, "result": (batch_tensor, output_camera_data)}


# =============================================================================
# CAMERA DATA COMBINER
# =============================================================================

class ComfyVFX_CameraDataCombiner:
    """
    Combine camera data from viewport with additional transformations.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "camera_data": ("CAMERA_DATA",),
                "offset_x": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "offset_y": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "offset_z": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
            }
        }
    
    RETURN_TYPES = ("CAMERA_DATA",)
    RETURN_NAMES = ("camera_data",)
    FUNCTION = "combine"
    CATEGORY = "ComfyVFX/3d_v2"
    
    def combine(self, camera_data, offset_x, offset_y, offset_z):
        new_data = {
            "frames": [],
            "type": camera_data.get("type", "3d_camera"),
            "fps": camera_data.get("fps", 24)
        }
        
        for frame in camera_data.get("frames", []):
            new_frame = frame.copy()
            pos = frame.get("position", [0, 0, 0])
            new_frame["position"] = [pos[0] + offset_x, pos[1] + offset_y, pos[2] + offset_z]
            new_data["frames"].append(new_frame)
        
        return (new_data,)


# =============================================================================
# NODE MAPPINGS
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_3DViewportV2": ComfyVFX_3DViewportV2,
    "ComfyVFX_3DModelV2": ComfyVFX_3DModelV2,
    "ComfyVFX_3DSpriteV2": ComfyVFX_3DSpriteV2,
    "ComfyVFX_CameraDataCombiner": ComfyVFX_CameraDataCombiner,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_3DViewportV2": "ComfyVFX 3D Viewport V2 (Beta)",
    "ComfyVFX_3DModelV2": "ComfyVFX 3D Model V2",
    "ComfyVFX_3DSpriteV2": "ComfyVFX 3D Sprite V2",
    "ComfyVFX_CameraDataCombiner": "ComfyVFX Camera Data Combiner",
}
