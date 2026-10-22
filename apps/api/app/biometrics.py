import hashlib
import math
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from app.config import Settings

YUNET_SHA256 = "8F2383E4DD3CFBB4553EA8718107FC0423210DC964F9F4280604804ED2552FA4"
SFACE_SHA256 = "0BA9FBFA01B5270C96627C4EF784DA859931E02F04419C829E83484087C34E79"


@dataclass
class RecognitionResult:
    detected_face_count: int
    quality_score: float | None
    liveness_score: float | None
    depth_score: float | None = None
    embedding: list[float] | None = None
    matched_profile_id: str | None = None
    match_score: float | None = None
    errors: list[str] = field(default_factory=list)
    confidence_cap: float | None = None


@dataclass
class DetectedFaceResult:
    bounding_box: tuple[int, int, int, int]
    quality_score: float | None
    embedding: list[float] | None = None
    errors: list[str] = field(default_factory=list)


@dataclass
class FrameAnalysisResult:
    image_width: int | None
    image_height: int | None
    faces: list[DetectedFaceResult] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class FaceRecognitionEngine(Protocol):
    engine_name: str
    model_name: str
    model_version: str
    dimension: int

    def analyze_enrollment_sample(self, image_bytes: bytes) -> RecognitionResult: ...

    def identify(self, image_bytes: bytes, branch_id: str) -> RecognitionResult: ...

    def analyze_frame(self, image_bytes: bytes) -> FrameAnalysisResult: ...

    def create_profile(self, embeddings: list[list[float]]) -> list[float]: ...

    def health(self) -> dict[str, Any]: ...


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return -1.0
    try:
        if not all(math.isfinite(value) for value in (*left, *right)):
            return -1.0
        dot = sum(a * b for a, b in zip(left, right, strict=True))
        left_norm = math.sqrt(sum(value * value for value in left))
        right_norm = math.sqrt(sum(value * value for value in right))
    except (TypeError, ValueError, OverflowError):
        return -1.0
    if not left_norm or not right_norm:
        return -1.0
    similarity = dot / (left_norm * right_norm)
    return similarity if math.isfinite(similarity) else -1.0


def normalized_average(embeddings: list[list[float]]) -> list[float]:
    if not embeddings or not embeddings[0]:
        raise ValueError("At least one non-empty embedding is required.")
    dimension = len(embeddings[0])
    if any(len(item) != dimension for item in embeddings):
        raise ValueError("Embedding dimensions do not match.")
    if not all(math.isfinite(value) for embedding in embeddings for value in embedding):
        raise ValueError("Embeddings must contain only finite numeric values.")
    averaged = [sum(values) / len(values) for values in zip(*embeddings, strict=True)]
    norm = math.sqrt(sum(value * value for value in averaged))
    if not norm:
        raise ValueError("Cannot normalize a zero embedding.")
    return [float(value / norm) for value in averaged]


class MockFaceRecognitionEngine:
    """Deterministic tags make explicit mock workflows testable without face images."""

    engine_name = "mock"
    model_name = "mock-deterministic"
    model_version = "1"
    dimension = 16

    @staticmethod
    def _tag(image_bytes: bytes) -> str:
        return image_bytes.decode("utf-8", errors="replace").strip().lower()

    @classmethod
    def embedding_for_tag(cls, tag: str) -> list[float]:
        digest = hashlib.sha256(tag.lower().encode()).digest()[: cls.dimension]
        values = [(byte - 127.5) / 127.5 for byte in digest]
        norm = math.sqrt(sum(value * value for value in values)) or 1
        return [round(value / norm, 8) for value in values]

    def identify(self, image_bytes: bytes, branch_id: str) -> RecognitionResult:
        tag = self._tag(image_bytes)
        if tag == "no-face":
            return RecognitionResult(0, None, None, errors=["NO_FACE"])
        if tag == "multiple-faces":
            return RecognitionResult(2, 0.9, None, errors=["MULTIPLE_FACES"])
        if tag == "low-quality":
            return RecognitionResult(1, 0.2, 0.95, errors=["LOW_IMAGE_QUALITY"])
        if tag == "spoof":
            return RecognitionResult(1, 0.95, 0.1, errors=["LIVENESS_FAILED"])
        if tag == "unknown":
            return RecognitionResult(1, 0.95, 0.95, errors=["IDENTITY_NOT_FOUND"])
        cap = None
        if tag.startswith("low-confidence:"):
            tag = tag.removeprefix("low-confidence:")
            cap = 0.30
        return RecognitionResult(
            detected_face_count=1,
            quality_score=0.95,
            liveness_score=0.95,
            embedding=self.embedding_for_tag(tag),
            confidence_cap=cap,
        )

    def analyze_enrollment_sample(self, image_bytes: bytes) -> RecognitionResult:
        return self.identify(image_bytes, "enrollment")

    def analyze_frame(self, image_bytes: bytes) -> FrameAnalysisResult:
        result = self.identify(image_bytes, "stream")
        if result.detected_face_count == 0:
            return FrameAnalysisResult(640, 480)
        faces = [
            DetectedFaceResult(
                bounding_box=(80 + index * 220, 80, 180, 240),
                quality_score=result.quality_score,
                embedding=result.embedding,
                errors=result.errors,
            )
            for index in range(result.detected_face_count)
        ]
        return FrameAnalysisResult(640, 480, faces=faces)

    def create_profile(self, embeddings: list[list[float]]) -> list[float]:
        return normalized_average(embeddings)

    def health(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "engine": self.engine_name,
            "demo_mode": True,
            "model_name": self.model_name,
            "model_version": self.model_version,
            "embedding_dimension": self.dimension,
        }


class OpenCvSFaceEngine:
    engine_name = "opencv_sface"
    dimension = 128

    def __init__(self, settings: Settings):
        self.settings = settings
        self.model_name = settings.face_model_name
        self.model_version = settings.face_model_version
        self._lock = threading.Lock()
        self.detection_path = self._validated_model(
            settings.face_detection_model_path,
            settings.face_detection_model_sha256,
            "YuNet detection",
        )
        self.recognition_path = self._validated_model(
            settings.face_recognition_model_path,
            settings.face_recognition_model_sha256,
            "SFace recognition",
        )
        try:
            import cv2
            import numpy as np
        except ImportError as exc:
            raise RuntimeError(
                "OpenCV SFace engine requires numpy and opencv-python-headless 4.13."
            ) from exc
        if not cv2.__version__.startswith("4.13."):
            raise RuntimeError(f"OpenCV 4.13 is required; found {cv2.__version__}.")
        self.cv2 = cv2
        self.np = np
        try:
            self.detector = cv2.FaceDetectorYN.create(
                str(self.detection_path),
                "",
                (320, 320),
                settings.yunet_score_threshold,
                settings.yunet_nms_threshold,
                settings.yunet_top_k,
            )
            self.recognizer = cv2.FaceRecognizerSF.create(str(self.recognition_path), "")
        except cv2.error as exc:
            raise RuntimeError(f"Could not load OpenCV face models: {exc}") from exc

    @staticmethod
    def _model_path(configured_path: str) -> Path:
        path = Path(configured_path)
        return path if path.is_absolute() else Path(__file__).resolve().parent.parent / path

    @classmethod
    def _validated_model(cls, configured_path: str, expected_hash: str, label: str) -> Path:
        path = cls._model_path(configured_path)
        if not path.is_file():
            raise RuntimeError(f"{label} model does not exist: {path}")
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest().upper()
        if actual_hash != expected_hash.upper():
            raise RuntimeError(
                f"{label} model SHA256 mismatch at {path}: expected {expected_hash.upper()}, "
                f"got {actual_hash}"
            )
        return path

    def identify(self, image_bytes: bytes, branch_id: str) -> RecognitionResult:
        return self._analyze(image_bytes)

    def analyze_enrollment_sample(self, image_bytes: bytes) -> RecognitionResult:
        return self._analyze(image_bytes)

    def analyze_frame(self, image_bytes: bytes) -> FrameAnalysisResult:
        if not image_bytes or len(image_bytes) > self.settings.max_sample_bytes:
            return FrameAnalysisResult(None, None, errors=["INVALID_IMAGE"])
        if not image_bytes.startswith(b"\xff\xd8\xff"):
            return FrameAnalysisResult(None, None, errors=["INVALID_IMAGE"])
        encoded = self.np.frombuffer(image_bytes, dtype=self.np.uint8)
        try:
            image = self.cv2.imdecode(encoded, self.cv2.IMREAD_COLOR)
        except self.cv2.error:
            return FrameAnalysisResult(None, None, errors=["INVALID_IMAGE"])
        if image is None or image.ndim != 3 or image.shape[2] != 3:
            return FrameAnalysisResult(None, None, errors=["INVALID_IMAGE"])
        height, width = image.shape[:2]
        if (
            width > self.settings.face_max_image_width
            or height > self.settings.face_max_image_height
            or width * height > self.settings.face_max_image_pixels
        ):
            return FrameAnalysisResult(width, height, errors=["IMAGE_DIMENSIONS_EXCEEDED"])

        results: list[DetectedFaceResult] = []
        with self._lock:
            self.detector.setInputSize((width, height))
            try:
                _, faces = self.detector.detect(image)
            except self.cv2.error:
                return FrameAnalysisResult(width, height, errors=["INVALID_IMAGE"])
            if faces is None:
                return FrameAnalysisResult(width, height)
            if len(faces) > self.settings.live_camera_max_faces:
                return FrameAnalysisResult(width, height, errors=["TOO_MANY_FACES"])

            for face in faces:
                quality, errors = self._quality(image, face)
                embedding = None
                if not errors:
                    try:
                        aligned = self.recognizer.alignCrop(image, face)
                        feature = (
                            self.recognizer.feature(aligned)
                            .reshape(-1)
                            .astype(self.np.float32)
                        )
                    except self.cv2.error:
                        errors = ["EMBEDDING_EXTRACTION_FAILED"]
                    else:
                        if feature.size != self.dimension or not self.np.isfinite(feature).all():
                            errors = ["EMBEDDING_EXTRACTION_FAILED"]
                        else:
                            norm = float(self.np.linalg.norm(feature))
                            if norm <= 0:
                                errors = ["EMBEDDING_EXTRACTION_FAILED"]
                            else:
                                embedding = (feature / norm).astype(float).tolist()
                results.append(
                    DetectedFaceResult(
                        bounding_box=self._bounding_box(image, face),
                        quality_score=quality,
                        embedding=embedding,
                        errors=errors,
                    )
                )
        return FrameAnalysisResult(width, height, faces=results)

    def _analyze(self, image_bytes: bytes) -> RecognitionResult:
        if not image_bytes:
            return RecognitionResult(0, None, None, errors=["INVALID_IMAGE"])
        if len(image_bytes) > self.settings.max_sample_bytes:
            return RecognitionResult(0, None, None, errors=["IMAGE_TOO_LARGE"])
        is_jpeg = image_bytes.startswith(b"\xff\xd8\xff")
        is_png = image_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        if not (is_jpeg or is_png):
            return RecognitionResult(0, None, None, errors=["INVALID_IMAGE"])
        encoded = self.np.frombuffer(image_bytes, dtype=self.np.uint8)
        image = self.cv2.imdecode(encoded, self.cv2.IMREAD_COLOR)
        if image is None or image.ndim != 3 or image.shape[2] != 3:
            return RecognitionResult(0, None, None, errors=["INVALID_IMAGE"])
        height, width = image.shape[:2]
        if (
            width > self.settings.face_max_image_width
            or height > self.settings.face_max_image_height
            or width * height > self.settings.face_max_image_pixels
        ):
            return RecognitionResult(0, None, None, errors=["IMAGE_DIMENSIONS_EXCEEDED"])

        with self._lock:
            self.detector.setInputSize((width, height))
            try:
                _, faces = self.detector.detect(image)
            except self.cv2.error:
                return RecognitionResult(0, None, None, errors=["INVALID_IMAGE"])
            count = 0 if faces is None else len(faces)
            if count == 0:
                return RecognitionResult(0, None, None, errors=["NO_FACE"])
            if count != 1:
                return RecognitionResult(count, None, None, errors=["MULTIPLE_FACES"])
            face = faces[0]
            quality, errors = self._quality(image, face)
            if errors:
                return RecognitionResult(1, quality, None, errors=errors)
            try:
                aligned = self.recognizer.alignCrop(image, face)
                feature = self.recognizer.feature(aligned).reshape(-1).astype(self.np.float32)
            except self.cv2.error:
                return RecognitionResult(1, quality, None, errors=["INVALID_IMAGE"])

        if feature.size != self.dimension or not self.np.isfinite(feature).all():
            return RecognitionResult(1, quality, None, errors=["EMBEDDING_EXTRACTION_FAILED"])
        norm = float(self.np.linalg.norm(feature))
        if norm <= 0:
            return RecognitionResult(1, quality, None, errors=["EMBEDDING_EXTRACTION_FAILED"])
        embedding = (feature / norm).astype(float).tolist()
        return RecognitionResult(1, quality, None, embedding=embedding)

    def _quality(self, image: Any, face: Any) -> tuple[float, list[str]]:
        height, width = image.shape[:2]
        x, y, box_width, box_height = (float(value) for value in face[:4])
        x1, y1 = max(0, int(x)), max(0, int(y))
        x2, y2 = min(width, int(x + box_width)), min(height, int(y + box_height))
        if x2 <= x1 or y2 <= y1:
            return 0.0, ["INVALID_IMAGE"]
        crop = image[y1:y2, x1:x2]
        gray = self.cv2.cvtColor(crop, self.cv2.COLOR_BGR2GRAY)
        minimum_side = min(box_width, box_height)
        size_ratio = minimum_side / max(1, min(width, height))
        blur = float(self.cv2.Laplacian(gray, self.cv2.CV_64F).var())
        exposure = float(gray.mean())
        clipped = float(((gray <= 5) | (gray >= 250)).mean())
        errors: list[str] = []
        if (
            minimum_side < self.settings.face_min_size_pixels
            or size_ratio < self.settings.face_min_size_ratio
        ):
            errors.append("FACE_TOO_SMALL")
        if blur < self.settings.face_blur_threshold:
            errors.append("IMAGE_TOO_BLURRY")
        if (
            exposure < self.settings.face_min_exposure
            or exposure > self.settings.face_max_exposure
            or clipped > self.settings.face_max_clipped_fraction
        ):
            errors.append("BAD_EXPOSURE")

        size_base = min(
            minimum_side / self.settings.face_min_size_pixels,
            size_ratio / self.settings.face_min_size_ratio,
        )
        size_score = min(1.0, 0.7 + 0.3 * max(0.0, size_base - 1.0))
        blur_score = min(1.0, 0.7 + 0.3 * max(0.0, blur / self.settings.face_blur_threshold - 1.0))
        exposure_middle = (self.settings.face_min_exposure + self.settings.face_max_exposure) / 2
        exposure_half_range = (
            self.settings.face_max_exposure - self.settings.face_min_exposure
        ) / 2
        exposure_score = 0.7 + 0.3 * max(
            0.0, 1.0 - abs(exposure - exposure_middle) / exposure_half_range
        )
        detector_score = float(face[-1])
        quality = max(0.0, min(1.0, detector_score, size_score, blur_score, exposure_score))
        return quality, errors

    @staticmethod
    def _bounding_box(image: Any, face: Any) -> tuple[int, int, int, int]:
        height, width = image.shape[:2]
        x, y, box_width, box_height = (float(value) for value in face[:4])
        x1 = max(0, min(width, math.floor(x)))
        y1 = max(0, min(height, math.floor(y)))
        x2 = max(x1, min(width, math.ceil(x + box_width)))
        y2 = max(y1, min(height, math.ceil(y + box_height)))
        return x1, y1, x2 - x1, y2 - y1

    def create_profile(self, embeddings: list[list[float]]) -> list[float]:
        if any(len(item) != self.dimension for item in embeddings):
            raise ValueError(f"SFace embeddings must contain {self.dimension} values.")
        return normalized_average(embeddings)

    def health(self) -> dict[str, Any]:
        return {
            "status": "ready",
            "engine": self.engine_name,
            "demo_mode": False,
            "model_name": self.model_name,
            "model_version": self.model_version,
            "embedding_dimension": self.dimension,
            "opencv_version": self.cv2.__version__,
            "liveness": {"mode": self.settings.liveness_mode, "supported": False},
            "models": {
                "detection": {
                    "path": str(self.detection_path),
                    "sha256": self.settings.face_detection_model_sha256.upper(),
                },
                "recognition": {
                    "path": str(self.recognition_path),
                    "sha256": self.settings.face_recognition_model_sha256.upper(),
                },
            },
        }


def create_face_engine(settings: Settings) -> FaceRecognitionEngine:
    if settings.face_engine == "mock":
        return MockFaceRecognitionEngine()
    return OpenCvSFaceEngine(settings)
