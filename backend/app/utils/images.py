"""Image download, perceptual hashing, and OpenCV similarity utilities.

These power the *visual-first* matching requirement: we never rely on text
alone. Perceptual hashing gives a cheap first-pass similarity; OpenCV ORB
feature matching gives a structural similarity; AI vision gives the final
verdict (see visual_matcher.py).
"""
from __future__ import annotations

import hashlib
import os
from io import BytesIO
from typing import Optional

import httpx

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

try:
    import numpy as np
    from PIL import Image
    import imagehash

    _PIL_OK = True
except Exception as exc:  # pragma: no cover - optional at runtime
    logger.warning("Pillow/imagehash unavailable: %s", exc)
    _PIL_OK = False

try:
    import cv2  # type: ignore

    _CV2_OK = True
except Exception as exc:  # pragma: no cover - optional at runtime
    logger.warning("OpenCV unavailable, ORB similarity disabled: %s", exc)
    _CV2_OK = False


def ensure_store() -> str:
    os.makedirs(settings.image_store_dir, exist_ok=True)
    return settings.image_store_dir


async def download_image(url: str, *, filename_hint: str = "") -> Optional[str]:
    """Download an image URL to the local store. Returns the local path or None."""
    if not url:
        return None
    ensure_store()
    digest = hashlib.sha1(url.encode()).hexdigest()[:20]
    suffix = ".jpg"
    for ext in (".png", ".webp", ".jpeg", ".jpg"):
        if url.lower().split("?")[0].endswith(ext):
            suffix = ext
            break
    path = os.path.join(settings.image_store_dir, f"{filename_hint}{digest}{suffix}")
    if os.path.exists(path):
        return path
    try:
        async with httpx.AsyncClient(
            timeout=20, headers={"User-Agent": settings.request_user_agent}
        ) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
            with open(path, "wb") as fh:
                fh.write(resp.content)
        return path
    except Exception as exc:
        logger.warning("Failed to download image %s: %s", url, exc)
        return None


def perceptual_hash(path: str) -> Optional[str]:
    """Return a hex perceptual hash (pHash) string for an image file."""
    if not _PIL_OK or not path or not os.path.exists(path):
        return None
    try:
        with Image.open(path) as img:
            img = img.convert("RGB")
            ph = imagehash.phash(img, hash_size=settings.perceptual_hash_size)
            return str(ph)
    except Exception as exc:
        logger.warning("pHash failed for %s: %s", path, exc)
        return None


def hamming_distance(hash_a: Optional[str], hash_b: Optional[str]) -> Optional[int]:
    """Hamming distance between two hex pHash strings (lower = more similar)."""
    if not hash_a or not hash_b:
        return None
    try:
        a = imagehash.hex_to_hash(hash_a)
        b = imagehash.hex_to_hash(hash_b)
        return a - b
    except Exception:
        return None


def phash_similarity(distance: Optional[int]) -> Optional[float]:
    """Map a pHash Hamming distance to a 0-100 similarity score."""
    if distance is None:
        return None
    # hash_size=16 -> 256-bit hash -> max distance 256.
    bits = settings.perceptual_hash_size * settings.perceptual_hash_size
    sim = max(0.0, 1.0 - (distance / bits))
    return round(sim * 100, 2)


def orb_similarity(path_a: str, path_b: str) -> Optional[float]:
    """Structural similarity via ORB feature matching (0-100). Optional."""
    if not _CV2_OK or not (path_a and path_b):
        return None
    if not (os.path.exists(path_a) and os.path.exists(path_b)):
        return None
    try:
        img1 = cv2.imread(path_a, cv2.IMREAD_GRAYSCALE)
        img2 = cv2.imread(path_b, cv2.IMREAD_GRAYSCALE)
        if img1 is None or img2 is None:
            return None
        orb = cv2.ORB_create(nfeatures=800)
        kp1, des1 = orb.detectAndCompute(img1, None)
        kp2, des2 = orb.detectAndCompute(img2, None)
        if des1 is None or des2 is None or len(kp1) == 0 or len(kp2) == 0:
            return None
        bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
        matches = bf.match(des1, des2)
        good = [m for m in matches if m.distance < 64]
        denom = max(1, min(len(kp1), len(kp2)))
        return round(min(1.0, len(good) / denom) * 100, 2)
    except Exception as exc:
        logger.warning("ORB similarity failed: %s", exc)
        return None


def combined_visual_similarity(
    phash_dist: Optional[int], orb_score: Optional[float]
) -> Optional[float]:
    """Blend pHash and ORB into a single 0-100 visual similarity score."""
    ph = phash_similarity(phash_dist)
    if ph is None and orb_score is None:
        return None
    if orb_score is None:
        return ph
    if ph is None:
        return orb_score
    # pHash is the more reliable global signal; ORB adds structural confirmation.
    return round(0.65 * ph + 0.35 * orb_score, 2)


def image_to_base64(path: str) -> Optional[str]:
    """Read an image and return base64 (used for AI vision payloads)."""
    import base64

    if not path or not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as fh:
            return base64.b64encode(fh.read()).decode("ascii")
    except Exception:
        return None


def media_type_for(path: str) -> str:
    p = path.lower()
    if p.endswith(".png"):
        return "image/png"
    if p.endswith(".webp"):
        return "image/webp"
    return "image/jpeg"
