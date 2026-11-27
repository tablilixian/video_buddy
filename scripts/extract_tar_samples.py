#!/usr/bin/env python3
"""从远端 tar 里抽取音频样本（不落整包）。

两种模式：
- `head`：从头流式读取，取前 N 个音频成员。快，但 Common Voice 的 tar 是**按
  说话人聚簇**的，前 N 个往往只来自一两个人。
- `spread`：用 HTTP Range 在 tar 上均匀取点，定位到最近的 tar 头再抽 1 个成员。
  tar 未压缩、可随机访问，所以 40 个点 ≈ 40 个不同说话人，只下载十几 MB。

用法：python3 scripts/extract_tar_samples.py <url> <outdir> <limit> [head|spread]
输出：JSON 数组（成员文件名）；错误走 stderr + 非零退出码。
"""
import io
import json
import os
import sys
import tarfile
import urllib.request

AUDIO_SUFFIXES = (".mp3", ".wav", ".flac", ".ogg", ".m4a")
BLOCK = 512
CHUNK = 128 * 1024
USER_AGENT = "voice-template-fetch/1.0"


def request(url: str, headers: dict | None = None, method: str | None = None):
    merged = {"User-Agent": USER_AGENT}
    if headers:
        merged.update(headers)
    return urllib.request.Request(url, headers=merged, method=method)


def remote_size(url: str) -> int:
    with urllib.request.urlopen(request(url, method="HEAD"), timeout=60) as response:
        return int(response.headers["Content-Length"])


def fetch_range(url: str, start: int, end: int) -> bytes:
    with urllib.request.urlopen(request(url, {"Range": f"bytes={start}-{end}"}), timeout=60) as response:
        return response.read()


def parse_header(buffer: bytes, offset: int):
    """解析 offset 处的 tar 头；不是合法头就返回 None。"""
    header = buffer[offset:offset + BLOCK]
    if len(header) < BLOCK or header[257:262] != b"ustar":
        return None
    checksum_field = header[148:156]
    try:
        expected = int(checksum_field.strip(b"\x00 ") or b"0", 8)
    except ValueError:
        return None
    actual = sum(header[:148]) + 32 * 8 + sum(header[156:])
    if actual != expected:
        return None
    try:
        size = int(header[124:136].strip(b"\x00 ") or b"0", 8)
    except ValueError:
        return None
    name = header[0:100].split(b"\x00", 1)[0].decode("utf-8", "replace")
    prefix = header[345:500].split(b"\x00", 1)[0].decode("utf-8", "replace")
    full = f"{prefix}/{name}" if prefix else name
    return full, size


def is_audio(name: str) -> bool:
    return name.lower().endswith(AUDIO_SUFFIXES)


def write_member(outdir: str, name: str, data: bytes) -> str:
    base = os.path.basename(name)
    with open(os.path.join(outdir, base), "wb") as sink:
        sink.write(data)
    return base


def head_mode(url: str, outdir: str, limit: int):
    names = []
    with urllib.request.urlopen(request(url), timeout=60) as response:
        with tarfile.open(fileobj=response, mode="r|") as archive:
            for member in archive:
                if not member.isfile() or not is_audio(member.name):
                    continue
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                names.append(write_member(outdir, member.name, handle.read()))
                if len(names) >= limit:
                    break
    return names


def spread_mode(url: str, outdir: str, limit: int):
    total = remote_size(url)
    points = max(limit, 1)
    names = []
    seen = set()
    for index in range(points):
        if len(names) >= limit:
            break
        position = int(total * (index + 0.5) / points)
        start = max(0, position - CHUNK // 4)
        chunk = fetch_range(url, start, min(start + CHUNK - 1, total - 1))

        cursor = 0
        found = None
        while True:
            marker = chunk.find(b"ustar", cursor)
            if marker == -1:
                break
            header_at = marker - 257
            if header_at >= 0:
                parsed = parse_header(chunk, header_at)
                if parsed is not None:
                    found = (header_at, parsed)
                    break
            cursor = marker + 1
        if found is None:
            continue

        header_at, (name, size) = found
        data_start = start + header_at + BLOCK
        if data_start + size > total:
            continue
        data = chunk[header_at + BLOCK:header_at + BLOCK + size]
        if len(data) < size:
            data = fetch_range(url, data_start, data_start + size - 1)
        if name in seen or not is_audio(name):
            continue
        seen.add(name)
        names.append(write_member(outdir, name, data))
    return names


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: extract_tar_samples.py <url> <outdir> <limit> [head|spread]", file=sys.stderr)
        return 2
    url, outdir, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
    mode = sys.argv[4] if len(sys.argv) > 4 else "head"
    os.makedirs(outdir, exist_ok=True)
    names = spread_mode(url, outdir, limit) if mode == "spread" else head_mode(url, outdir, limit)
    print(json.dumps(names))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - 命令行工具，错误直接上报
        print(f"extract failed: {error}", file=sys.stderr)
        raise SystemExit(1)
