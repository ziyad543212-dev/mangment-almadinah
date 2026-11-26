"""Deterministic, non-generative document restoration. Coordinates stay aligned.

The colour image is retained alongside contrast/binary alternatives: a filter
that removes Arabic dots must never be the only image the recognizer sees.
"""
import math

import cv2
import numpy as np


def quality_metrics(image: np.ndarray) -> dict:
    height, width = image.shape[:2]
    scale = min(1.0, 1000 / max(height, width))
    preview = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(preview, cv2.COLOR_BGR2GRAY)
    p10, p90 = np.percentile(gray, [10, 90])
    return {
        "width": width,
        "height": height,
        "sharpness": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 2),
        "contrast": round(float(p90 - p10), 2),
        "brightness": round(float(gray.mean()), 2),
        "clippedHighlights": round(float(np.mean(gray >= 250)), 4),
        "lowResolution": width < 900 or height < 500,
    }


def rotate_document(image: np.ndarray, angle: int) -> np.ndarray:
    """Paddle's document angle is clockwise; correct it counter-clockwise."""
    codes = {90: cv2.ROTATE_90_COUNTERCLOCKWISE, 180: cv2.ROTATE_180,
             270: cv2.ROTATE_90_CLOCKWISE}
    return cv2.rotate(image, codes[angle]) if angle in codes else image


def deskew(image: np.ndarray) -> tuple[np.ndarray, float]:
    """Only correct a small skew supported by several long text-like edges."""
    height, width = image.shape[:2]
    scale = min(1.0, 1400 / max(height, width))
    preview = cv2.resize(image, None, fx=scale, fy=scale) if scale < 1 else image
    gray = cv2.cvtColor(preview, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 180)
    segments = cv2.HoughLinesP(edges, 1, np.pi / 1800, 60,
                              minLineLength=max(60, preview.shape[1] // 9),
                              maxLineGap=15)
    angles = []
    if segments is not None:
        for x1, y1, x2, y2 in segments[:, 0]:
            angle = math.degrees(math.atan2(int(y2 - y1), int(x2 - x1)))
            if abs(angle) <= 12:
                angles.append(angle)
    if len(angles) < 5:
        return image, 0.0
    angle = float(np.median(angles))
    if abs(angle) < 0.45 or np.median(np.abs(np.array(angles) - angle)) > 1.5:
        return image, 0.0
    transform = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1)
    cosine, sine = abs(transform[0, 0]), abs(transform[0, 1])
    new_width = math.ceil(height * sine + width * cosine)
    new_height = math.ceil(height * cosine + width * sine)
    transform[0, 2] += (new_width - width) / 2
    transform[1, 2] += (new_height - height) / 2
    return cv2.warpAffine(image, transform, (new_width, new_height),
                          flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255)), round(angle, 2)


def enhance_contrast(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Estimate illumination at reduced resolution, then remove broad shadows.
    small = cv2.resize(gray, (max(32, gray.shape[1] // 6), max(32, gray.shape[0] // 6)))
    background = cv2.GaussianBlur(small, (0, 0), 15)
    background = cv2.resize(background, (gray.shape[1], gray.shape[0]))
    flattened = cv2.divide(gray, np.maximum(background, 1), scale=220)
    enhanced = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8)).apply(flattened)
    # A light unsharp mask preserves Arabic diacritics and avoids invented detail.
    blurred = cv2.GaussianBlur(enhanced, (0, 0), 0.8)
    enhanced = cv2.addWeighted(enhanced, 1.35, blurred, -0.35, 0)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def binary_variant(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    threshold = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      cv2.THRESH_BINARY, 41, 13)
    return cv2.cvtColor(threshold, cv2.COLOR_GRAY2BGR)


def needs_retry(lines: list[dict], quality: dict) -> bool:
    useful = [line for line in lines if len(line.get("text", "").strip()) >= 2]
    scores = [line["confidence"] for line in useful if line.get("confidence") is not None]
    return (len(useful) < 12 or not scores or float(np.mean(scores)) < 0.88 or
            quality["contrast"] < 65 or quality["brightness"] < 80 or
            quality["sharpness"] < 55 or quality["lowResolution"])
