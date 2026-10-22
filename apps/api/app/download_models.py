import hashlib
import urllib.request
from pathlib import Path

MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
        "face_detection_yunet_2023mar.onnx",
        "8F2383E4DD3CFBB4553EA8718107FC0423210DC964F9F4280604804ED2552FA4",
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/"
        "face_recognition_sface_2021dec.onnx",
        "0BA9FBFA01B5270C96627C4EF784DA859931E02F04419C829E83484087C34E79",
    ),
}


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest().upper()


def main() -> None:
    model_dir = Path(__file__).resolve().parent.parent / "runtime-models"
    model_dir.mkdir(parents=True, exist_ok=True)
    for filename, (url, expected_hash) in MODELS.items():
        target = model_dir / filename
        if target.is_file() and digest(target) == expected_hash:
            print(f"Face model ready: {filename}")
            continue
        temporary = target.with_suffix(".download")
        print(f"Downloading face model: {filename}")
        urllib.request.urlretrieve(url, temporary)
        actual_hash = digest(temporary)
        if actual_hash != expected_hash:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(
                f"SHA256 mismatch for {filename}: expected {expected_hash}, got {actual_hash}"
            )
        temporary.replace(target)
        print(f"Face model verified: {filename}")


if __name__ == "__main__":
    main()
