"""
ComfyVFX - Particle System Nodes
- ParticleEmitter: Defines spawn location/pattern
- ParticleForces: Defines physics (gravity, wind, turbulence)
- ParticleSystem: Main renderer, outputs image sequence
- GroundPlane: Defines ground for particle collision
- LayerCompositor: Combines multiple image sequences with opacity/timing
"""

import math
import random
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter
import json


# =============================================================================
# PARTICLE CLASS
# =============================================================================

class Particle:
    def __init__(self, x, y, vx, vy, size, color, opacity, lifetime, size_end=None, opacity_end=None, color_end=None):
        self.x = x
        self.y = y
        self.vx = vx
        self.vy = vy
        self.size = size
        self.size_start = size
        self.size_end = size_end if size_end is not None else size
        self.color = color  # (r, g, b)
        self.color_start = color
        self.color_end = color_end if color_end is not None else color
        self.opacity = opacity
        self.opacity_start = opacity
        self.opacity_end = opacity_end if opacity_end is not None else 0.0
        self.lifetime = lifetime
        self.max_lifetime = lifetime
        self.age = 0
        self.alive = True
    
    def update(self, forces, ground=None, canvas_width=512, canvas_height=512, dt=1.0):
        if not self.alive:
            return
        
        # Apply forces
        ax, ay = 0, 0
        
        if forces:
            # Gravity
            ay += forces.get('gravity', 0)
            
            # Wind
            ax += forces.get('wind_x', 0)
            ay += forces.get('wind_y', 0)
            
            # Drag
            drag = forces.get('drag', 0)
            if drag > 0:
                self.vx *= (1 - drag)
                self.vy *= (1 - drag)
            
            # Turbulence (random per-frame jitter)
            turb = forces.get('turbulence', 0)
            if turb > 0:
                ax += random.uniform(-turb, turb)
                ay += random.uniform(-turb, turb)
        
        # Update velocity
        self.vx += ax * dt
        self.vy += ay * dt
        
        # Update position
        self.x += self.vx * dt
        self.y += self.vy * dt
        
        # Check ground collision
        if ground and ground.get('enabled', False):
            ground_y = ground.get('position_y', 1.0) * canvas_height
            ground_angle = math.radians(ground.get('rotation', 0))
            
            # For rotated ground, calculate y at particle's x position
            # Ground line: y = ground_y + (x - center_x) * tan(angle)
            center_x = canvas_width / 2
            effective_ground_y = ground_y + (self.x - center_x) * math.tan(ground_angle)
            
            if self.y >= effective_ground_y:
                if ground.get('kill_on_contact', True):
                    self.alive = False
                    return
                else:
                    # Bounce off ground
                    self.y = effective_ground_y - 1
                    bounce = ground.get('bounce', 0.3)
                    self.vy = -abs(self.vy) * bounce
                    self.vx *= (1 - ground.get('friction', 0.1))
        
        # Update age
        self.age += 1
        
        # Calculate life progress (0 to 1)
        life_t = self.age / max(1, self.max_lifetime)
        
        # Interpolate size over lifetime
        self.size = self.size_start + (self.size_end - self.size_start) * life_t
        
        # Interpolate opacity over lifetime
        self.opacity = self.opacity_start + (self.opacity_end - self.opacity_start) * life_t
        
        # Interpolate color over lifetime
        self.color = tuple(
            int(self.color_start[i] + (self.color_end[i] - self.color_start[i]) * life_t)
            for i in range(3)
        )
        
        # Check if dead (lifetime expired)
        if self.age >= self.max_lifetime:
            self.alive = False
            return
        
        # Kill particles that go way off screen (with margin)
        margin = 100
        if (self.x < -margin or self.x > canvas_width + margin or
            self.y < -margin or self.y > canvas_height + margin):
            self.alive = False


# =============================================================================
# PARTICLE EMITTER NODE
# =============================================================================

class ComfyVFX_ParticleEmitter:
    """
    Defines where and how particles spawn.
    Can emit from point, line, circle, box, or follow pose keypoints.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "emitter_type": (["point", "line", "circle", "box", "pose_keypoint"], {"default": "point"}),
                "width": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 512, "min": 64, "max": 4096, "step": 64}),
                # Point / center position (normalized 0-1)
                "position_x": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                "position_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                # Line end point (for line emitter)
                "end_x": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 1.0, "step": 0.01}),
                "end_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01}),
                # Circle/box size
                "radius": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 1.0, "step": 0.01}),
                # Emission direction
                "emit_angle": ("FLOAT", {"default": -90.0, "min": -180.0, "max": 180.0, "step": 1.0}),
                "emit_spread": ("FLOAT", {"default": 30.0, "min": 0.0, "max": 180.0, "step": 1.0}),
                # For pose keypoint mode
                "keypoint_index": ("INT", {"default": 4, "min": 0, "max": 17, "step": 1}),
            },
            "optional": {
                "pose_keypoint": ("POSE_KEYPOINT",),
            }
        }
    
    RETURN_TYPES = ("EMITTER_CONFIG",)
    RETURN_NAMES = ("emitter",)
    FUNCTION = "create_emitter"
    CATEGORY = "ComfyVFX/particles"
    
    def create_emitter(self, emitter_type, width, height, position_x, position_y, 
                       end_x, end_y, radius, emit_angle, emit_spread, keypoint_index,
                       pose_keypoint=None):
        
        config = {
            "type": emitter_type,
            "width": width,
            "height": height,
            "position_x": position_x,
            "position_y": position_y,
            "end_x": end_x,
            "end_y": end_y,
            "radius": radius,
            "emit_angle": emit_angle,
            "emit_spread": emit_spread,
            "keypoint_index": keypoint_index,
            "pose_keypoint": pose_keypoint,
        }
        
        return (config,)


# =============================================================================
# PARTICLE FORCES NODE
# =============================================================================

class ComfyVFX_ParticleForces:
    """
    Defines physics forces acting on particles.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "gravity": ("FLOAT", {"default": 0.5, "min": -10.0, "max": 10.0, "step": 0.1}),
                "wind_x": ("FLOAT", {"default": 0.0, "min": -10.0, "max": 10.0, "step": 0.1}),
                "wind_y": ("FLOAT", {"default": 0.0, "min": -10.0, "max": 10.0, "step": 0.1}),
                "drag": ("FLOAT", {"default": 0.02, "min": 0.0, "max": 1.0, "step": 0.01}),
                "turbulence": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 5.0, "step": 0.1}),
            }
        }
    
    RETURN_TYPES = ("FORCES_CONFIG",)
    RETURN_NAMES = ("forces",)
    FUNCTION = "create_forces"
    CATEGORY = "ComfyVFX/particles"
    
    def create_forces(self, gravity, wind_x, wind_y, drag, turbulence):
        config = {
            "gravity": gravity,
            "wind_x": wind_x,
            "wind_y": wind_y,
            "drag": drag,
            "turbulence": turbulence,
        }
        return (config,)


# =============================================================================
# GROUND PLANE NODE
# =============================================================================

class ComfyVFX_GroundPlane:
    """
    Defines a ground plane for particle collision.
    Particles can bounce off or be killed on contact.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "enabled": ("BOOLEAN", {"default": True}),
                "position_y": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.01, 
                               "display": "slider"}),
                "rotation": ("FLOAT", {"default": 0.0, "min": -45.0, "max": 45.0, "step": 1.0,
                            "display": "slider"}),
                "kill_on_contact": ("BOOLEAN", {"default": True}),
                "bounce": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.05,
                          "display": "slider"}),
                "friction": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 1.0, "step": 0.05,
                            "display": "slider"}),
            }
        }
    
    RETURN_TYPES = ("GROUND_CONFIG",)
    RETURN_NAMES = ("ground",)
    FUNCTION = "create_ground"
    CATEGORY = "ComfyVFX/particles"
    
    def create_ground(self, enabled, position_y, rotation, kill_on_contact, bounce, friction):
        config = {
            "enabled": enabled,
            "position_y": position_y,
            "rotation": rotation,
            "kill_on_contact": kill_on_contact,
            "bounce": bounce,
            "friction": friction,
        }
        return (config,)


# =============================================================================
# PARTICLE SYSTEM NODE
# =============================================================================

# =============================================================================
# PARTICLE SYSTEM NODE
# =============================================================================

def hex_to_rgb(hex_color):
    """Convert hex color string (#RRGGBB) to RGB tuple (0-255).
    Also handles if color is already a tuple or if it's a COLOR type from Color Picker."""
    if hex_color is None:
        return (255, 255, 255)
    
    # If it's already a tuple of RGB values
    if isinstance(hex_color, (tuple, list)):
        if len(hex_color) >= 3:
            return (int(hex_color[0]), int(hex_color[1]), int(hex_color[2]))
        return (255, 255, 255)
    
    # Handle string hex color
    if isinstance(hex_color, str):
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            try:
                return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
            except ValueError:
                return (255, 255, 255)
    
    return (255, 255, 255)


class ComfyVFX_ParticleSystem:
    """
    Main particle renderer. Takes emitter and forces, outputs image sequence.
    """
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "emitter": ("EMITTER_CONFIG",),
                "num_frames": ("INT", {"default": 60, "min": 1, "max": 1000, "step": 1}),
                # Timing
                "start_frame": ("INT", {"default": 0, "min": 0, "max": 1000, "step": 1}),
                "emission_duration": ("INT", {"default": 30, "min": 1, "max": 1000, "step": 1}),
                # Particle spawn rate
                "particles_per_frame": ("INT", {"default": 5, "min": 1, "max": 100, "step": 1}),
                "max_particles": ("INT", {"default": 500, "min": 1, "max": 5000, "step": 10}),
                # Particle properties
                "particle_lifetime": ("INT", {"default": 30, "min": 1, "max": 200, "step": 1}),
                "lifetime_variance": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.05}),
                "speed": ("FLOAT", {"default": 5.0, "min": 0.0, "max": 50.0, "step": 0.5}),
                "speed_variance": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.05}),
                # Size
                "size_start": ("FLOAT", {"default": 8.0, "min": 1.0, "max": 100.0, "step": 1.0}),
                "size_end": ("FLOAT", {"default": 2.0, "min": 0.0, "max": 100.0, "step": 1.0}),
                "size_variance": ("FLOAT", {"default": 0.3, "min": 0.0, "max": 1.0, "step": 0.05}),
                # Opacity
                "opacity_start": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "opacity_end": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                # Shape
                "particle_shape": (["circle", "square", "star", "spark"], {"default": "circle"}),
                # Rendering
                "glow": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 20.0, "step": 1.0}),
                "motion_blur": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0, "step": 0.1}),
                # Random seed
                "seed": ("INT", {"default": 0, "min": 0, "max": 999999, "step": 1}),
            },
            "optional": {
                "forces": ("FORCES_CONFIG",),
                "ground": ("GROUND_CONFIG",),
                # Color inputs - can connect from Color Picker (COLOR) or use string directly
                "color_start": ("*", {"default": "#FFC832"}),
                "color_end": ("*", {"default": "#FF6400"}),
            }
        }
    
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("particles",)
    FUNCTION = "render"
    CATEGORY = "ComfyVFX/particles"
    
    def get_spawn_position(self, emitter, frame_idx):
        """Get spawn position based on emitter type."""
        width = emitter["width"]
        height = emitter["height"]
        etype = emitter["type"]
        
        if etype == "point":
            x = emitter["position_x"] * width
            y = emitter["position_y"] * height
            
        elif etype == "line":
            t = random.random()
            x = (emitter["position_x"] + t * (emitter["end_x"] - emitter["position_x"])) * width
            y = (emitter["position_y"] + t * (emitter["end_y"] - emitter["position_y"])) * height
            
        elif etype == "circle":
            angle = random.uniform(0, 2 * math.pi)
            r = random.uniform(0, emitter["radius"]) * min(width, height)
            x = emitter["position_x"] * width + math.cos(angle) * r
            y = emitter["position_y"] * height + math.sin(angle) * r
            
        elif etype == "box":
            r = emitter["radius"]
            x = (emitter["position_x"] + random.uniform(-r, r)) * width
            y = (emitter["position_y"] + random.uniform(-r, r)) * height
            
        elif etype == "pose_keypoint":
            pose_data = emitter.get("pose_keypoint")
            kp_idx = emitter["keypoint_index"]
            
            if pose_data is not None:
                # Handle list of poses (get frame)
                if isinstance(pose_data, list):
                    pose_frame = pose_data[min(frame_idx, len(pose_data) - 1)]
                else:
                    pose_frame = pose_data
                
                # Get keypoint position
                if pose_frame and "people" in pose_frame and len(pose_frame["people"]) > 0:
                    person = pose_frame["people"][0]
                    if "pose_keypoints_2d" in person:
                        kps = person["pose_keypoints_2d"]
                        if kp_idx * 3 + 2 < len(kps):
                            kp_x = kps[kp_idx * 3]
                            kp_y = kps[kp_idx * 3 + 1]
                            kp_conf = kps[kp_idx * 3 + 2]
                            
                            if kp_conf > 0:
                                # Check if normalized
                                if kp_x <= 1.0 and kp_y <= 1.0:
                                    x = kp_x * width
                                    y = kp_y * height
                                else:
                                    x = kp_x
                                    y = kp_y
                                return x, y
            
            # Fallback to center
            x = emitter["position_x"] * width
            y = emitter["position_y"] * height
        
        else:
            x = emitter["position_x"] * width
            y = emitter["position_y"] * height
        
        return x, y
    
    def get_spawn_velocity(self, emitter, speed):
        """Get spawn velocity based on emission angle and spread."""
        base_angle = math.radians(emitter["emit_angle"])
        spread = math.radians(emitter["emit_spread"])
        
        angle = base_angle + random.uniform(-spread, spread)
        
        vx = math.cos(angle) * speed
        vy = math.sin(angle) * speed
        
        return vx, vy
    
    def draw_particle(self, draw, p, shape, motion_blur=0):
        """Draw a single particle."""
        if not p.alive or p.opacity <= 0 or p.size <= 0:
            return
        
        x, y = p.x, p.y
        size = max(1, p.size)
        color = p.color
        opacity = int(p.opacity * 255)
        
        fill_color = (*color, opacity)
        
        if shape == "circle":
            draw.ellipse([x - size, y - size, x + size, y + size], fill=fill_color)
            
        elif shape == "square":
            draw.rectangle([x - size, y - size, x + size, y + size], fill=fill_color)
            
        elif shape == "star":
            # 4-point star
            points = []
            for i in range(8):
                angle = i * math.pi / 4
                r = size if i % 2 == 0 else size * 0.4
                px = x + math.cos(angle) * r
                py = y + math.sin(angle) * r
                points.append((px, py))
            draw.polygon(points, fill=fill_color)
            
        elif shape == "spark":
            # Elongated spark based on velocity
            length = size * 2
            if hasattr(p, 'vx') and hasattr(p, 'vy'):
                vel_mag = math.sqrt(p.vx**2 + p.vy**2)
                if vel_mag > 0.1:
                    dx = (p.vx / vel_mag) * length
                    dy = (p.vy / vel_mag) * length
                    draw.line([(x - dx, y - dy), (x + dx/2, y + dy/2)], fill=fill_color, width=max(1, int(size/2)))
                else:
                    draw.ellipse([x - size/2, y - size/2, x + size/2, y + size/2], fill=fill_color)
            else:
                draw.ellipse([x - size/2, y - size/2, x + size/2, y + size/2], fill=fill_color)
        
        # Motion blur trail
        if motion_blur > 0 and hasattr(p, 'vx') and hasattr(p, 'vy'):
            trail_opacity = int(opacity * 0.3 * motion_blur)
            if trail_opacity > 0:
                trail_color = (*color, trail_opacity)
                trail_x = x - p.vx * motion_blur * 2
                trail_y = y - p.vy * motion_blur * 2
                draw.line([(trail_x, trail_y), (x, y)], fill=trail_color, width=max(1, int(size)))
    
    def render(self, emitter, num_frames, start_frame, emission_duration,
               particles_per_frame, max_particles, particle_lifetime, lifetime_variance,
               speed, speed_variance, size_start, size_end, size_variance,
               opacity_start, opacity_end, particle_shape, glow, motion_blur, seed,
               forces=None, ground=None, color_start="#FFC832", color_end="#FF6400"):
        
        random.seed(seed)
        
        width = emitter["width"]
        height = emitter["height"]
        
        particles = []
        frames = []
        
        # Convert hex colors to RGB tuples
        color_start_rgb = hex_to_rgb(color_start)
        color_end_rgb = hex_to_rgb(color_end)
        
        for frame_idx in range(num_frames):
            # Create new image with transparency
            img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # Spawn new particles if within emission window
            if start_frame <= frame_idx < start_frame + emission_duration:
                for _ in range(particles_per_frame):
                    if len(particles) < max_particles:
                        # Position
                        x, y = self.get_spawn_position(emitter, frame_idx)
                        
                        # Speed with variance
                        p_speed = speed * (1 + random.uniform(-speed_variance, speed_variance))
                        vx, vy = self.get_spawn_velocity(emitter, p_speed)
                        
                        # Size with variance
                        p_size = size_start * (1 + random.uniform(-size_variance, size_variance))
                        p_size_end = size_end * (1 + random.uniform(-size_variance, size_variance))
                        
                        # Lifetime with variance
                        p_lifetime = int(particle_lifetime * (1 + random.uniform(-lifetime_variance, lifetime_variance)))
                        p_lifetime = max(1, p_lifetime)
                        
                        particle = Particle(
                            x=x, y=y, vx=vx, vy=vy,
                            size=p_size, size_end=p_size_end,
                            color=color_start_rgb, color_end=color_end_rgb,
                            opacity=opacity_start, opacity_end=opacity_end,
                            lifetime=p_lifetime
                        )
                        particles.append(particle)
            
            # Update and draw particles
            alive_particles = []
            for p in particles:
                p.update(forces, ground, width, height)
                if p.alive:
                    self.draw_particle(draw, p, particle_shape, motion_blur)
                    alive_particles.append(p)
            
            particles = alive_particles
            
            # Apply glow effect
            if glow > 0:
                # Create glow layer
                glow_img = img.filter(ImageFilter.GaussianBlur(radius=glow))
                # Composite glow under particles
                result = Image.new('RGBA', (width, height), (0, 0, 0, 0))
                result = Image.alpha_composite(result, glow_img)
                result = Image.alpha_composite(result, img)
                img = result
            
            # Convert to RGB with black background for output
            rgb_img = Image.new('RGB', (width, height), (0, 0, 0))
            rgb_img.paste(img, mask=img.split()[3])
            
            # Convert to tensor
            np_img = np.array(rgb_img).astype(np.float32) / 255.0
            frames.append(torch.from_numpy(np_img)[None,])
        
        batch_tensor = torch.cat(frames, dim=0)
        return (batch_tensor,)



# =============================================================================
# NODE MAPPINGS
# =============================================================================

NODE_CLASS_MAPPINGS = {
    "ComfyVFX_ParticleEmitter": ComfyVFX_ParticleEmitter,
    "ComfyVFX_ParticleForces": ComfyVFX_ParticleForces,
    "ComfyVFX_GroundPlane": ComfyVFX_GroundPlane,
    "ComfyVFX_ParticleSystem": ComfyVFX_ParticleSystem,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ComfyVFX_ParticleEmitter": "ComfyVFX Particle Emitter",
    "ComfyVFX_ParticleForces": "ComfyVFX Particle Forces",
    "ComfyVFX_GroundPlane": "ComfyVFX Ground Plane",
    "ComfyVFX_ParticleSystem": "ComfyVFX Particle System",
}
