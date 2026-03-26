"""
ComfyVFX - 3D Viewport System

Features:
- Interactive Three.js preview in node
- Built-in GLTF camera import
- 3D Model loading
- 3D Sprite placement
- Software renderer for frame output
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
    if not hex_color:
        return (0, 0, 0)
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 6:
        return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    return (0, 0, 0)


def get_3d_files():
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


# =============================================================================
# 3D MATH
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
    # Transform point to camera space
    rel_pos = np.array(point) - np.array(cam_pos)
    cam_space = cam_rot_matrix.T @ rel_pos
    
    # In camera space: X=right, Y=up, Z=backward (camera looks down -Z)
    x, y, z = cam_space
    
    # Object must be in front of camera (negative Z in camera space = in front)
    # But GLTF cameras look down -Z, so positive Z in world = in front when camera at origin looking down -Z
    # After rotation, we need Z < 0 for objects in front
    
    # For standard OpenGL/Blender convention:
    # Camera at [0,0,5] looking at origin means objects at Z < 5 are in front
    # After transform, objects in front have negative Z
    
    if z >= -0.01:  # Behind camera
        return None
    
    depth = -z  # Distance to camera
    
    aspect = width / height
    fov_rad = math.radians(fov)
    tan_fov = math.tan(fov_rad / 2)
    
    # Perspective projection
    ndc_x = x / (depth * tan_fov * aspect)
    ndc_y = y / (depth * tan_fov)
    
    # NDC [-1,1] to screen [0, width/height]
    screen_x = (ndc_x + 1) * width / 2
    screen_y = (1 - ndc_y) * height / 2  # Flip Y for screen coords
    
    return (screen_x, screen_y, depth)


# =============================================================================
# GLTF PARSER
# =============================================================================

class GLTFParser:
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
            print(f"GLB Error: {e}")
    
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
            print(f"GLTF Error: {e}")
    
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
                
                print(f"[GLTF Parser] Found animation with {len(times)} keyframes")
                print(f"[GLTF Parser] Has positions: {positions is not None}, Has rotations: {rotations is not None}")
                
                for i, t in enumerate(times):
                    pos = positions[i] if positions and i < len(positions) else static_pos
                    rot = rotations[i] if rotations and i < len(rotations) else static_rot
                    frames.append({
                        "position": list(pos),
                        "rotation": self._quat_to_euler(rot),
                        "fov": fov
                    })
                
                if frames:
                    print(f"[GLTF Parser] Frame 0 pos: {frames[0]['position']}")
                    print(f"[GLTF Parser] Frame {len(frames)-1} pos: {frames[-1]['position']}")
                break
        
        if not frames:
            frames.append({"position": list(static_pos), "rotation": self._quat_to_euler(static_rot), "fov": fov})
        
        return frames


# =============================================================================
# 3D MODEL NODE
# =============================================================================

class ComfyVFX_3DModel:
    """Load a 3D model for the viewport."""
    
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
    CATEGORY = "ComfyVFX/3d"
    
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
# 3D SPRITE NODE
# =============================================================================

class ComfyVFX_3DSprite:
    """Place an image in 3D space."""
    
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
    CATEGORY = "ComfyVFX/3d"
    
    def create(self, image, position_x, position_y, position_z, scale, opacity, param_keyframes="[]"):
        return ({
            "image": image,
            "position_x": position_x,
            "position_y": position_y,
            "position_z": position_z,
            "scale": scale,
            "opacity": opacity,
            "param_keyframes": param_keyframes
        },)


# =============================================================================
# 3D VIEWPORT NODE
# =============================================================================

class ComfyVFX_3DViewport:
    """
    Interactive 3D Viewport with built-in camera import and rendering.
    
    - Select GLTF file to load camera animation
    - Add sprites and models
    - Outputs rendered frames
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "num_frames": ("INT", {"default": 30, "min": 1, "max": 9999, "step": 1}),
                "camera_file": (get_3d_files(), {"default": "none"}),
                "camera_x": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "camera_y": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "camera_z": ("FLOAT", {"default": 5.0, "min": -100.0, "max": 100.0, "step": 0.1}),
                "camera_fov": ("FLOAT", {"default": 50.0, "min": 10.0, "max": 120.0, "step": 1.0}),
                "show_grid": ("BOOLEAN", {"default": True}),
                "sprite_count": ("INT", {"default": 1, "min": 1, "max": 16, "step": 1}),
                "model_count": ("INT", {"default": 1, "min": 0, "max": 8, "step": 1}),
            },
            "optional": {
                "background_color": ("COLOR",),
                "sprite_1": ("3D_SPRITE",),
                "model_1": ("3D_MODEL",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "CAMERA_DATA")
    RETURN_NAMES = ("frames", "camera_data")
    FUNCTION = "process"
    CATEGORY = "ComfyVFX/3d"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")
    
    def process(self, width, height, num_frames, camera_file, camera_x, camera_y, camera_z, camera_fov,
               show_grid, sprite_count, model_count, background_color=None, **kwargs):
        
        bg_rgb = hex_to_rgb(background_color) if background_color else (32, 32, 32)
        
        # Load camera animation from GLTF
        camera_frames = []
        if camera_file and camera_file != "none" and folder_paths:
            file_path = os.path.join(folder_paths.get_input_directory(), camera_file)
            if os.path.exists(file_path):
                parser = GLTFParser(file_path)
                camera_frames = parser.parse()
                print(f"[3D Viewport] Loaded {len(camera_frames)} camera keyframes from {camera_file}")
        
        # Build camera data for ALL frames
        output_camera_data = {"frames": [], "type": "3d_camera", "fps": 24}
        
        for frame_idx in range(num_frames):
            if camera_frames:
                kf_idx = min(frame_idx, len(camera_frames) - 1)
                kf = camera_frames[kf_idx]
                pos = kf["position"]
                rot = kf["rotation"]
                fov = kf["fov"]
            else:
                pos = [camera_x, camera_y, camera_z]
                rot = [0, 0, 0]
                fov = camera_fov
            
            output_camera_data["frames"].append({
                "position": list(pos),
                "rotation": list(rot),
                "fov": float(fov)
            })
        
        # Collect sprites for JS
        sprites = []
        for i in range(1, sprite_count + 1):
            s = kwargs.get(f"sprite_{i}")
            if s:
                sprites.append(s)
        
        # Collect models for JS
        models = []
        for i in range(1, model_count + 1):
            m = kwargs.get(f"model_{i}")
            if m and m.get("file") != "none":
                models.append(m)
        
        # Check for JS-rendered frames in temp folder
        rendered_frames = []
        if folder_paths:
            temp_dir = folder_paths.get_temp_directory()
            node_id = id(self)
            
            # Look for rendered frames from JS
            for frame_idx in range(num_frames):
                frame_path = os.path.join(temp_dir, f"viewport3d_{node_id}_{frame_idx:04d}.png")
                if os.path.exists(frame_path):
                    img = Image.open(frame_path).convert('RGB')
                    img_np = np.array(img).astype(np.float32) / 255.0
                    rendered_frames.append(torch.from_numpy(img_np)[None,])
        
        # If we have rendered frames, use them
        if len(rendered_frames) == num_frames:
            print(f"[3D Viewport] Loaded {num_frames} rendered frames from temp folder")
            batch_tensor = torch.cat(rendered_frames, dim=0)
        else:
            # Create placeholder frames - user needs to click "Render Frames" in JS
            print(f"[3D Viewport] No rendered frames found. Click 'Render Frames' button in the viewport.")
            placeholder = np.zeros((height, width, 3), dtype=np.float32)
            placeholder[:, :] = [bg_rgb[0]/255, bg_rgb[1]/255, bg_rgb[2]/255]
            
            # Add text indicator
            batch_tensor = torch.from_numpy(placeholder)[None,].repeat(num_frames, 1, 1, 1)
        
        # Prepare sprite data for JS preview
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
                })
        
        # UI data for JS - include node_id for frame saving
        ui_data = {
            "viewport_config": [{
                "node_id": id(self),
                "width": width,
                "height": height,
                "num_frames": num_frames,
                "background_color": f"#{bg_rgb[0]:02x}{bg_rgb[1]:02x}{bg_rgb[2]:02x}",
                "camera_file": camera_file if camera_file != "none" else None,
                "camera_frames": output_camera_data["frames"],
                "show_grid": show_grid,
                "sprites": js_sprites,
                "models": models,
            }]
        }
        
        return {"ui": ui_data, "result": (batch_tensor, output_camera_data)}


# =============================================================================
# NODE MAPPINGS
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_3DViewport": ComfyVFX_3DViewport,
    "ComfyVFX_3DModel": ComfyVFX_3DModel,
    "ComfyVFX_3DSprite": ComfyVFX_3DSprite,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_3DViewport": "ComfyVFX 3D Viewport",
    "ComfyVFX_3DModel": "ComfyVFX 3D Model",
    "ComfyVFX_3DSprite": "ComfyVFX 3D Sprite",
}
