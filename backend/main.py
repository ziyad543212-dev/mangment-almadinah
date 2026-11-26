"""Standalone FastAPI passport OCR service with multi-layer Arabic & Father Name extraction.

Run from the backend directory with:
    python -m uvicorn main:app --host 0.0.0.0 --port 8000
"""

import logging
import os
import re
import threading
from datetime import datetime
from typing import Any

import cv2
import easyocr
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("passport_ocr")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

MAX_UPLOAD_BYTES = int(os.getenv("OCR_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("OCR_MAX_IMAGE_PIXELS", "40000000"))
READER_LOCK = threading.Lock()
READER: easyocr.Reader | None = None

app = FastAPI(title="Passport OCR", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# الكلمات المفتاحية بالعربية والإنجليزية لضمان التقاط العناوين حتى لو فشل قراءة أحدهما
FIELD_LABELS = {
    "first_name_ar": (
        "الاسم", "الإسم", "الاسم الأول", "الاسم الاول", "الاسم الشخصي", "إسم",
        "given name", "given names", "first name", "name"
    ),
    "father_name_ar": (
        "اسم الأب", "اسم الاب", "إسم الأب", "إسم الاب", "اسم الوالد", "الأب", "الاب", "بن",
        "father name", "father's name", "fathers name", "father"
    ),
    "last_name_ar": (
        "الشهرة", "الشهره", "الكنية", "الكنيه", "النسبة", "النسبه", "العائلة", "العائله", "اللقب",
        "surname", "last name", "family name"
    ),
}

# كلمات يجب استبعادها لأنها نصوص ثابتة في الجواز وليست أسماء أشخاص
STOPWORDS_AR = {
    "الجمهورية", "الجمهوريه", "العربية", "العربيه", "السورية", "السوريه", "جواز", "سفر",
    "نوع", "رمز", "البلد", "رقم", "الجواز", "الوطني", "تاريخ", "الميلاد", "الولادة", "الولاده",
    "محل", "مكان", "الإصدار", "الاصدار", "المنح", "الانتهاء", "الصلاحية", "الجنس", "الجنسية",
    "الجنسيه", "ذكر", "انثى", "أنثى", "توقيع", "صاحب", "حامل", "السلطة", "السلطه", "المختصة",
    "الاسم", "الإسم", "اسم", "إسم", "الأب", "الاب", "الوالد", "الشهرة", "الشهره", "الكنية",
    "الكنيه", "النسبة", "النسبه", "العائلة", "العائله", "اللقب", "الشخصي", "الأول", "الاول",
    "عربي", "سوري", "سورية", "دمشق", "ريف", "حلب", "حمص", "حماة", "اللاذقية", "طرطوس", "درعا",
    "دير", "الزور", "الحسكة", "الرقة", "إدلب", "ادلب", "السويداء", "القنيطرة", "دوما"
}

# قاموس شامل للأسماء العربية الشائعة للتعويض والمطابقة الذكية
COMMON_NAMES_EN_TO_AR = {
    "MOHAMMAD": "محمد", "MUHAMMAD": "محمد", "MOHAMED": "محمد", "MUHAMED": "محمد", "MOHAMAD": "محمد",
    "AHMAD": "أحمد", "AHMED": "أحمد", "ALI": "علي", "OMAR": "عمر", "UMAR": "عمر",
    "KHALED": "خالد", "KHALID": "خالد", "ZIAD": "زياد", "ZEYAD": "زياد", "ZIYAD": "زياد",
    "YOUSEF": "يوسف", "YOUSSEF": "يوسف", "YUSUF": "يوسف", "YOUSEF": "يوسف",
    "IBRAHIM": "إبراهيم", "EBRAHIM": "إبراهيم", "MAHMOUD": "محمود", "MAHMUD": "محمود",
    "HASSAN": "حسن", "HASAN": "حسن", "HUSSEIN": "حسين", "HUSAIN": "حسين", "HOSSAM": "حسام",
    "ABDULLAH": "عبدالله", "ABDALLAH": "عبدالله", "ABDULLA": "عبدالله",
    "ABDULRAHMAN": "عبدالرحمن", "ABDELRAHMAN": "عبدالرحمن", "ABD AL RAHMAN": "عبدالرحمن",
    "ABDULAZIZ": "عبدالعزيز", "ABDULKARIM": "عبدالكريم", "ABDULKADER": "عبدالقادر", "ABDULQADER": "عبدالقادر",
    "TARIQ": "طارق", "TAREK": "طارق", "TAREQ": "طارق", "BILAL": "بلال", "BELAL": "بلال",
    "AMMAR": "عمار", "YASSER": "ياسر", "YASER": "ياسر", "SAMER": "سامر", "SAMIR": "سمير",
    "RAMI": "رامي", "RAMY": "رامي", "FADI": "فادي", "FADY": "فادي", "SHADI": "شادي",
    "MAZEN": "مازن", "MAZIN": "مازن", "BASSAM": "بسام", "BASEM": "باسم", "BASSEM": "باسم",
    "GHASSAN": "غسان", "WALID": "وليد", "WALEED": "وليد", "SAID": "سعيد", "SAEED": "سعيد",
    "NABIL": "نبيل", "NABEEL": "نبيل", "ADEL": "عادل", "KAMAL": "كمال", "JAMAL": "جمال",
    "ALAA": "علاء", "ALA": "علاء", "ANAS": "أنس", "OSAMA": "أسامة", "OUSSAMA": "أسامة",
    "HAMZA": "حمزة", "HAMZEH": "حمزة", "ZAID": "زيد", "ZAYD": "زيد", "MUSTAFA": "مصطفى",
    "MOSTAFA": "مصطفى", "SULEIMAN": "سليمان", "SOLIMAN": "سليمان", "SALIM": "سليم", "SALEEM": "سليم",
    "SALAH": "صلاح", "SALEH": "صالح", "SALIH": "صالح", " Adnan": "عدنان", "ADNAN": "عدنان",
    "MARWAN": "مروان", "SAFaa": "صفاء", "RIYAD": "رياض", "RIAD": "رياض", "FOUAD": "فؤاد",
    "FUAD": "فؤاد", "IMAD": "عماد", "EMAD": "عماد", "ZIYAD": "زياد", "EYAD": "إياد", "IYAD": "إياد",
    "ISSAM": "عصام", "ESSAM": "عصام", "MUNIR": "منير", "MOUNIR": "منير", " BASHAR": "بشار",
    "BASHAR": "بشار", "MAHER": "ماهر", "AMER": "عامر", "AAMER": "عامر", "TAMER": "تامر",
    "NASSER": "ناصر", "NASER": "ناصر", "MANSOUR": "منصور", "FAISAL": "فيصل", "FAYSAL": "فيصل",
    "MAJED": "ماجد", "MAJID": "ماجد", "ZAKARIA": "زكريا", "YAHYA": "يحيى", "YAHIA": "يحيى",
    "FATIMA": "فاطمة", "FATMA": "فاطمة", "FATIMEH": "فاطمة", "AISHA": "عائشة", "AYSHA": "عائشة",
    "MARYAM": "مريم", "MARIAM": "مريم", "ZAINAB": "زينب", "ZEINAB": "زينب", "KHADIJA": "خديجة",
    "NOUR": "نور", "NOOR": "نور", "SARA": "سارة", "SARAH": "سارة", "REEM": "ريم", "RIMA": "ريما",
    "RANA": "رنا", "DIMA": "ديما", "DEEMA": "ديما", "LINA": "لينا", "LEENA": "لينا",
    "MONA": "منى", "MOUNA": "منى", "HUDA": "هدى", "HOUDA": "هدى", "SALMA": "سلمى",
    "AYA": "آية", "AYAH": "آية", "HIBA": "هبة", "HEBA": "هبة", "ROAA": "رؤى", "ROUA": "رؤى",
    "RAGHAD": "رغد", "SHAM": "شام", "FARAH": "فرح", "MARWA": "مروة", "SAFAA": "صفاء",
    "WAFA": "وفاء", "WAFAA": "وفاء", "HANAN": "حنان", "IMAN": "إيمان", "EMAN": "إيمان",
    "AMAL": "أمل", "SAMIRA": "سميرة", "LAILA": "ليلى", "LAYLA": "ليلى", "SOUAD": "سعاد",
    "SUAD": "سعاد", "NADIA": "نادية", "NADA": "ندى", "GHADA": "غادة", "HALA": "هلا",
    "SANA": "سناء", "SANAA": "سناء", "MAYA": "مايا", "YARA": "يارا", "DANA": "دانا"
}

ARABIC_PATTERN = re.compile(r"[\u0600-\u06FF]+")
MRZ_LINE_2_PATTERN = re.compile(r"^[A-Z0-9<]{9}[0-9<][A-Z<]{3}\d{6}[0-9<][MF<]\d{6}")


def get_reader() -> easyocr.Reader:
    global READER
    with READER_LOCK:
        if READER is None:
            use_gpu = os.getenv("EASYOCR_GPU", "false").strip().lower() in {"1", "true", "yes"}
            READER = easyocr.Reader(["ar", "en"], gpu=use_gpu)
    return READER


def normalize_arabic(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[\u064B-\u065F\u0670\u0640]", "", text)
    text = (
        text.replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ٱ", "ا")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
        .replace("ى", "ي")
        .replace("ة", "ه")
    )
    return re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE).strip().lower()


LABEL_WORDS = {
    token
    for labels in FIELD_LABELS.values()
    for label in labels
    for token in normalize_arabic(label).split()
    if ARABIC_PATTERN.fullmatch(token)
} | {normalize_arabic(w) for w in STOPWORDS_AR}


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("The uploaded file is not a supported image.")

    height, width = image.shape[:2]
    if height * width > MAX_IMAGE_PIXELS:
        raise ValueError("The image dimensions exceed the configured pixel limit.")

    # الحفاظ على دقة عالية ومناسبة لقراءة نقاط الحروف العربية دون طمسها
    if width > 2200:
        target_height = max(1, round(height * 2200 / width))
        image = cv2.resize(image, (2200, target_height), interpolation=cv2.INTER_AREA)
    elif width < 1000:
        target_height = max(1, round(height * 1400 / width))
        image = cv2.resize(image, (1400, target_height), interpolation=cv2.INTER_CUBIC)

    # تحسين التباين بهدوء دون مسح نقاط الحروف العربية
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l_channel)
    merged = cv2.merge((cl, a_channel, b_channel))
    enhanced_bgr = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
    return enhanced_bgr


def box_bounds(box: list[list[float]]) -> tuple[float, float, float, float]:
    xs = [point[0] for point in box]
    ys = [point[1] for point in box]
    return min(xs), min(ys), max(xs), max(ys)


def clean_arabic_name_tokens(text: str) -> str:
    words = ARABIC_PATTERN.findall(text)
    valid_words = []
    for w in words:
        norm = normalize_arabic(w)
        if norm not in LABEL_WORDS and len(norm) > 1:
            valid_words.append(w)
    return " ".join(valid_words).strip()


def transliterate_en_to_ar(en_name: str | None) -> str | None:
    if not en_name:
        return None
    clean_up = en_name.upper().strip()
    if clean_up in COMMON_NAMES_EN_TO_AR:
        return COMMON_NAMES_EN_TO_AR[clean_up]

    # إذا كان الاسم مركباً من كلمتين (مثل AL AJWA أو ABD AL RAHMAN)
    tokens = clean_up.split()
    if len(tokens) > 1:
        if tokens[0] in {"AL", "EL"} and len(tokens) == 2:
            second = COMMON_NAMES_EN_TO_AR.get(tokens[1]) or transliterate_en_to_ar(tokens[1])
            return f"ال{second}" if second else None
        translated_parts = [transliterate_en_to_ar(t) for t in tokens]
        return " ".join(p for p in translated_parts if p)

    prefix = ""
    if clean_up.startswith(("AL", "EL")) and len(clean_up) > 4:
        prefix = "ال"
        clean_up = clean_up[2:]
        if clean_up in COMMON_NAMES_EN_TO_AR:
            return prefix + COMMON_NAMES_EN_TO_AR[clean_up]

    phonetic_map = [
        ("SH", "ش"), ("KH", "خ"), ("GH", "غ"), ("TH", "ث"), ("DH", "ذ"),
        ("CH", "تش"), ("PH", "ف"), ("AA", "ا"), ("EE", "ي"), ("OO", "و"),
        ("OU", "و"), ("AY", "ي"), ("AI", "ي"), ("EI", "ي"),
        ("A", "ا"), ("B", "ب"), ("C", "ك"), ("D", "د"), ("E", "ي"),
        ("F", "ف"), ("G", "ج"), ("H", "ه"), ("I", "ي"), ("J", "ج"),
        ("K", "ك"), ("L", "ل"), ("M", "م"), ("N", "ن"), ("O", "و"),
        ("P", "ب"), ("Q", "ق"), ("R", "ر"), ("S", "س"), ("T", "ت"),
        ("U", "و"), ("V", "ف"), ("W", "و"), ("X", "كس"), ("Y", "ي"), ("Z", "ز")
    ]
    res = clean_up
    for en_sub, ar_sub in phonetic_map:
        res = res.replace(en_sub, ar_sub)
    # إزالة الحروف المكررة المتتالية الناتجة عن الحروف الصوتية
    res = re.sub(r"(.)\1+", r"\1", res)
    return prefix + res


def phonetic_skeleton_ar(ar_text: str) -> str:
    norm = normalize_arabic(ar_text).replace("ال", "")
    mapping = {
        "ا": "a", "ب": "b", "ت": "t", "ث": "t", "ج": "j", "ح": "h", "خ": "k",
        "د": "d", "ذ": "d", "ر": "r", "ز": "z", "س": "s", "ش": "s", "ص": "s",
        "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "g", "ف": "f", "ق": "k",
        "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y"
    }
    skel = "".join(mapping.get(ch, "") for ch in norm)
    return re.sub(r"(.)\1+", r"\1", skel)


def phonetic_skeleton_en(en_text: str) -> str:
    clean = re.sub(r"^(AL|EL)\s*", "", en_text.upper().strip())
    for pair, rep in [("SH", "s"), ("KH", "k"), ("GH", "g"), ("TH", "t"), ("DH", "d"), ("PH", "f")]:
        clean = clean.replace(pair, rep)
    mapping = {
        "A": "a", "B": "b", "C": "k", "D": "d", "E": "y", "F": "f", "G": "j",
        "H": "h", "I": "y", "J": "j", "K": "k", "L": "l", "M": "m", "N": "n",
        "O": "w", "P": "b", "Q": "k", "R": "r", "S": "s", "T": "t", "U": "w",
        "V": "f", "W": "w", "X": "ks", "Y": "y", "Z": "z"
    }
    skel = "".join(mapping.get(ch, "") for ch in clean)
    return re.sub(r"(.)\1+", r"\1", skel)


def similarity_ar_en(ar_candidate: str, en_target: str | None) -> float:
    if not ar_candidate or not en_target:
        return 0.0
    expected_ar = transliterate_en_to_ar(en_target)
    if expected_ar and normalize_arabic(ar_candidate) == normalize_arabic(expected_ar):
        return 1.0
    s_ar = phonetic_skeleton_ar(ar_candidate)
    s_en = phonetic_skeleton_en(en_target)
    if not s_ar or not s_en:
        return 0.0
    matches = sum(1 for c in s_ar if c in s_en)
    score = matches / max(len(s_ar), len(s_en))
    if s_ar[0] == s_en[0]:
        score += 0.25
    return min(1.0, score)


def match_field_label(text: str) -> str | None:
    norm = f" {normalize_arabic(text)} "
    # نتحقق من اسم الأب أولاً حتى لا يلتبس مع كلمة "الاسم"
    for label in FIELD_LABELS["father_name_ar"]:
        if f" {normalize_arabic(label)} " in norm:
            return "father_name_ar"
    for label in FIELD_LABELS["last_name_ar"]:
        if f" {normalize_arabic(label)} " in norm:
            return "last_name_ar"
    for label in FIELD_LABELS["first_name_ar"]:
        if f" {normalize_arabic(label)} " in norm:
            return "first_name_ar"
    return None


def extract_visual_fields(
    detections: list[tuple[list[list[float]], str, float]],
    mrz_data: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {
        "first_name_ar": {"value": None, "confidence": None},
        "father_name_ar": {"value": None, "confidence": None},
        "last_name_ar": {"value": None, "confidence": None},
    }

    # جمع كل الصناديق التي تحتوي على أسماء عربية مرشحة
    arabic_candidates: list[tuple[list[list[float]], str, float]] = []
    for box, text, conf in detections:
        cleaned = clean_arabic_name_tokens(text)
        if cleaned and 1 <= len(cleaned.split()) <= 3:
            arabic_candidates.append((box, cleaned, conf))

    # -------------------------------------------------------------------------
    # الطبقة 1: البحث الهندسي بناءً على عناوين الحقول (عربي أو إنجليزي)
    # -------------------------------------------------------------------------
    for box, text, conf in detections:
        matched_field = match_field_label(text)
        if not matched_field or fields[matched_field]["value"]:
            continue

        # هل القيمة مكتوبة داخل نفس صندوق العنوان؟ (مثل: "اسم الأب: خالد")
        inline_val = clean_arabic_name_tokens(text)
        if inline_val:
            fields[matched_field] = {"value": inline_val, "confidence": round(float(conf), 4)}
            continue

        lx1, ly1, lx2, ly2 = box_bounds(box)
        label_h = max(12.0, ly2 - ly1)
        label_cy = (ly1 + ly2) / 2.0

        best_candidates: list[tuple[float, str, float]] = []
        for c_box, c_val, c_conf in arabic_candidates:
            if c_box is box:
                continue
            cx1, cy1, cx2, cy2 = box_bounds(c_box)
            c_cy = (cy1 + cy2) / 2.0

            v_diff = abs(c_cy - label_cy)
            h_gap = min(abs(cx2 - lx1), abs(cx1 - lx2))

            same_row = v_diff <= label_h * 1.4 and h_gap <= label_h * 18
            below_row = (0 <= cy1 - ly1 <= label_h * 3.5) and (abs(cx2 - lx2) <= label_h * 8 or abs(cx1 - lx1) <= label_h * 8)

            if same_row or below_row:
                score = v_diff * 1.2 + h_gap * 0.25
                best_candidates.append((score, c_val, c_conf))

        if best_candidates:
            _, chosen_val, chosen_conf = min(best_candidates, key=lambda x: x[0])
            fields[matched_field] = {"value": chosen_val, "confidence": round(float(chosen_conf), 4)}

    # إذا ظهر في حقل الاسم الأول كلمتان (الاسم + اسم الأب معاً) وكان اسم الأب فارغاً، نقسمهما:
    if fields["first_name_ar"]["value"] and not fields["father_name_ar"]["value"]:
        parts = fields["first_name_ar"]["value"].split()
        if len(parts) >= 2:
            fields["first_name_ar"]["value"] = parts[0]
            fields["father_name_ar"] = {
                "value": " ".join(parts[1:]),
                "confidence": fields["first_name_ar"]["confidence"]
            }

    # -------------------------------------------------------------------------
    # الطبقة 2: المطابقة الصوتية الذكية بين الكلمات العربية في الجواز وأسماء الـ MRZ
    # -------------------------------------------------------------------------
    if mrz_data:
        mapping_targets = [
            ("first_name_ar", mrz_data.get("first_name_en")),
            ("father_name_ar", mrz_data.get("father_name_en")),
            ("last_name_ar", mrz_data.get("last_name_en")),
        ]
        used_values = {fields[k]["value"] for k in fields if fields[k]["value"]}

        for ar_key, en_val in mapping_targets:
            if fields[ar_key]["value"] or not en_val:
                continue
            scored: list[tuple[float, str, float]] = []
            for _, c_val, c_conf in arabic_candidates:
                # فحص الكلمة كاملة أو مفرداتها
                for sub_word in [c_val] + c_val.split():
                    if sub_word in used_values:
                        continue
                    sim = similarity_ar_en(sub_word, en_val)
                    if sim >= 0.55:
                        scored.append((sim, sub_word, c_conf))
            if scored:
                _, best_word, best_conf = max(scored, key=lambda x: x[0])
                fields[ar_key] = {"value": best_word, "confidence": round(float(best_conf), 4)}
                used_values.add(best_word)

    # -------------------------------------------------------------------------
    # الطبقة 3: التعريب الذكي المباشر من الـ MRZ لأي حقل عربي بقي فارغاً
    # -------------------------------------------------------------------------
    if mrz_data:
        if not fields["first_name_ar"]["value"] and mrz_data.get("first_name_en"):
            fields["first_name_ar"] = {
                "value": transliterate_en_to_ar(mrz_data["first_name_en"]),
                "confidence": 0.85,
            }
        if not fields["father_name_ar"]["value"] and mrz_data.get("father_name_en"):
            fields["father_name_ar"] = {
                "value": transliterate_en_to_ar(mrz_data["father_name_en"]),
                "confidence": 0.85,
            }
        if not fields["last_name_ar"]["value"] and mrz_data.get("last_name_en"):
            fields["last_name_ar"] = {
                "value": transliterate_en_to_ar(mrz_data["last_name_en"]),
                "confidence": 0.85,
            }

    return fields


def parse_mrz(raw_text: str) -> dict[str, Any]:
    lines = [
        re.sub(r"[^A-Z0-9<]", "", line.upper())
        for line in raw_text.splitlines()
    ]
    line1 = next((line for line in lines if line.startswith("P") and "<<" in line and len(line) >= 30), "")
    line2 = next((line for line in lines if MRZ_LINE_2_PATTERN.match(line)), "")

    # محاولة إضافية للالتقاط إذا كان هناك خطأ بسيط في بداية السطر الثاني
    if not line2:
        mrz_like = [l for l in lines if len(l) >= 30 and ("<" in l or any(c.isdigit() for c in l))]
        for cand in reversed(mrz_like):
            if cand != line1 and sum(c.isdigit() for c in cand) >= 12:
                line2 = cand
                break

    result: dict[str, Any] = {
        "passport_number": None,
        "nationality": None,
        "date_of_birth": None,
        "passport_expiry_date": None,
        "gender": None,
        "mrz_surname": None,
        "mrz_given_names": None,
        "first_name_en": None,
        "father_name_en": None,
        "middle_names_en": None,
        "last_name_en": None,
    }

    if line2:
        line2 = line2.ljust(44, "<")
        passport_number = line2[0:9].replace("<", "").strip()
        nationality = line2[10:13].replace("<", "").strip()
        result["passport_number"] = passport_number or None
        result["nationality"] = nationality or None
        result["date_of_birth"] = parse_mrz_date(line2[13:19], is_birth=True)
        result["gender"] = line2[20] if line2[20] in {"M", "F"} else None
        result["passport_expiry_date"] = parse_mrz_date(line2[21:27], is_birth=False)

    if line1:
        if not result["nationality"] and len(line1) >= 5:
            nat = line1[2:5].replace("<", "").strip()
            if len(nat) == 3 and nat.isalpha():
                result["nationality"] = nat

        names = line1[5:].split("<<", 1)
        surname = names[0].replace("<", " ").strip()
        given_names = names[1].replace("<", " ").strip() if len(names) > 1 else ""
        given_tokens = given_names.split()
        grouped_names: list[str] = []
        index = 0
        compound_prefixes = {"ABD", "ABDEL", "ABDUL", "ABU", "AL", "EL", "IBN", "BIN", "BEN", "BINT"}
        while index < len(given_tokens):
            token = given_tokens[index]
            if token.upper() in compound_prefixes and index + 1 < len(given_tokens):
                grouped_names.append(f"{token} {given_tokens[index + 1]}")
                index += 2
                continue
            grouped_names.append(token)
            index += 1
        result["mrz_surname"] = surname or None
        result["mrz_given_names"] = given_names or None
        result["last_name_en"] = surname or None
        result["first_name_en"] = grouped_names[0] if grouped_names else None
        result["father_name_en"] = grouped_names[1] if len(grouped_names) > 1 else None
        result["middle_names_en"] = " ".join(grouped_names[2:]) or None

    return result


def parse_mrz_date(value: str, is_birth: bool) -> str | None:
    value = value.replace("O", "0").replace("I", "1").replace("L", "1")
    if not re.fullmatch(r"\d{6}", value):
        return None
    current_year = datetime.now().year
    short_year = int(value[:2])
    if is_birth:
        year = 1900 + short_year if short_year > current_year % 100 else 2000 + short_year
    else:
        year = current_year // 100 * 100 + short_year
        if year < current_year - 20:
            year += 100
    try:
        return datetime.strptime(f"{year}{value[2:]}", "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def run_ocr(image: np.ndarray) -> dict[str, Any]:
    reader = get_reader()
    with READER_LOCK:
        results = reader.readtext(
            image,
            detail=1,
            paragraph=False,
            batch_size=1,
            workers=0,
        )
    detections = [
        (box, str(text).strip(), float(confidence))
        for box, text, confidence in results
        if str(text).strip()
    ]
    raw_text = "\n".join(text for _, text, _ in detections)
    mrz_data = parse_mrz(raw_text)
    visual_fields = extract_visual_fields(detections, mrz_data)

    data = {
        "first_name_ar": visual_fields["first_name_ar"]["value"],
        "father_name_ar": visual_fields["father_name_ar"]["value"],
        "last_name_ar": visual_fields["last_name_ar"]["value"],
        **mrz_data,
    }
    logs = {
        "name_tokens": {
            "first_name_ar": visual_fields["first_name_ar"],
            "father_name_ar": visual_fields["father_name_ar"],
            "last_name_ar": visual_fields["last_name_ar"],
            "mrz_given_names": mrz_data.get("mrz_given_names"),
            "mrz_surname": mrz_data.get("mrz_surname"),
        },
        "detections": [
            {"text": text, "confidence": round(confidence, 4)}
            for _, text, confidence in detections
        ],
    }
    return {"success": True, "data": data, "raw_text": raw_text, "logs": logs}


@app.post("/api/ocr/passport")
@app.post("/ocr")
async def ocr_passport(
    image: UploadFile | None = File(default=None),
    file: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    upload = image or file
    if upload is None:
        raise HTTPException(status_code=400, detail="Upload an image using the 'image' or 'file' field.")
    try:
        if upload.content_type and not upload.content_type.startswith("image/"):
            raise HTTPException(status_code=415, detail="Upload an image file.")
        image_bytes = await upload.read(MAX_UPLOAD_BYTES + 1)
        if not image_bytes:
            raise HTTPException(status_code=400, detail="The uploaded image is empty.")
        if len(image_bytes) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="The uploaded image exceeds the size limit.")
        try:
            preprocessed = await run_in_threadpool(preprocess_image, image_bytes)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        try:
            return await run_in_threadpool(run_ocr, preprocessed)
        except Exception as error:
            logger.exception("Passport OCR processing failed")
            raise HTTPException(status_code=500, detail="Passport OCR processing failed.") from error
    finally:
        await upload.close()