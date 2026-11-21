"""Small CPU image descriptor shared by data preparation and inference."""

from io import BytesIO

import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 16_000_000


def image_features(data: bytes):
    with Image.open(BytesIO(data), formats=("JPEG", "PNG", "WEBP")) as image:
        if image.width * image.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("Image is too large")
        rgb = ImageOps.exif_transpose(image).convert("RGB").resize((64, 64))
        hsv = np.asarray(rgb.convert("HSV"), dtype=np.float32) / 255
        light = np.asarray(rgb.convert("L"), dtype=np.float32) / 255
    dy, dx = np.gradient(light)
    angles = np.arctan2(dy, dx) % np.pi
    magnitude = np.hypot(dx, dy)
    features = []
    for y in (0, 32):
        for x in (0, 32):
            tile = (slice(y, y + 32), slice(x, x + 32))
            for channel in hsv[tile].transpose(2, 0, 1):
                features.extend(np.histogram(channel, bins=8, range=(0, 1))[0] / channel.size)
            histogram, _ = np.histogram(angles[tile], bins=9, range=(0, np.pi), weights=magnitude[tile])
            features.extend(histogram / max(sum(histogram), 1e-6))
    return np.asarray(features, dtype=np.float32)
