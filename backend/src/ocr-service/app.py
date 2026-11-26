import base64
import ctypes
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

import cv2
import numpy as np
import paddle
from fastapi import FastAPI, File, HTTPException, UploadFile
from paddleocr import PaddleOCR, DocImgOrientationClassification, TextRecognition

from image_pipeline import (binary_variant, deskew, enhance_contrast, needs_retry,
                            quality_metrics, rotate_document)


SERVICE_DIR = Path(__file__).resolve().parent
MODEL_DIR = SERVICE_DIR / "models"
ARABIC_RECOGNITION_MODEL_DIR = MODEL_DIR / "arabic_PP-OCRv5_mobile_rec"
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
OCR_LOCK = threading.Lock()
INFERENCE_LOCK = threading.Lock()
logger = logging.getLogger("local_paddle_ocr")
ocr_engine: PaddleOCR | None = None
orientation_engine = None
english_engine = None
arabic_line_engine = None
CPU_THREADS = max(1, min(8, int(os.getenv("PADDLE_OCR_CPU_THREADS", "4"))))
MAX_PASSES = max(1, min(3, int(os.getenv("PADDLE_OCR_MAX_PASSES", "2"))))
OCR_BUDGET_SECONDS = max(5, min(120, float(os.getenv("PADDLE_OCR_BUDGET_SECONDS", "45"))))


def _detector_name() -> str:
    # Mobile leaves room for the app and three independent OCR workers on 8 GB
    # machines. Server detection is opt-in for a machine with more free memory.
    preferred = os.getenv("PADDLE_OCR_DETECTOR", "PP-OCRv5_mobile_det")
    if preferred not in ("PP-OCRv5_server_det", "PP-OCRv5_mobile_det"):
        raise RuntimeError("Unsupported PADDLE_OCR_DETECTOR")
    return preferred if (MODEL_DIR / preferred).is_dir() else "PP-OCRv5_mobile_det"


def _model_root(model_path: Path) -> Path:
    required_weights = {"inference.pdiparams"}
    required_config = {"inference.json", "inference.yml", "inference.pdmodel"}
    for candidate in (model_path, *model_path.rglob("*")):
        if not candidate.is_dir():
            continue
        files = {item.name for item in candidate.iterdir() if item.is_file()}
        if required_weights.issubset(files) and files.intersection(required_config):
            return candidate
    raise RuntimeError(
        f"Model files are missing in {model_path}. Run install-ocr.ps1 to download "
        "the pinned Arabic and text-detection models."
    )


def _paddle_model_path(model_path: Path) -> str:
    path = str(model_path)
    if os.name != "nt" or path.isascii():
        return path

    get_short_path_name = ctypes.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
    get_short_path_name.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint)
    get_short_path_name.restype = ctypes.c_uint
    buffer = ctypes.create_unicode_buffer(32768)
    length = get_short_path_name(path, buffer, len(buffer))
    if not length or length >= len(buffer) or not buffer.value.isascii():
        raise RuntimeError(
            "Windows could not resolve an ASCII-compatible path for the PaddleOCR models. "
            "Enable 8.3 short paths or place the model directory under an ASCII-only path."
        )
    return buffer.value


def _get_ocr_engine() -> PaddleOCR:
    global ocr_engine, orientation_engine, english_engine, arabic_line_engine
    if ocr_engine is None:
        with OCR_LOCK:
            if ocr_engine is None:
                configured_device = os.getenv("PADDLE_OCR_DEVICE", "cpu").strip().lower()
                if configured_device.startswith("gpu") and not paddle.is_compiled_with_cuda():
                    raise RuntimeError(
                        "PADDLE_OCR_DEVICE requests GPU, but this virtual environment "
                        "uses a CPU-only PaddlePaddle build."
                    )
                if configured_device.startswith("gpu"):
                    if paddle.device.cuda.device_count() < 1:
                        raise RuntimeError(
                            "PADDLE_OCR_DEVICE requests GPU, but no compatible CUDA GPU "
                            "is available to PaddlePaddle."
                        )
                    device = configured_device if ":" in configured_device else "gpu:0"
                elif configured_device in ("", "cpu"):
                    device = "cpu"
                else:
                    raise RuntimeError(
                        "PADDLE_OCR_DEVICE must be 'cpu' or a compatible GPU such as 'gpu:0'."
                    )
                logger.info("Loading local PaddleOCR models on %s", device)
                detector = _detector_name()
                ocr_engine = PaddleOCR(
                    text_detection_model_name=detector,
                    text_detection_model_dir=_paddle_model_path(_model_root(MODEL_DIR / detector)),
                    text_recognition_model_name="arabic_PP-OCRv5_mobile_rec",
                    text_recognition_model_dir=_paddle_model_path(_model_root(ARABIC_RECOGNITION_MODEL_DIR)),
                    use_doc_orientation_classify=False,
                    use_doc_unwarping=False,
                    use_textline_orientation=False,
                    device=device,
                    enable_mkldnn=False,
                    cpu_threads=CPU_THREADS,
                    text_det_limit_side_len=1600,
                    text_det_limit_type="max",
                    text_det_box_thresh=0.45,
                    text_rec_score_thresh=0.25,
                )
                common = {"device": device, "enable_mkldnn": False, "cpu_threads": CPU_THREADS}
                arabic_line_engine = TextRecognition(model_name="arabic_PP-OCRv5_mobile_rec",
                    model_dir=_paddle_model_path(_model_root(ARABIC_RECOGNITION_MODEL_DIR)), **common)
                for name, model_class in (("PP-LCNet_x1_0_doc_ori", DocImgOrientationClassification),
                                          ("en_PP-OCRv5_mobile_rec", TextRecognition)):
                    if not (MODEL_DIR / name).is_dir():
                        logger.warning("Optional model %s missing; run install-ocr.ps1", name)
                        continue
                    model = model_class(model_name=name,
                                        model_dir=_paddle_model_path(_model_root(MODEL_DIR / name)),
                                        **common)
                    if name.endswith("doc_ori"):
                        orientation_engine = model
                    else:
                        english_engine = model
                logger.info("Local Arabic/English PaddleOCR models are ready")
    return ocr_engine


def _to_list(value: Any) -> list:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        return value.tolist()
    return list(value)


def _normalize_bounds(box: Any, image_width: int, image_height: int) -> dict | None:
    coordinates = _to_list(box)
    if len(coordinates) == 4 and all(np.isscalar(item) for item in coordinates):
        x_values = [float(coordinates[0]), float(coordinates[2])]
        y_values = [float(coordinates[1]), float(coordinates[3])]
    elif coordinates and isinstance(coordinates[0], (list, tuple)):
        points = coordinates
        x_values = [float(point[0]) for point in points if len(point) >= 2]
        y_values = [float(point[1]) for point in points if len(point) >= 2]
    else:
        return None

    if not x_values or not y_values:
        return None
    left = max(0.0, min(x_values) / image_width)
    top = max(0.0, min(y_values) / image_height)
    right = min(1.0, max(x_values) / image_width)
    bottom = min(1.0, max(y_values) / image_height)
    if right <= left or bottom <= top:
        return None
    return {
        "left": left,
        "top": top,
        "width": right - left,
        "height": bottom - top,
    }


def _result_payload(result: Any) -> dict:
    payload = getattr(result, "json", None)
    if callable(payload):
        payload = payload()
    if not isinstance(payload, dict):
        return {}
    nested = payload.get("res")
    return nested if isinstance(nested, dict) else payload


def _predict_lines(image: np.ndarray, pass_id: str) -> list[dict]:
    height, width = image.shape[:2]
    lines = []
    # Consume results while INFERENCE_LOCK is held, including lazy predictors.
    for result in _get_ocr_engine().predict(image):
        payload = _result_payload(result)
        texts = _to_list(payload.get("rec_texts"))
        scores = _to_list(payload.get("rec_scores"))
        boxes = _to_list(payload.get("rec_boxes")) or _to_list(payload.get("rec_polys"))
        for index, text in enumerate(texts):
            text = str(text or "").strip()
            if not text:
                continue
            score = float(scores[index]) if index < len(scores) else None
            lines.append({"text": text, "confidence": score, "pageNumber": 1,
                          "bounds": _normalize_bounds(boxes[index], width, height)
                          if index < len(boxes) else None,
                          "passId": pass_id, "words": []})
    return lines


def _english_lines(image: np.ndarray, lines: list[dict]) -> list[dict]:
    if english_engine is None:
        return []
    height, width = image.shape[:2]
    crops, originals = [], []
    for line in lines:
        text = line["text"]
        # Never turn an Arabic name into a plausible Latin hallucination.
        mrz_candidate = len(text) >= 30 and text.count('<') >= 4
        arabic_region = any("\u0600" <= c <= "\u06ff" for c in text)
        if not line.get("bounds"):
            continue
        if not arabic_region and sum(c.isascii() and c.isalnum() for c in text) < 2:
            continue
        b = line["bounds"]
        x0, y0 = max(0, int(b["left"] * width) - 3), max(0, int(b["top"] * height) - 3)
        x1 = min(width, int((b["left"] + b["width"]) * width) + 4)
        y1 = min(height, int((b["top"] + b["height"]) * height) + 4)
        if x1 > x0 and y1 > y0:
            crops.append(image[y0:y1, x0:x1])
            originals.append(line)
    output = []
    if crops:
        for original, result in zip(originals, english_engine.predict(crops, batch_size=8)):
            payload = _result_payload(result)
            text = str(payload.get("rec_text", "")).strip()
            score = float(payload.get("rec_score", 0))
            original_arabic = any("\u0600" <= c <= "\u06ff" for c in original["text"])
            # A mixed bilingual title can recover an English field anchor. An
            # Arabic name may never become a new Latin value through this path.
            label = any(word in text.upper().replace('/', ' ').replace(':', ' ').split()
                        for word in ("PASSPORT", "NAME", "SURNAME", "FATHER", "FIRST", "GIVEN",
                                     "DATE", "PLACE", "SEX", "TYPE", "COUNTRY", "ISSUING", "NATIONALITY"))
            original_mrz = len(original["text"]) >= 30 and original["text"].count('<') >= 4
            if text and score >= 0.5 and (not original_arabic or label or original_mrz):
                output.append({**original, "text": text, "confidence": score,
                               "passId": "english", "model": "en_PP-OCRv5_mobile_rec"})
    return output


def _refine_arabic_lines(image: np.ndarray, lines: list[dict]) -> list[dict]:
    """Reread uncertain Arabic at line scale, without redetecting the full page."""
    height, width = image.shape[:2]
    crops, indices = [], []
    for index, line in enumerate(lines):
        if not line.get("bounds") or (line.get("confidence") or 0) >= 0.96:
            continue
        if not any("\u0621" <= c <= "\u064a" for c in line["text"]):
            continue
        b = line["bounds"]
        x0, y0 = max(0, int(b["left"] * width) - 6), max(0, int(b["top"] * height) - 3)
        x1, y1 = min(width, int((b["left"] + b["width"]) * width) + 7), min(height, int((b["top"] + b["height"]) * height) + 4)
        if x1 <= x0 or y1 <= y0:
            continue
        crop = image[y0:y1, x0:x1]
        crop = cv2.resize(crop, (min(2048, max(1, round(crop.shape[1] * 96 / crop.shape[0]))), 96), interpolation=cv2.INTER_CUBIC)
        crops.append(enhance_contrast(crop))
        indices.append(index)
        if len(crops) == 24:
            break
    if not crops or arabic_line_engine is None:
        return []
    refined = [{**line, "passId": "arabic-crops"} for line in lines]
    changed = False
    for index, result in zip(indices, arabic_line_engine.predict(crops, batch_size=4)):
        payload = _result_payload(result)
        text, score = str(payload.get("rec_text", "")).strip(), float(payload.get("rec_score", 0))
        if text and score >= 0.45:
            refined[index] = {**refined[index], "text": text, "confidence": score}
            changed = True
    return refined if changed else []


def _recognize(image_bytes: bytes, *, is_crop: bool = False) -> dict:
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty")
    if len(image_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 15 MB limit")

    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Uploaded file is not a valid image")
    image_height, image_width = image.shape[:2]
    if image_width < 2 or image_height < 2 or image_width * image_height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=400, detail="Image dimensions are invalid or too large")

    try:
        with INFERENCE_LOCK:
            _get_ocr_engine()
            started = time.monotonic()
            angle, angle_score = 0, None
            if not is_crop and orientation_engine is not None:
                result = _result_payload(orientation_engine.predict(image)[0])
                labels, scores = _to_list(result.get("label_names")), _to_list(result.get("scores"))
                if labels and scores:
                    angle_score = float(scores[0])
                    if angle_score >= 0.8 and str(labels[0]) in ("0", "90", "180", "270"):
                        angle = int(labels[0])
                        image = rotate_document(image, angle)
            image, skew = deskew(image) if not is_crop else (image, 0.0)
            quality = quality_metrics(image)
            lines = _predict_lines(image, "original")
            passes = ["original"]
            if MAX_PASSES > 1 and needs_retry(lines, quality) and time.monotonic() - started < OCR_BUDGET_SECONDS:
                lines.extend(_predict_lines(enhance_contrast(image), "contrast"))
                passes.append("contrast")
            if MAX_PASSES > 2 and needs_retry(lines, quality) and time.monotonic() - started < OCR_BUDGET_SECONDS:
                lines.extend(_predict_lines(binary_variant(image), "adaptive"))
                passes.append("adaptive")
            if MAX_PASSES > 1 and time.monotonic() - started < OCR_BUDGET_SECONDS:
                refined = _refine_arabic_lines(image, [line for line in lines if line["passId"] == "original"])
                if refined:
                    lines.extend(refined)
                    passes.append("arabic-crops")
            if time.monotonic() - started < OCR_BUDGET_SECONDS:
                lines.extend(_english_lines(image, [line for line in lines if line["passId"] == "original"]))
            diagnostics = {"quality": quality, "rotation": angle, "orientationConfidence": angle_score,
                           "deskewDegrees": skew, "passes": passes, "detector": _detector_name(),
                           "elapsedMs": round((time.monotonic() - started) * 1000),
                           "budgetExhausted": time.monotonic() - started >= OCR_BUDGET_SECONDS}
            response = {"lines": lines, "diagnostics": diagnostics}
            if not is_crop:
                ok, encoded_image = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 95])
                if ok:
                    response["processed_image"] = base64.b64encode(encoded_image).decode("ascii")
            return response
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("PaddleOCR inference failed")
        raise HTTPException(status_code=503, detail="Local OCR inference failed") from error


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _get_ocr_engine()
    yield


app = FastAPI(
    title="Local PaddleOCR service",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict:
    return {"ok": ocr_engine is not None, "engine": "paddleocr",
            "device": os.getenv("PADDLE_OCR_DEVICE", "cpu"), "detector": _detector_name(),
            "orientation": orientation_engine is not None, "english": english_engine is not None,
            "maxPasses": MAX_PASSES, "cpuThreads": CPU_THREADS}


@app.post("/ocr")
def read_passport(
    image: UploadFile | None = File(default=None),
    crop: UploadFile | None = File(default=None),
) -> dict:
    if image is None and crop is None:
        raise HTTPException(status_code=400, detail="Upload an image or a crop")
    # Bound reads before decode; never read an arbitrarily large multipart file.
    result = _recognize(image.file.read(MAX_UPLOAD_BYTES + 1)) if image is not None else {"lines": []}
    crop_result = _recognize(crop.file.read(MAX_UPLOAD_BYTES + 1), is_crop=True) if crop is not None else {"lines": []}
    return {**result, "crop_lines": crop_result["lines"]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
