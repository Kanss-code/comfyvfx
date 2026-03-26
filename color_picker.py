"""
ComfyVFX - Color Picker Node
Visual color picker with hue wheel and saturation/value square.
Outputs hex color string that can be used with particle system.
"""

from __future__ import annotations
from typing import Tuple


class ComfyVFX_ColorPicker:
    """
    Visual color picker node with hue wheel and SV square.
    Outputs hex color (#RRGGBB) for use with other nodes.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "red": ("INT", {"default": 255, "min": 0, "max": 255, "step": 1}),
                "green": ("INT", {"default": 128, "min": 0, "max": 255, "step": 1}),
                "blue": ("INT", {"default": 0, "min": 0, "max": 255, "step": 1}),
            }
        }

    RETURN_TYPES = ("COLOR", "INT", "INT", "INT")
    RETURN_NAMES = ("color", "red", "green", "blue")
    FUNCTION = "get_color"
    CATEGORY = "ComfyVFX/color"

    def get_color(self, red: int, green: int, blue: int) -> Tuple[str, int, int, int]:
        r = max(0, min(255, int(red)))
        g = max(0, min(255, int(green)))
        b = max(0, min(255, int(blue)))
        hex_color = f"#{r:02X}{g:02X}{b:02X}"
        return (hex_color, r, g, b)


NODE_CLASS_MAPPINGS = {
    "ComfyVFX_ColorPicker": ComfyVFX_ColorPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_ColorPicker": "ComfyVFX Color Picker",
}
