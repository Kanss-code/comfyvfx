"""
ComfyVFX - Visual Effects Toolkit for ComfyUI

Features:
- Pose proportion editing with live preview
- Combined OpenPose Proportional Editor (body + face + hands)
- Particle system for ControlNet guidance
- Animation scheduling and layer compositing
- 3D Viewport with sprites and camera animation
- 3D Viewport V2 (Beta) with timeline, keyframes, and enhanced controls
- Visual color picker
- Video Save with professional timeline preview
"""

from .openpose_proportion_nodes import NODE_CLASS_MAPPINGS as POSE_CLASS_MAPPINGS
from .openpose_proportion_nodes import NODE_DISPLAY_NAME_MAPPINGS as POSE_DISPLAY_MAPPINGS

from .openpose_editor import NODE_CLASS_MAPPINGS as OPENPOSE_EDITOR_CLASS_MAPPINGS
from .openpose_editor import NODE_DISPLAY_NAME_MAPPINGS as OPENPOSE_EDITOR_DISPLAY_MAPPINGS

from .particle_system import NODE_CLASS_MAPPINGS as PARTICLE_CLASS_MAPPINGS
from .particle_system import NODE_DISPLAY_NAME_MAPPINGS as PARTICLE_DISPLAY_MAPPINGS

from .compositor import NODE_CLASS_MAPPINGS as COMPOSITOR_CLASS_MAPPINGS
from .compositor import NODE_DISPLAY_NAME_MAPPINGS as COMPOSITOR_DISPLAY_MAPPINGS

from .viewport3d import NODE_CLASS_MAPPINGS as VIEWPORT3D_CLASS_MAPPINGS
from .viewport3d import NODE_DISPLAY_NAME_MAPPINGS as VIEWPORT3D_DISPLAY_MAPPINGS

from .viewport3d_v2 import NODE_CLASS_MAPPINGS as VIEWPORT3D_V2_CLASS_MAPPINGS
from .viewport3d_v2 import NODE_DISPLAY_NAME_MAPPINGS as VIEWPORT3D_V2_DISPLAY_MAPPINGS

from .color_picker import NODE_CLASS_MAPPINGS as COLOR_CLASS_MAPPINGS
from .color_picker import NODE_DISPLAY_NAME_MAPPINGS as COLOR_DISPLAY_MAPPINGS

from .video_save import NODE_CLASS_MAPPINGS as VIDEO_SAVE_CLASS_MAPPINGS
from .video_save import NODE_DISPLAY_NAME_MAPPINGS as VIDEO_SAVE_DISPLAY_MAPPINGS

from .comfyvfx_video_loader import NODE_CLASS_MAPPINGS as VIDEO_LOADER_CLASS_MAPPINGS
from .comfyvfx_video_loader import NODE_DISPLAY_NAME_MAPPINGS as VIDEO_LOADER_DISPLAY_MAPPINGS

# Combine all mappings
NODE_CLASS_MAPPINGS = {
    **POSE_CLASS_MAPPINGS, 
    **OPENPOSE_EDITOR_CLASS_MAPPINGS,
    **PARTICLE_CLASS_MAPPINGS,
    **COMPOSITOR_CLASS_MAPPINGS,
    **VIEWPORT3D_CLASS_MAPPINGS,
    **VIEWPORT3D_V2_CLASS_MAPPINGS,
    **COLOR_CLASS_MAPPINGS,
    **VIDEO_SAVE_CLASS_MAPPINGS,
    **VIDEO_LOADER_CLASS_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **POSE_DISPLAY_MAPPINGS, 
    **OPENPOSE_EDITOR_DISPLAY_MAPPINGS,
    **PARTICLE_DISPLAY_MAPPINGS,
    **COMPOSITOR_DISPLAY_MAPPINGS,
    **VIEWPORT3D_DISPLAY_MAPPINGS,
    **VIEWPORT3D_V2_DISPLAY_MAPPINGS,
    **COLOR_DISPLAY_MAPPINGS,
    **VIDEO_SAVE_DISPLAY_MAPPINGS,
    **VIDEO_LOADER_DISPLAY_MAPPINGS,
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
