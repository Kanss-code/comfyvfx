"""
ComfyVFX - Video Save Node
Professional video encoding with clean UI and timeline scrubbing.
Supports multiple formats: H.264, H.265, ProRes, AV1, WebM, GIF, PNG sequences.
"""

import os
import sys
import json
import subprocess
import numpy as np
import re
import datetime
from typing import List, Tuple, Optional, Dict, Any
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import folder_paths
from comfy.utils import ProgressBar


def get_ffmpeg_path() -> Optional[str]:
    """Find ffmpeg executable."""
    # Check common locations
    possible_paths = [
        "ffmpeg",
        "/usr/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        os.path.join(os.path.dirname(__file__), "ffmpeg"),
    ]
    
    for path in possible_paths:
        try:
            result = subprocess.run([path, "-version"], capture_output=True, timeout=5)
            if result.returncode == 0:
                return path
        except (subprocess.SubprocessError, FileNotFoundError, OSError):
            continue
    
    # Try imageio-ffmpeg as fallback
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        pass
    
    return None


FFMPEG_PATH = get_ffmpeg_path()


# Video format configurations
VIDEO_FORMATS = {
    "h264_mp4": {
        "extension": "mp4",
        "codec": "libx264",
        "args": ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p"],
        "quality_param": "-crf",
        "quality_default": 19,
        "quality_range": (0, 51),
        "description": "H.264 MP4 - Universal compatibility"
    },
    "h265_mp4": {
        "extension": "mp4",
        "codec": "libx265",
        "args": ["-c:v", "libx265", "-preset", "medium", "-pix_fmt", "yuv420p", "-vtag", "hvc1"],
        "quality_param": "-crf",
        "quality_default": 22,
        "quality_range": (0, 51),
        "description": "H.265/HEVC MP4 - Better compression"
    },
    "prores_mov": {
        "extension": "mov",
        "codec": "prores_ks",
        "args": ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le"],
        "quality_param": None,
        "description": "ProRes HQ - Professional editing"
    },
    "av1_webm": {
        "extension": "webm",
        "codec": "libsvtav1",
        "args": ["-c:v", "libsvtav1", "-pix_fmt", "yuv420p"],
        "quality_param": "-crf",
        "quality_default": 23,
        "quality_range": (0, 63),
        "description": "AV1 WebM - Modern efficient codec"
    },
    "vp9_webm": {
        "extension": "webm",
        "codec": "libvpx-vp9",
        "args": ["-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0"],
        "quality_param": "-crf",
        "quality_default": 30,
        "quality_range": (0, 63),
        "description": "VP9 WebM - Good web compatibility"
    },
    "gif": {
        "extension": "gif",
        "codec": "gif",
        "args": [],
        "quality_param": None,
        "is_gif": True,
        "description": "GIF - Animated image"
    },
    "png_sequence": {
        "extension": "png",
        "codec": None,
        "args": [],
        "quality_param": None,
        "is_sequence": True,
        "description": "PNG Sequence - Lossless frames"
    },
    "nvenc_h264": {
        "extension": "mp4",
        "codec": "h264_nvenc",
        "args": ["-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4"],
        "quality_param": "-cq",
        "quality_default": 19,
        "quality_range": (0, 51),
        "requires_gpu": True,
        "description": "NVENC H.264 - GPU accelerated"
    },
    "nvenc_hevc": {
        "extension": "mp4",
        "codec": "hevc_nvenc",
        "args": ["-c:v", "hevc_nvenc", "-pix_fmt", "yuv420p", "-preset", "p4", "-vtag", "hvc1"],
        "quality_param": "-cq",
        "quality_default": 22,
        "quality_range": (0, 51),
        "requires_gpu": True,
        "description": "NVENC HEVC - GPU accelerated"
    },
    "ffv1_mkv": {
        "extension": "mkv",
        "codec": "ffv1",
        "args": ["-c:v", "ffv1", "-level", "3", "-coder", "1", "-context", "1", "-slices", "16"],
        "quality_param": None,
        "description": "FFV1 MKV - Lossless archival"
    },
}


def tensor_to_bytes(tensor: torch.Tensor) -> np.ndarray:
    """Convert tensor to uint8 numpy array."""
    arr = tensor.cpu().numpy() * 255.0 + 0.5
    return np.clip(arr, 0, 255).astype(np.uint8)


def create_gif_palette_args(dither: str = "sierra2_4a") -> List[str]:
    """Create ffmpeg filter for GIF with palette generation."""
    return [
        "-filter_complex",
        f"[0:v] split [a][b]; [a] palettegen=reserve_transparent=on:transparency_color=ffffff [p]; [b][p] paletteuse=dither={dither}"
    ]


class ComfyVFX_VideoSave:
    """
    Professional video encoder with timeline preview.
    Supports H.264, H.265, ProRes, AV1, WebM, GIF, and PNG sequences.
    Features clean UI with scrubbing timeline and full playback controls.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        format_list = list(VIDEO_FORMATS.keys())
        
        return {
            "required": {
                "images": ("IMAGE",),
                "filename_prefix": ("STRING", {"default": "ComfyVFX"}),
                "format": (format_list, {"default": "h264_mp4"}),
                "fps": ("FLOAT", {"default": 24.0, "min": 1.0, "max": 120.0, "step": 0.1}),
                "quality": ("INT", {"default": 19, "min": 0, "max": 63, "step": 1}),
                "loop_count": ("INT", {"default": 0, "min": 0, "max": 100, "step": 1, 
                               "tooltip": "0 = infinite loop (for GIF)"}),
            },
            "optional": {
                "audio": ("AUDIO",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            }
        }
    
    RETURN_TYPES = ("STRING", "INT", "FLOAT")
    RETURN_NAMES = ("file_path", "frame_count", "duration")
    OUTPUT_NODE = True
    CATEGORY = "ComfyVFX/output"
    FUNCTION = "save_video"
    
    def save_video(
        self,
        images: torch.Tensor,
        filename_prefix: str,
        format: str,
        fps: float,
        quality: int,
        loop_count: int = 0,
        audio: Optional[Dict] = None,
        prompt: Optional[Dict] = None,
        extra_pnginfo: Optional[Dict] = None,
        unique_id: Optional[str] = None,
    ) -> Tuple[Dict, Tuple[str, int, float]]:
        
        if images is None or (isinstance(images, torch.Tensor) and images.size(0) == 0):
            return {"ui": {"videos": []}, "result": ("", 0, 0.0)}
        
        num_frames = len(images)
        duration = num_frames / fps
        
        # Get format config
        fmt_config = VIDEO_FORMATS.get(format, VIDEO_FORMATS["h264_mp4"])
        
        # Setup output directory
        output_dir = folder_paths.get_output_directory()
        
        # Generate unique filename
        counter = self._get_next_counter(output_dir, filename_prefix, fmt_config["extension"])
        
        if fmt_config.get("is_sequence"):
            # PNG sequence
            file_path = self._save_png_sequence(
                images, output_dir, filename_prefix, counter, 
                prompt, extra_pnginfo
            )
        elif fmt_config.get("is_gif"):
            # GIF
            file_path = self._save_gif(
                images, output_dir, filename_prefix, counter,
                fps, loop_count
            )
        else:
            # Video format
            file_path = self._save_video(
                images, output_dir, filename_prefix, counter,
                fmt_config, fps, quality, audio, prompt, extra_pnginfo
            )
        
        # Prepare preview data for UI
        subfolder = os.path.relpath(os.path.dirname(file_path), output_dir)
        if subfolder == ".":
            subfolder = ""
        
        filename = os.path.basename(file_path)
        
        # Build frame list for timeline scrubbing
        frame_data = []
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        
        # Save preview frames for timeline (every Nth frame for efficiency)
        preview_interval = max(1, num_frames // 100)  # Max 100 preview frames
        pbar = ProgressBar(num_frames)
        
        for i in range(num_frames):
            if i % preview_interval == 0 or i == num_frames - 1:
                frame_filename = f"{filename_prefix}_{counter:05d}_preview_{i:05d}.jpg"
                frame_path = os.path.join(temp_dir, frame_filename)
                
                # Save compressed preview frame
                frame_img = Image.fromarray(tensor_to_bytes(images[i]))
                # Resize for preview if large
                max_preview_size = 512
                if max(frame_img.size) > max_preview_size:
                    ratio = max_preview_size / max(frame_img.size)
                    new_size = (int(frame_img.size[0] * ratio), int(frame_img.size[1] * ratio))
                    frame_img = frame_img.resize(new_size, Image.LANCZOS)
                
                frame_img.save(frame_path, "JPEG", quality=85)
                
                frame_data.append({
                    "filename": frame_filename,
                    "subfolder": "",
                    "type": "temp",
                    "frame_index": i,
                })
            pbar.update(1)
        
        # Return preview info to frontend
        video_info = {
            "filename": filename,
            "subfolder": subfolder,
            "type": "output",
            "format": format,
            "fps": fps,
            "frame_count": num_frames,
            "duration": duration,
            "width": images.shape[2],
            "height": images.shape[1],
            "fullpath": file_path,
        }
        
        return {
            "ui": {
                "videos": [video_info],
                "frames": frame_data,
                "video_info": [video_info],
            },
            "result": (file_path, num_frames, duration)
        }
    
    def _get_next_counter(self, output_dir: str, prefix: str, extension: str) -> int:
        """Get next available counter for filename."""
        max_counter = 0
        pattern = re.compile(rf"{re.escape(prefix)}_(\d+)", re.IGNORECASE)
        
        try:
            for f in os.listdir(output_dir):
                match = pattern.match(f)
                if match:
                    counter = int(match.group(1))
                    max_counter = max(max_counter, counter)
        except OSError:
            pass
        
        return max_counter + 1
    
    def _save_png_sequence(
        self,
        images: torch.Tensor,
        output_dir: str,
        prefix: str,
        counter: int,
        prompt: Optional[Dict],
        extra_pnginfo: Optional[Dict],
    ) -> str:
        """Save images as PNG sequence."""
        seq_dir = os.path.join(output_dir, f"{prefix}_{counter:05d}")
        os.makedirs(seq_dir, exist_ok=True)
        
        pbar = ProgressBar(len(images))
        
        for i, img_tensor in enumerate(images):
            img = Image.fromarray(tensor_to_bytes(img_tensor))
            
            # Add metadata to first frame
            metadata = PngInfo()
            if i == 0:
                if prompt is not None:
                    metadata.add_text("prompt", json.dumps(prompt))
                if extra_pnginfo is not None:
                    for k, v in extra_pnginfo.items():
                        metadata.add_text(k, json.dumps(v))
            
            frame_path = os.path.join(seq_dir, f"{i:05d}.png")
            img.save(frame_path, pnginfo=metadata, compress_level=4)
            pbar.update(1)
        
        return seq_dir
    
    def _save_gif(
        self,
        images: torch.Tensor,
        output_dir: str,
        prefix: str,
        counter: int,
        fps: float,
        loop_count: int,
    ) -> str:
        """Save images as animated GIF."""
        file_path = os.path.join(output_dir, f"{prefix}_{counter:05d}.gif")
        
        frames = []
        pbar = ProgressBar(len(images))
        
        for img_tensor in images:
            frames.append(Image.fromarray(tensor_to_bytes(img_tensor)))
            pbar.update(1)
        
        duration_ms = int(1000 / fps)
        frames[0].save(
            file_path,
            save_all=True,
            append_images=frames[1:],
            duration=duration_ms,
            loop=loop_count,
            disposal=2,
        )
        
        return file_path
    
    def _save_video(
        self,
        images: torch.Tensor,
        output_dir: str,
        prefix: str,
        counter: int,
        fmt_config: Dict,
        fps: float,
        quality: int,
        audio: Optional[Dict],
        prompt: Optional[Dict],
        extra_pnginfo: Optional[Dict],
    ) -> str:
        """Save images as video using ffmpeg."""
        if FFMPEG_PATH is None:
            raise RuntimeError(
                "ffmpeg not found. Install ffmpeg or imageio-ffmpeg:\n"
                "  pip install imageio-ffmpeg"
            )
        
        extension = fmt_config["extension"]
        file_path = os.path.join(output_dir, f"{prefix}_{counter:05d}.{extension}")
        
        # Determine input pixel format
        has_alpha = images.shape[-1] == 4
        pix_fmt = "rgba" if has_alpha else "rgb24"
        
        # Build ffmpeg command
        width, height = images.shape[2], images.shape[1]
        
        args = [
            FFMPEG_PATH,
            "-y",  # Overwrite
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{width}x{height}",
            "-pix_fmt", pix_fmt,
            "-r", str(fps),
            "-i", "-",  # Input from pipe
        ]
        
        # Add codec args
        args.extend(fmt_config["args"])
        
        # Add quality param if applicable
        quality_param = fmt_config.get("quality_param")
        if quality_param:
            q_range = fmt_config.get("quality_range", (0, 51))
            quality = max(q_range[0], min(q_range[1], quality))
            args.extend([quality_param, str(quality)])
        
        # Color space settings for proper playback
        args.extend([
            "-vf", "scale=out_color_matrix=bt709",
            "-color_range", "tv",
            "-colorspace", "bt709", 
            "-color_primaries", "bt709",
            "-color_trc", "bt709",
        ])
        
        # Add metadata
        if prompt is not None or extra_pnginfo is not None:
            metadata = {}
            if prompt:
                metadata["prompt"] = json.dumps(prompt)
            if extra_pnginfo:
                metadata["workflow"] = json.dumps(extra_pnginfo.get("workflow", {}))
            
            # Escape metadata for ffmpeg
            comment = json.dumps(metadata).replace("\\", "\\\\").replace(";", "\\;")
            args.extend(["-metadata", f"comment={comment}"])
        
        args.append(file_path)
        
        # Run ffmpeg
        pbar = ProgressBar(len(images))
        
        with subprocess.Popen(
            args,
            stdin=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ) as proc:
            try:
                for img_tensor in images:
                    frame_bytes = tensor_to_bytes(img_tensor).tobytes()
                    proc.stdin.write(frame_bytes)
                    pbar.update(1)
                
                proc.stdin.close()
                stderr = proc.stderr.read()
                proc.wait()
                
                if proc.returncode != 0:
                    raise RuntimeError(f"ffmpeg error: {stderr.decode('utf-8', errors='replace')}")
                    
            except BrokenPipeError:
                stderr = proc.stderr.read()
                raise RuntimeError(f"ffmpeg pipe error: {stderr.decode('utf-8', errors='replace')}")
        
        # Add audio if provided
        if audio is not None and "waveform" in audio:
            file_path = self._mux_audio(file_path, audio, fmt_config, fps)
        
        return file_path
    
    def _mux_audio(
        self,
        video_path: str,
        audio: Dict,
        fmt_config: Dict,
        fps: float,
    ) -> str:
        """Mux audio into video file."""
        output_path = video_path.replace(f".{fmt_config['extension']}", 
                                          f"_audio.{fmt_config['extension']}")
        
        sample_rate = audio.get("sample_rate", 44100)
        waveform = audio["waveform"]
        channels = waveform.shape[1] if len(waveform.shape) > 1 else 1
        
        # Determine audio codec based on container
        audio_codec = "aac"
        if fmt_config["extension"] == "webm":
            audio_codec = "libopus"
        elif fmt_config["extension"] == "mkv":
            audio_codec = "flac"
        
        args = [
            FFMPEG_PATH,
            "-y",
            "-i", video_path,
            "-ar", str(sample_rate),
            "-ac", str(channels),
            "-f", "f32le",
            "-i", "-",
            "-c:v", "copy",
            "-c:a", audio_codec,
            "-shortest",
            output_path,
        ]
        
        audio_data = waveform.squeeze(0).transpose(0, 1).numpy().tobytes()
        
        result = subprocess.run(args, input=audio_data, capture_output=True)
        
        if result.returncode == 0:
            # Remove original, keep audio version
            os.remove(video_path)
            os.rename(output_path, video_path)
        
        return video_path


NODE_CLASS_MAPPINGS = {
    "ComfyVFX_VideoSave": ComfyVFX_VideoSave,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_VideoSave": "ComfyVFX Video Save",
}
