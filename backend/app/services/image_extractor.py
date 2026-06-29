"""Step 3 — Visual extraction.

Download the Quickeee reference image to local storage and compute its
perceptual hash. The downloaded file is the *source image* that seeds the
reverse-image search and all visual comparisons downstream.
"""
from __future__ import annotations

import os

from app.core.config import settings
from app.core.logging import get_logger
from app.services.types import ReferenceProductData
from app.utils.images import download_image, perceptual_hash

logger = get_logger(__name__)


class ImageExtractor:
    async def extract(self, ref: ReferenceProductData) -> ReferenceProductData:
        if not ref.image_url:
            logger.warning("Reference product has no image_url; visual search degraded")
            return ref
        path = await download_image(ref.image_url, filename_hint="ref_")
        if path and os.path.exists(path):
            ref.image_path = path
            ref.image_phash = perceptual_hash(path)
            logger.info("Source image stored at %s (phash=%s)", path, ref.image_phash)
        else:
            logger.warning("Could not download reference image %s", ref.image_url)
        return ref


image_extractor = ImageExtractor()
