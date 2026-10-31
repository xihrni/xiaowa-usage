import os
import tempfile
from pathlib import Path

import oss2

bucket_name = os.environ.get("ALIYUN_OSS_BUCKET", "").strip()
endpoint = os.environ.get("ALIYUN_OSS_ENDPOINT", "").strip().removeprefix("https://").removeprefix("http://").rstrip("/")
access_key_id = os.environ.get("ALIYUN_OSS_ACCESS_KEY_ID", "").strip()
access_key_secret = os.environ.get("ALIYUN_OSS_ACCESS_KEY_SECRET", "").strip()
prefix = os.environ.get("ALIYUN_OSS_PREFIX", "stable").strip().strip("/")
public_base = (os.environ.get("ALIYUN_OSS_PUBLIC_BASE_URL") or f"https://{bucket_name}.{endpoint}").rstrip("/")
source_dir = Path(os.environ.get("OSS_SOURCE_DIR", "release-builder"))

for label, value in {
    "ALIYUN_OSS_BUCKET": bucket_name,
    "ALIYUN_OSS_ENDPOINT": endpoint,
    "ALIYUN_OSS_ACCESS_KEY_ID": access_key_id,
    "ALIYUN_OSS_ACCESS_KEY_SECRET": access_key_secret,
}.items():
    if not value:
        raise SystemExit(f"Missing {label}")

if not source_dir.is_dir():
    raise SystemExit(f"Source directory not found: {source_dir}")

files = [
    path for path in source_dir.iterdir()
    if path.is_file() and (
        (path.name.startswith("WorkBuddyPet-Setup-") and (path.name.endswith(".exe") or path.name.endswith(".exe.blockmap")))
        or (path.name.startswith("WorkBuddyPet-") and path.name.endswith("-win-x64.zip"))
        or path.name in {"latest.yml", "SHA256SUMS.txt"}
    )
]
if not files:
    raise SystemExit(f"No release assets found in {source_dir}")

def metadata(name):
    if name == "latest.yml":
        return "text/yaml; charset=utf-8", "no-cache, max-age=0"
    if name == "SHA256SUMS.txt":
        return "text/plain; charset=utf-8", "no-cache, max-age=0"
    if name.endswith(".zip"):
        return "application/zip", "public, max-age=31536000, immutable"
    return "application/octet-stream", "public, max-age=31536000, immutable"

auth = oss2.Auth(access_key_id, access_key_secret)
bucket = oss2.Bucket(auth, f"https://{endpoint}", bucket_name)

# Upload binaries first; latest.yml is uploaded last so the updater never sees a partial release.
files.sort(key=lambda path: (path.name == "latest.yml", path.name))
for path in files:
    content_type, cache_control = metadata(path.name)
    key = f"{prefix}/{path.name}"
    headers = {
        "Content-Type": content_type,
        "Cache-Control": cache_control,
    }
    if path.stat().st_size > 32 * 1024 * 1024:
        oss2.resumable_upload(
            bucket,
            key,
            str(path),
            store=oss2.ResumableStore(root=tempfile.mkdtemp(prefix="xiaowa-oss-")),
            headers=headers,
            multipart_threshold=32 * 1024 * 1024,
            part_size=8 * 1024 * 1024,
            num_threads=4,
        )
    else:
        bucket.put_object_from_file(key, str(path), headers=headers)
    result = bucket.head_object(key)
    print(f"uploaded {key} ({result.content_length} bytes)")

print(f"base {public_base}/{prefix}/")
