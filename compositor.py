"""
ComfyVFX - Modular Layer Compositor System

Nodes:
- LayerCompositor: Main node with input dots only (background_color, camera, layers)
- CompositorCamera: Camera settings with keyframe animation
- CompositorLayer: Layer settings with image and keyframe animation
"""

import json
import math
import random
import os
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter

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


def apply_camera_transform(image, pan_x, pan_y, zoom, rotation, shake_x, shake_y):
    """Apply camera transforms to an image tensor."""
    if image.dim() == 3:
        h, w, c = image.shape
    else:
        return image
    
    np_img = (image.cpu().numpy() * 255).astype(np.uint8)
    pil_img = Image.fromarray(np_img)
    
    pan_x += shake_x
    pan_y += shake_y
    
    center_x, center_y = w / 2, h / 2
    
    if zoom != 1.0 and zoom > 0:
        new_w = int(w / zoom)
        new_h = int(h / zoom)
        if new_w > 0 and new_h > 0:
            left = int(center_x - new_w / 2 + pan_x * w)
            top = int(center_y - new_h / 2 + pan_y * h)
            left = max(0, min(left, w - new_w))
            top = max(0, min(top, h - new_h))
            pil_img = pil_img.crop((left, top, left + new_w, top + new_h))
            pil_img = pil_img.resize((w, h), Image.Resampling.LANCZOS)
    else:
        offset_x = int(pan_x * w)
        offset_y = int(pan_y * h)
        if offset_x != 0 or offset_y != 0:
            new_img = Image.new('RGB', (w, h), (0, 0, 0))
            new_img.paste(pil_img, (-offset_x, -offset_y))
            pil_img = new_img
    
    if rotation != 0:
        pil_img = pil_img.rotate(-rotation, resample=Image.Resampling.BILINEAR, 
                                  expand=False, center=(w//2, h//2))
    
    result = torch.from_numpy(np.array(pil_img).astype(np.float32) / 255.0)
    return result


def generate_shake(frame_idx, intensity, frequency, seed):
    """Generate camera shake values for a frame."""
    if intensity <= 0:
        return 0.0, 0.0
    
    random.seed(seed + frame_idx * 1000)
    t = frame_idx * frequency * 0.1
    
    base_x = math.sin(t * 2.3) * 0.5 + math.sin(t * 5.7) * 0.3 + random.uniform(-0.2, 0.2)
    base_y = math.sin(t * 1.9) * 0.5 + math.sin(t * 4.3) * 0.3 + random.uniform(-0.2, 0.2)
    
    return base_x * intensity, base_y * intensity


def _apply_easing(t, mode="linear"):
    if mode == "ease_in":
        return t * t
    elif mode == "ease_out":
        return 1.0 - (1.0 - t) ** 2
    elif mode == "ease_in_out":
        return 2.0 * t * t if t < 0.5 else 1.0 - (-2.0 * t + 2.0) ** 2 / 2.0
    return t


def interpolate_param_keyframes(keyframes, total_frames, param_names, defaults):
    """Interpolate parameter values across frames from keyframes.
    
    Supports two formats:
      NEW: {paramName: [{frame, value, easing}, ...]}  (per-param keyframes)
      OLD: [{frame, easing, param1, param2, ...}]       (global keyframes)
    """
    if not keyframes or total_frames <= 0:
        return None

    if isinstance(keyframes, dict):
        # NEW per-param format
        result = [dict(defaults) for _ in range(total_frames)]
        for param_name, kfs in keyframes.items():
            if not kfs or param_name not in defaults:
                continue
            sorted_kfs = sorted(kfs, key=lambda k: k.get("frame", 0))
            if sorted_kfs[0].get("frame", 0) > 0:
                sorted_kfs.insert(0, {"frame": 0, "value": sorted_kfs[0]["value"], "easing": "linear"})
            last_frame = total_frames - 1
            if sorted_kfs[-1].get("frame", 0) < last_frame:
                sorted_kfs.append({"frame": last_frame, "value": sorted_kfs[-1]["value"], "easing": "linear"})
            for f in range(total_frames):
                kf_before, kf_after = sorted_kfs[0], sorted_kfs[-1]
                for i in range(len(sorted_kfs) - 1):
                    if sorted_kfs[i]["frame"] <= f <= sorted_kfs[i + 1]["frame"]:
                        kf_before, kf_after = sorted_kfs[i], sorted_kfs[i + 1]
                        break
                fs, fe = kf_before.get("frame", 0), kf_after.get("frame", 0)
                t = 0.0 if fe == fs else (f - fs) / (fe - fs)
                t = _apply_easing(t, kf_before.get("easing", "linear"))
                a = kf_before.get("value", defaults.get(param_name, 0.0))
                b = kf_after.get("value", defaults.get(param_name, 0.0))
                result[f][param_name] = a + (b - a) * t
        return result

    # OLD global format: [{frame, easing, param1, param2, ...}]
    kfs = sorted(keyframes, key=lambda k: k.get("frame", 0))

    if kfs[0].get("frame", 0) > 0:
        first = dict(defaults)
        first["frame"] = 0
        first["easing"] = "linear"
        for p in param_names:
            first[p] = kfs[0].get(p, defaults.get(p, 0.0))
        kfs.insert(0, first)

    last_frame = total_frames - 1
    if kfs[-1].get("frame", 0) < last_frame:
        last_kf = {"frame": last_frame, "easing": "linear"}
        for p in param_names:
            last_kf[p] = kfs[-1].get(p, defaults.get(p, 0.0))
        kfs.append(last_kf)

    result = []
    for f in range(total_frames):
        kf_before, kf_after = kfs[0], kfs[-1]
        for i in range(len(kfs) - 1):
            if kfs[i]["frame"] <= f <= kfs[i + 1]["frame"]:
                kf_before, kf_after = kfs[i], kfs[i + 1]
                break

        fs, fe = kf_before.get("frame", 0), kf_after.get("frame", 0)
        t = 0.0 if fe == fs else (f - fs) / (fe - fs)
        t = _apply_easing(t, kf_before.get("easing", "linear"))

        frame_vals = {}
        for p in param_names:
            a = kf_before.get(p, defaults.get(p, 0.0))
            b = kf_after.get(p, defaults.get(p, 0.0))
            frame_vals[p] = a + (b - a) * t
        result.append(frame_vals)

    return result


def get_kf_value(kf_values, param_name, frame_idx, default_value):
    """Get interpolated value from pre-computed keyframe values, or return default."""
    if kf_values and frame_idx < len(kf_values):
        return kf_values[frame_idx].get(param_name, default_value)
    return default_value


def convert_3d_camera_to_2d(camera_3d_data, frame_idx, width, height):
    """
    Convert 3D camera data to 2D compositor camera effects.
    Maps 3D camera position/rotation to 2D pan, zoom, rotation.
    """
    if not camera_3d_data or camera_3d_data.get("type") != "3d_camera":
        return 0, 0, 1.0, 0
    
    frames = camera_3d_data.get("frames", [])
    if not frames:
        return 0, 0, 1.0, 0
    
    # Get camera data for this frame
    idx = min(frame_idx, len(frames) - 1)
    frame = frames[idx]
    
    pos = frame.get("position", [0, 0, 5])
    rot = frame.get("rotation", [0, 0, 0])
    fov = frame.get("fov", 50)
    
    # Convert 3D to 2D:
    # - X position -> pan_x (normalized to -1 to 1 range)
    # - Y position -> pan_y
    # - Z position -> zoom (closer = more zoom)
    # - Y rotation -> 2D rotation
    
    # Normalize pan based on some reasonable range (e.g., -10 to 10 units)
    pan_x = -pos[0] / 10.0  # Negative because camera moving right means scene moves left
    pan_y = pos[1] / 10.0
    
    # Zoom based on Z distance (assuming default is 5, closer = more zoom)
    base_z = 5.0
    if pos[2] > 0:
        zoom = base_z / pos[2]
    else:
        zoom = 1.0
    
    # 2D rotation from Y rotation (yaw)
    rotation_2d = rot[1]  # Y rotation becomes 2D rotation
    
    return pan_x, pan_y, zoom, rotation_2d


# =============================================================================
# COMPOSITOR CAMERA NODE
# =============================================================================

class ComfyVFX_CompositorCamera:
    """
    Camera controls for the Layer Compositor.
    Connect to compositor's camera input.
    """
    
    CAMERA_PARAMS = ["pan_x", "pan_y", "zoom", "rotation", "shake_intensity", "shake_frequency"]
    CAMERA_DEFAULTS = {"pan_x": 0.0, "pan_y": 0.0, "zoom": 1.0, "rotation": 0.0, "shake_intensity": 0.0, "shake_frequency": 1.0}
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "pan_x": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "pan_y": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01}),
                "zoom": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.01}),
                "rotation": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.5}),
                "shake_intensity": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.2, "step": 0.001}),
                "shake_frequency": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 10.0, "step": 0.1}),
                "shake_seed": ("INT", {"default": 0, "min": 0, "max": 999999}),
            },
            "optional": {
                "param_keyframes": ("STRING", {
                    "default": "[]",
                    "tooltip": "JSON array of camera keyframes (managed by JS frontend)"}),
            }
        }
    
    RETURN_TYPES = ("COMPOSITOR_CAMERA",)
    RETURN_NAMES = ("camera",)
    FUNCTION = "create_camera"
    CATEGORY = "ComfyVFX/compositing"
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        import hashlib, json as _json
        parts = []
        raw = kwargs.get("param_keyframes", "{}")
        try:
            parsed = _json.loads(raw) if raw else {}
            parts.append(f"kf={_json.dumps(parsed, sort_keys=True, separators=(',',':'))}")
        except:
            parts.append(f"kf={raw}")
        for k in cls.CAMERA_PARAMS + ["shake_seed"]:
            if k in kwargs:
                parts.append(f"{k}={kwargs[k]}")
        return hashlib.md5("|".join(parts).encode()).hexdigest()
    
    def create_camera(self, pan_x, pan_y, zoom, rotation, shake_intensity, shake_frequency, shake_seed, **kwargs):
        param_keyframes = kwargs.get("param_keyframes", "{}")
        print(f"[Compositor Camera] param_keyframes: {param_keyframes[:100]}")
        camera_data = {
            "type": "2d_camera",
            "pan_x": pan_x,
            "pan_y": pan_y,
            "zoom": zoom,
            "rotation": rotation,
            "shake_intensity": shake_intensity,
            "shake_frequency": shake_frequency,
            "shake_seed": shake_seed,
            "param_keyframes": param_keyframes,
        }
        return (camera_data,)


# =============================================================================
# COMPOSITOR LAYER NODE
# =============================================================================

class ComfyVFX_CompositorLayer:
    """
    Layer settings for the Layer Compositor.
    Connect to compositor's layer inputs.
    """
    
    LAYER_PARAMS = ["opacity", "offset_x", "offset_y", "scale"]
    LAYER_DEFAULTS = {"opacity": 1.0, "offset_x": 0.0, "offset_y": 0.0, "scale": 1.0}
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "blend_mode": (["normal", "add", "screen", "multiply", "overlay"], {"default": "normal"}),
                "opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "start_frame": ("INT", {"default": 0, "min": -1000, "max": 9999, "step": 1}),
                "offset_x": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "offset_y": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.01}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 5.0, "step": 0.05}),
            },
            "optional": {
                "param_keyframes": ("STRING", {
                    "default": "[]",
                    "tooltip": "JSON array of layer keyframes (managed by JS frontend)"}),
            }
        }
    
    RETURN_TYPES = ("COMPOSITOR_LAYER",)
    RETURN_NAMES = ("layer",)
    FUNCTION = "create_layer"
    CATEGORY = "ComfyVFX/compositing"
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        import hashlib, json as _json
        parts = []
        raw = kwargs.get("param_keyframes", "{}")
        try:
            parsed = _json.loads(raw) if raw else {}
            parts.append(f"kf={_json.dumps(parsed, sort_keys=True, separators=(',',':'))}")
        except:
            parts.append(f"kf={raw}")
        for k in cls.LAYER_PARAMS + ["blend_mode", "start_frame"]:
            if k in kwargs:
                parts.append(f"{k}={kwargs[k]}")
        return hashlib.md5("|".join(parts).encode()).hexdigest()
    
    def create_layer(self, image, blend_mode, opacity, start_frame, offset_x, offset_y, scale, **kwargs):
        param_keyframes = kwargs.get("param_keyframes", "[]")
        print(f"[Compositor Layer] param_keyframes: {param_keyframes[:100]}")
        layer_data = {
            "image": image,
            "blend_mode": blend_mode,
            "opacity": opacity,
            "start_frame": start_frame,
            "offset_x": offset_x,
            "offset_y": offset_y,
            "scale": scale,
            "param_keyframes": param_keyframes,
        }
        return (layer_data,)


# =============================================================================
# LAYER COMPOSITOR - MAIN NODE
# =============================================================================

class ComfyVFX_LayerCompositor:
    """
    Main Layer Compositor.
    
    Inputs (all as connection dots):
    - background_color: Connect from ColorPicker
    - camera: Connect from CompositorCamera (2D camera controls)
    - camera_3d: Connect from 3D Viewport's camera_data output
    - layer_1, layer_2, etc: Connect from CompositorLayer nodes
    
    Set layer_count and click "Update Layers" to add/remove layer inputs.
    
    Note: If camera_3d is connected, it converts 3D camera motion to 2D effects.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "num_frames": ("INT", {"default": 60, "min": 1, "max": 9999, "step": 1}),
                "layer_count": ("INT", {"default": 2, "min": 1, "max": 16, "step": 1}),
            },
            "optional": {
                "background_color": ("COLOR",),
                "camera": ("COMPOSITOR_CAMERA",),
                "camera_3d": ("CAMERA_DATA",),
                "layer_1": ("COMPOSITOR_LAYER",),
                "layer_2": ("COMPOSITOR_LAYER",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("composite",)
    FUNCTION = "composite"
    CATEGORY = "ComfyVFX/compositing"
    OUTPUT_NODE = True
    
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Hash all inputs including upstream image tensors so we re-execute
        # when layer content changes, but not on every single queue.
        import hashlib
        sig_parts = []
        for k in sorted(kwargs.keys()):
            v = kwargs[k]
            if hasattr(v, 'shape'):  # torch tensor — hash shape + sample
                sig_parts.append(f"{k}=tensor:{v.shape}:{v.sum().item():.6f}")
            elif isinstance(v, (list, dict)):
                sig_parts.append(f"{k}={hash(str(v))}")
            else:
                sig_parts.append(f"{k}={v}")
        return hashlib.md5("|".join(sig_parts).encode()).hexdigest()
    
    def blend_images(self, base, layer, blend_mode, opacity):
        if opacity <= 0:
            return base
        layer_blended = layer * opacity
        if blend_mode == "normal":
            return base * (1 - opacity) + layer_blended
        elif blend_mode == "add":
            return torch.clamp(base + layer_blended, 0, 1)
        elif blend_mode == "screen":
            return 1 - (1 - base) * (1 - layer_blended)
        elif blend_mode == "multiply":
            return base * (1 - opacity) + (base * layer) * opacity
        elif blend_mode == "overlay":
            mask = base < 0.5
            result = torch.where(mask, 2 * base * layer_blended, 1 - 2 * (1 - base) * (1 - layer_blended))
            return base * (1 - opacity) + result * opacity
        return base
    
    def apply_layer_transform(self, layer_frame, width, height, offset_x, offset_y, scale):
        h, w, c = layer_frame.shape
        np_img = (layer_frame.cpu().numpy() * 255).astype(np.uint8)
        pil_img = Image.fromarray(np_img)
        
        if scale != 1.0 and scale > 0:
            new_w = int(w * scale)
            new_h = int(h * scale)
            if new_w > 0 and new_h > 0:
                pil_img = pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        
        result = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        paste_x = int((width - pil_img.width) / 2 + offset_x * width)
        paste_y = int((height - pil_img.height) / 2 + offset_y * height)
        
        if pil_img.mode != 'RGBA':
            pil_img = pil_img.convert('RGBA')
        result.paste(pil_img, (paste_x, paste_y))
        result_rgb = result.convert('RGB')
        return torch.from_numpy(np.array(result_rgb).astype(np.float32) / 255.0)
    
    def composite(self, width, height, num_frames, layer_count,
                  background_color=None, camera=None, camera_3d=None,
                  unique_id=None, **kwargs):
        
        # Stable node identifier for temp file naming (survives re-execution)
        node_id = unique_id if unique_id is not None else "0"
        
        # --- Auto-detect output dimensions from first layer ---
        # If compositor width/height are at defaults (512) but a layer has
        # different dimensions, use the layer dims to avoid distortion.
        for i in range(1, layer_count + 1):
            layer_data = kwargs.get(f"layer_{i}")
            if layer_data and isinstance(layer_data, dict):
                layer_img = layer_data.get("image")
                if layer_img is not None and layer_img.dim() == 4:
                    lh, lw = layer_img.shape[1], layer_img.shape[2]
                    if (lh != height or lw != width):
                        print(f"[Compositor] Layer {i} is {lw}x{lh} but compositor canvas is {width}x{height}")
                        if width == 512 and height == 512:
                            width, height = lw, lh
                            print(f"[Compositor] Auto-adjusted canvas to {width}x{height} (from layer {i})")
                    break
        
        # Parse background color
        if background_color and isinstance(background_color, str):
            bg_rgb = hex_to_rgb(background_color)
        else:
            bg_rgb = (0, 0, 0)
        bg_color = torch.tensor([bg_rgb[0], bg_rgb[1], bg_rgb[2]], dtype=torch.float32) / 255.0
        
        # Get 2D camera settings
        cam = camera if camera else {}
        cam_pan_x = cam.get("pan_x", 0.0)
        cam_pan_y = cam.get("pan_y", 0.0)
        cam_zoom = cam.get("zoom", 1.0)
        cam_rotation = cam.get("rotation", 0.0)
        cam_shake_int = cam.get("shake_intensity", 0.0)
        cam_shake_freq = cam.get("shake_frequency", 1.0)
        cam_shake_seed = cam.get("shake_seed", 0)
        
        # Pre-interpolate camera keyframes
        cam_kf_values = None
        cam_kf_str = cam.get("param_keyframes", "{}")
        if cam_kf_str and cam_kf_str != "[]" and cam_kf_str != "{}":
            try:
                cam_kf_raw = json.loads(cam_kf_str) if isinstance(cam_kf_str, str) else cam_kf_str
                if cam_kf_raw and num_frames > 0:
                    cam_kf_values = interpolate_param_keyframes(
                        cam_kf_raw, num_frames,
                        ComfyVFX_CompositorCamera.CAMERA_PARAMS,
                        ComfyVFX_CompositorCamera.CAMERA_DEFAULTS)
                    if cam_kf_values:
                        print(f"[Compositor] Camera keyframes → {len(cam_kf_values)} interpolated frames")
            except Exception as e:
                print(f"[Compositor] Camera keyframe parse error: {e}")
        
        # Check if we have 3D camera data
        use_3d_camera = camera_3d is not None and isinstance(camera_3d, dict) and camera_3d.get("type") == "3d_camera"
        
        # Collect layers
        layers = []
        for i in range(1, layer_count + 1):
            layer_data = kwargs.get(f"layer_{i}")
            if layer_data is not None and isinstance(layer_data, dict):
                layers.append((i, layer_data))
        
        frames = []
        
        # Pre-parse layer keyframes ONCE before the frame loop
        layer_kf_map = {}  # layer_num -> interpolated values list or None
        for layer_num, layer_data in layers:
            layer_kf_str = layer_data.get("param_keyframes", "{}")
            if layer_kf_str and layer_kf_str != "[]" and layer_kf_str != "{}":
                try:
                    layer_kf_raw = json.loads(layer_kf_str) if isinstance(layer_kf_str, str) else layer_kf_str
                    if layer_kf_raw and num_frames > 0:
                        kf_vals = interpolate_param_keyframes(
                            layer_kf_raw, num_frames,
                            ComfyVFX_CompositorLayer.LAYER_PARAMS,
                            ComfyVFX_CompositorLayer.LAYER_DEFAULTS)
                        if kf_vals:
                            layer_kf_map[layer_num] = kf_vals
                            print(f"[Compositor] Layer {layer_num} keyframes → {len(kf_vals)} interpolated frames")
                except Exception as e:
                    print(f"[Compositor] Layer {layer_num} keyframe parse error: {e}")
        
        for frame_idx in range(num_frames):
            # Get camera values
            if use_3d_camera:
                # Convert 3D camera to 2D effects
                pan_x, pan_y, zoom, rotation = convert_3d_camera_to_2d(camera_3d, frame_idx, width, height)
                shake_x, shake_y = 0.0, 0.0
            else:
                # Use 2D camera with keyframe interpolation
                pan_x = get_kf_value(cam_kf_values, "pan_x", frame_idx, cam_pan_x)
                pan_y = get_kf_value(cam_kf_values, "pan_y", frame_idx, cam_pan_y)
                zoom = get_kf_value(cam_kf_values, "zoom", frame_idx, cam_zoom)
                rotation = get_kf_value(cam_kf_values, "rotation", frame_idx, cam_rotation)
                shake_int = get_kf_value(cam_kf_values, "shake_intensity", frame_idx, cam_shake_int)
                shake_freq = get_kf_value(cam_kf_values, "shake_frequency", frame_idx, cam_shake_freq)
                
                shake_x, shake_y = generate_shake(frame_idx, shake_int, shake_freq, cam_shake_seed)
            
            # Start with background
            frame = torch.ones(height, width, 3) * bg_color
            
            # Composite each layer
            for layer_num, layer_data in layers:
                layer_img = layer_data.get("image")
                if layer_img is None:
                    continue
                
                # Use pre-parsed keyframe values
                layer_kf_values = layer_kf_map.get(layer_num)
                
                opacity = get_kf_value(layer_kf_values, "opacity", frame_idx, layer_data.get("opacity", 1.0))
                offset_x = get_kf_value(layer_kf_values, "offset_x", frame_idx, layer_data.get("offset_x", 0.0))
                offset_y = get_kf_value(layer_kf_values, "offset_y", frame_idx, layer_data.get("offset_y", 0.0))
                scale = get_kf_value(layer_kf_values, "scale", frame_idx, layer_data.get("scale", 1.0))
                blend_mode = layer_data.get("blend_mode", "normal")
                start_frame = layer_data.get("start_frame", 0)
                
                if opacity <= 0:
                    continue
                
                layer_frame_idx = frame_idx - start_frame
                if layer_frame_idx < 0:
                    continue
                
                # Get correct frame from layer image
                if layer_img.dim() == 4:
                    actual_idx = min(layer_frame_idx, layer_img.shape[0] - 1)
                    layer_frame = layer_img[actual_idx]
                else:
                    layer_frame = layer_img
                
                # Apply transforms
                if offset_x != 0 or offset_y != 0 or scale != 1.0:
                    layer_frame = self.apply_layer_transform(layer_frame, width, height, offset_x, offset_y, scale)
                elif layer_frame.shape[0] != height or layer_frame.shape[1] != width:
                    # Aspect-preserving center-fit (no distortion)
                    np_layer = (layer_frame.cpu().numpy() * 255).astype(np.uint8)
                    pil_layer = Image.fromarray(np_layer)
                    lw, lh = pil_layer.size
                    scale_fit = min(width / lw, height / lh)
                    new_w = int(lw * scale_fit)
                    new_h = int(lh * scale_fit)
                    if new_w > 0 and new_h > 0:
                        pil_layer = pil_layer.resize((new_w, new_h), Image.Resampling.LANCZOS)
                    result = Image.new('RGB', (width, height), (0, 0, 0))
                    paste_x = (width - pil_layer.width) // 2
                    paste_y = (height - pil_layer.height) // 2
                    result.paste(pil_layer, (paste_x, paste_y))
                    layer_frame = torch.from_numpy(np.array(result).astype(np.float32) / 255.0)
                
                frame = self.blend_images(frame, layer_frame, blend_mode, opacity)
            
            # Apply camera transform
            if pan_x != 0 or pan_y != 0 or zoom != 1.0 or rotation != 0 or shake_x != 0 or shake_y != 0:
                frame = apply_camera_transform(frame, pan_x, pan_y, zoom, rotation, shake_x, shake_y)
            
            frames.append(frame[None,])
        
        batch_tensor = torch.cat(frames, dim=0)
        
        # Save ALL frames for preview playback
        all_preview_images = []
        # Per-layer frame images as a FLAT list (same structure as all_frames
        # — nested dicts don't survive ComfyUI's websocket reliably)
        layer_frame_list = []
        # Per-layer settings as a flat list
        layer_settings_list = []
        
        if folder_paths:
            temp_dir = folder_paths.get_temp_directory()
            
            # Save final composite frames (stable filenames → overwrite previous run)
            for idx in range(num_frames):
                frame_np = (frames[idx][0].cpu().numpy() * 255).astype(np.uint8)
                pil_frame = Image.fromarray(frame_np)
                filename = f"compositor_preview_{node_id}_{idx:04d}.png"
                filepath = os.path.join(temp_dir, filename)
                pil_frame.save(filepath)
                all_preview_images.append({"filename": filename, "subfolder": "", "type": "temp", "frame": idx})
            
            # Save per-layer frames for client-side re-compositing
            for layer_num, layer_data in layers:
                layer_img = layer_data.get("image")
                if layer_img is None:
                    continue
                n_layer_frames = layer_img.shape[0] if layer_img.dim() == 4 else 1
                for fidx in range(min(n_layer_frames, num_frames)):
                    if layer_img.dim() == 4:
                        lf = layer_img[fidx]
                    else:
                        lf = layer_img
                    lf_np = (lf.cpu().numpy() * 255).astype(np.uint8)
                    pil_lf = Image.fromarray(lf_np)
                    lf_name = f"compositor_layer{layer_num}_{node_id}_{fidx:04d}.png"
                    pil_lf.save(os.path.join(temp_dir, lf_name))
                    layer_frame_list.append({
                        "filename": lf_name, "subfolder": "", "type": "temp",
                        "layer": layer_num, "frame": fidx,
                    })
                layer_settings_list.append({
                    "layer": layer_num,
                    "total_frames": n_layer_frames,
                    "blend_mode": layer_data.get("blend_mode", "normal"),
                    "opacity": float(layer_data.get("opacity", 1.0)),
                    "start_frame": int(layer_data.get("start_frame", 0)),
                    "offset_x": float(layer_data.get("offset_x", 0.0)),
                    "offset_y": float(layer_data.get("offset_y", 0.0)),
                    "scale": float(layer_data.get("scale", 1.0)),
                })
        
        print(f"[Compositor] UI: {len(all_preview_images)} composite frames, "
              f"{len(layer_frame_list)} layer frames, "
              f"{len(layer_settings_list)} layer configs")
        
        ui_data = {
            "all_frames": all_preview_images,
            "layer_frames": layer_frame_list,
            "layer_settings": layer_settings_list,
            "compositor_info": [{
                "width": width,
                "height": height,
                "num_frames": num_frames,
                "num_layers": len(layers),
                "layer_nums": [ln for ln, _ in layers],
                "bg_r": bg_rgb[0],
                "bg_g": bg_rgb[1],
                "bg_b": bg_rgb[2],
            }]
        }
        
        return {"ui": ui_data, "result": (batch_tensor,)}


# =============================================================================
# MASK NODES
# =============================================================================

class ComfyVFX_MaskEditor:
    """Apply mask to image with background color."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "feather": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "background_color": ("COLOR",),
                "mask": ("MASK",),
            }
        }
    
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("masked_image", "mask")
    FUNCTION = "apply_mask"
    CATEGORY = "ComfyVFX/compositing"
    
    def apply_mask(self, image, feather, invert_mask, background_color=None, mask=None):
        if image.dim() == 4:
            batch_size, h, w, c = image.shape
        else:
            h, w, c = image.shape
            batch_size = 1
            image = image.unsqueeze(0)
        
        if mask is None:
            mask = torch.ones(batch_size, h, w)
        else:
            if mask.dim() == 2:
                mask = mask.unsqueeze(0)
            if mask.shape[0] < batch_size:
                mask = mask.repeat(batch_size, 1, 1)[:batch_size]
            if mask.shape[1] != h or mask.shape[2] != w:
                resized_masks = []
                for i in range(mask.shape[0]):
                    mask_np = mask[i].cpu().numpy()
                    mask_pil = Image.fromarray((mask_np * 255).astype(np.uint8))
                    mask_pil = mask_pil.resize((w, h), Image.Resampling.LANCZOS)
                    resized_masks.append(torch.from_numpy(np.array(mask_pil).astype(np.float32) / 255.0))
                mask = torch.stack(resized_masks)
        
        if invert_mask:
            mask = 1.0 - mask
        
        if feather > 0:
            feathered_masks = []
            for i in range(batch_size):
                mask_np = mask[i].cpu().numpy()
                mask_pil = Image.fromarray((mask_np * 255).astype(np.uint8))
                mask_pil = mask_pil.filter(ImageFilter.GaussianBlur(radius=feather))
                feathered = torch.from_numpy(np.array(mask_pil).astype(np.float32) / 255.0)
                feathered_masks.append(feathered)
            mask = torch.stack(feathered_masks)
        
        # Parse background color
        if background_color and isinstance(background_color, str):
            bg_rgb = hex_to_rgb(background_color)
        else:
            bg_rgb = (0, 255, 0)
        bg_color_tensor = torch.tensor([bg_rgb[0], bg_rgb[1], bg_rgb[2]], dtype=torch.float32) / 255.0
        background = torch.ones(batch_size, h, w, c) * bg_color_tensor
        
        mask_expanded = mask.unsqueeze(-1)
        masked_image = image * mask_expanded + background * (1 - mask_expanded)
        
        return (masked_image, mask)


class ComfyVFX_ImageMask:
    """Create mask from image brightness or color channels."""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "source": (["brightness", "red", "green", "blue", "alpha"], {"default": "brightness"}),
                "threshold": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "softness": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 1.0, "step": 0.01}),
                "invert": ("BOOLEAN", {"default": False}),
            }
        }
    
    RETURN_TYPES = ("MASK",)
    RETURN_NAMES = ("mask",)
    FUNCTION = "create_mask"
    CATEGORY = "ComfyVFX/compositing"
    
    def create_mask(self, image, source, threshold, softness, invert):
        if image.dim() == 4:
            batch_size = image.shape[0]
        else:
            batch_size = 1
            image = image.unsqueeze(0)
        
        masks = []
        for i in range(batch_size):
            img = image[i]
            if source == "brightness":
                channel = (img[:, :, 0] + img[:, :, 1] + img[:, :, 2]) / 3
            elif source == "red":
                channel = img[:, :, 0]
            elif source == "green":
                channel = img[:, :, 1]
            elif source == "blue":
                channel = img[:, :, 2]
            elif source == "alpha" and img.shape[2] > 3:
                channel = img[:, :, 3]
            else:
                channel = (img[:, :, 0] + img[:, :, 1] + img[:, :, 2]) / 3
            
            if softness > 0:
                low = max(0, threshold - softness / 2)
                high = min(1, threshold + softness / 2)
                mask = torch.clamp((channel - low) / (high - low + 1e-8), 0, 1)
            else:
                mask = (channel >= threshold).float()
            
            if invert:
                mask = 1.0 - mask
            masks.append(mask)
        
        return (torch.stack(masks),)


# =============================================================================
# NODE MAPPINGS
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_LayerCompositor": ComfyVFX_LayerCompositor,
    "ComfyVFX_CompositorCamera": ComfyVFX_CompositorCamera,
    "ComfyVFX_CompositorLayer": ComfyVFX_CompositorLayer,
    "ComfyVFX_MaskEditor": ComfyVFX_MaskEditor,
    "ComfyVFX_ImageMask": ComfyVFX_ImageMask,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_LayerCompositor": "ComfyVFX Layer Compositor",
    "ComfyVFX_CompositorCamera": "ComfyVFX Compositor Camera",
    "ComfyVFX_CompositorLayer": "ComfyVFX Compositor Layer",
    "ComfyVFX_MaskEditor": "ComfyVFX Mask Editor",
    "ComfyVFX_ImageMask": "ComfyVFX Image to Mask",
}
