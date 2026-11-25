"""Rebuild current Omnixa icon consumers from the production Splash geometry.

Requires FFmpeg with its native librsvg decoder and Pillow. This is
an explicit authoring command; packaging continues to copy checked-in assets.
"""

import argparse
import base64
import hashlib
import io
import json
import platform
import re
import struct
import subprocess
from pathlib import Path
from xml.sax.saxutils import quoteattr

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
GEOMETRY_SOURCE = ROOT / "packages/ui/src/components/logo.tsx"
WORDMARK_SOURCE = ROOT / "packages/ui/src/typography/wordmark/wordmark.tsx"
SOCIAL_SHARE = ROOT / "packages/ui/src/assets/images/social-share.png"
SOCIAL_BRAND_BOUNDS = (190, 220, 1090, 400)
RECEIPT = ROOT / "packages/desktop/scripts/brand-icons.manifest.json"
CHANNELS = {
    "prod": {
        "background": ("#1C1F2A", "#0A0C13"),
        "wings": ("#FCFDFF", "#C2CEDE"),
        "core": ("#87F0FF", "#0EA5E9"),
        "rim": "#FFFFFF",
        "grid": "#FFFFFF",
        "grid_opacity": "0",
    },
    "beta": {
        "background": ("#FCFDFF", "#E4E8EF"),
        "wings": ("#181E2A", "#0A0E16"),
        "core": ("#38BDF8", "#0284C7"),
        "rim": "#0F172A",
        "grid": "#0F172A",
        "grid_opacity": "0.09",
    },
    "dev": {
        "background": ("#408AFF", "#1B4ED8"),
        "wings": ("#FFFFFF", "#E4F0FF"),
        "core": ("#FEF9C3", "#FACC15"),
        "rim": "#FFFFFF",
        "grid": "#FFFFFF",
        "grid_opacity": "0.19",
    },
}
MAC_SIZES = (16, 32, 64, 128, 256, 512, 1024)
WEB_SIZES = (16, 32, 48, 64, 96, 128, 180, 192, 256, 512)
ICO_SIZES = (16, 32, 48, 64, 128, 256)
ICNS_SLOTS = (
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_geometry():
    source = GEOMETRY_SOURCE.read_text()
    wing = re.search(r'\bconst WING_STANDARD\s*=\s*("(?:[^"\\]|\\.)*")', source)
    splash = source.split("export const Splash =", 1)
    if not wing or len(splash) != 2:
        raise ValueError("Production Splash geometry changed; update the extraction boundary before rebuilding icons")

    core = re.search(r'<rect\s+data-slot="core"([^>]+)/>', splash[1].split("export const Logo =", 1)[0])
    if not core:
        raise ValueError("Production Splash must expose one literal core rect")

    attributes = dict(re.findall(r'([\w-]+)="([^"]*)"', core.group(1)))
    required = ("x", "y", "width", "height", "rx", "transform")
    if not all(name in attributes for name in required):
        raise ValueError("Production Splash core attributes must remain explicit SVG literals")

    return {
        "wing": json.loads(wing.group(1)),
        "core": {name: attributes[name] for name in required},
    }


def read_wordmark():
    source = WORDMARK_SOURCE.read_text()
    letters = re.search(r'\bconst LETTER_PATH\s*=\s*\[(.*?)\]\.join\(" "\)', source, re.S)
    core = re.search(r'\bconst CORE_PATH\s*=\s*("(?:[^"\\]|\\.)*")', source)
    if not letters or not core:
        raise ValueError("Production Wordmark paths changed; update the extraction boundary before rebuilding")
    paths = re.findall(r'"(?:[^"\\]|\\.)*"', letters.group(1))
    return {"letters": " ".join(json.loads(path) for path in paths), "core": json.loads(core.group(1))}


def social_background():
    image = Image.open(SOCIAL_SHARE).convert("RGBA")
    if image.size != (1280, 721):
        raise ValueError("The current social-share composition is 1280x721; revise its layout explicitly if this changes")
    # The existing brand occupies this flat area, between the preserved grid
    # and tagline. Clearing it also makes the background stable on regeneration.
    image.paste(image.getpixel((190, 220)), SOCIAL_BRAND_BOUNDS)
    return image


def foreground(geometry, wings, core, scale):
    paths = "".join(
        f'<path d={quoteattr(geometry["wing"])} transform="rotate({rotation} 50 50)" fill={quoteattr(color)}/>'
        for rotation, color in ((180, wings[0]), (270, wings[0]), (0, wings[1]), (90, wings[1]))
    )
    attributes = " ".join(f"{name}={quoteattr(value)}" for name, value in geometry["core"].items())
    return (
        f'<g transform="translate(50 50) scale({scale}) translate(-50 -50)">'
        f'{paths}<rect {attributes} fill={quoteattr(core)}/></g>'
    )


def source_svg(geometry, channel, profile):
    material = CHANNELS[channel]
    mac = profile == "macos"
    x, width, radius = ("9.75", "80.5", "18.25") if mac else ("0", "100", "0")
    body = f'x="{x}" y="{x}" width="{width}" height="{width}" rx="{radius}"'
    shadow = ' filter="url(#shadow)"' if mac else ""
    rim = f'<rect {body} fill="none" stroke={quoteattr(material["rim"])} stroke-opacity="0.17" stroke-width="0.4"/>' if mac else ""
    grid = (
        f'<g stroke={quoteattr(material["grid"])} stroke-width="0.32" fill="none" opacity="{material["grid_opacity"]}">'
        '<path d="M 50 0 V 100 M 0 50 H 100 M 27.5 0 V 100 M 72.5 0 V 100 M 0 27.5 H 100 M 0 72.5 H 100 M 0 0 L 100 100 M 100 0 L 0 100"/>'
        '<circle cx="50" cy="50" r="31"/></g>'
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">'
        '<defs><linearGradient id="body" x1="0" y1="0" x2="0" y2="1">'
        f'<stop stop-color={quoteattr(material["background"][0])}/><stop offset="1" stop-color={quoteattr(material["background"][1])}/>'
        '</linearGradient><linearGradient id="core" x1="0" y1="0" x2="1" y2="1">'
        f'<stop stop-color={quoteattr(material["core"][0])}/><stop offset="1" stop-color={quoteattr(material["core"][1])}/>'
        '</linearGradient><filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="1.2"/><feOffset dy="1.2"/>'
        '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.38 0"/>'
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
        f'<clipPath id="body-clip"><rect {body}/></clipPath></defs>'
        f'<g{shadow}><rect {body} fill="url(#body)"/><g clip-path="url(#body-clip)">{grid}'
        f'{foreground(geometry, material["wings"], "url(#core)", "0.78" if mac else "1")}'
        f'</g>{rim}</g></svg>\n'
    )


def render_svg(svg, size, height=None):
    height = size if height is None else height
    # Render at the requested intrinsic SVG size, rather than scaling a bitmap.
    end = svg.index(">") + 1
    header = re.sub(r'\s(?:width|height)="[^"]*"', "", svg[:end])
    source = header.replace("<svg ", f'<svg width="{size}" height="{height}" ', 1) + svg[end:]
    encoded = source.encode()
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
         "-f", "svg_pipe", "-frame_size", str(len(encoded)), "-framerate", "1",
         "-c:v", "librsvg", "-i", "pipe:0", "-frames:v", "1",
         "-c:v", "png", "-threads", "1", "-f", "image2pipe", "pipe:1"],
        input=encoded, capture_output=True,
    )
    if result.returncode:
        raise ValueError(f"librsvg renderer exited {result.returncode}: {result.stderr.decode()}")
    return Image.open(io.BytesIO(result.stdout)).convert("RGBA")


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    return buffer.getvalue()


def ico_bytes(pngs, sizes):
    offset = 6 + 16 * len(sizes)
    entries = []
    payloads = []
    for size in sizes:
        data = pngs[size]
        entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        payloads.append(data)
        offset += len(data)
    return struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(entries + payloads)


def icns_bytes(pngs):
    chunks = b"".join(struct.pack(">4sI", tag, len(pngs[size]) + 8) + pngs[size] for tag, size in ICNS_SLOTS)
    return struct.pack(">4sI", b"icns", len(chunks) + 8) + chunks


def tool_versions():
    return {
        "python": platform.python_version(),
        "ffmpeg": subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True).stdout.strip(),
        "svgDecoder": "librsvg",
        "pillow": Image.__version__,
    }


def geometry_hash(geometry):
    return sha256(json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode())


def generate():
    geometry = read_geometry()
    wordmark = read_wordmark()
    files = {}
    web_sources = {}
    web_pngs = {}

    def write(relative, data, profile, dimensions=None):
        (ROOT / relative).write_bytes(data)
        files[relative] = {"sha256": sha256(data), "profile": profile}
        if dimensions is not None:
            files[relative]["dimensions"] = dimensions

    for channel in CHANNELS:
        directory = f"packages/desktop/icons/{channel}"
        mac_source = source_svg(geometry, channel, "macos")
        web_source = source_svg(geometry, channel, "web")
        mac_pngs = {size: png_bytes(render_svg(mac_source, size)) for size in MAC_SIZES}
        pngs = {}
        for size in WEB_SIZES:
            image = render_svg(web_source, size)
            if image.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"{channel} Web icon must have an opaque canvas at {size}px")
            pngs[size] = png_bytes(image)

        # Check the essential mark itself, independently of the opaque canvas.
        silhouette = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' + foreground(geometry, ("#fff", "#fff"), "#fff", "1") + "</svg>"
        alpha = render_svg(silhouette, 192).getchannel("A")
        if any(
            value and (x + 0.5 - 96) ** 2 + (y + 0.5 - 96) ** 2 > (192 * 0.4) ** 2
            for y in range(192)
            for x in range(192)
            for value in (alpha.getpixel((x, y)),)
        ):
            raise ValueError("Essential Omnixa geometry exceeds the maskable 40% radius safe zone")

        write(f"{directory}/source-macos.svg", mac_source.encode(), "macos")
        write(f"{directory}/source-web.svg", web_source.encode(), "web")
        write(f"{directory}/icon.icns", icns_bytes(mac_pngs), "macos")
        write(f"{directory}/dock.png", mac_pngs[256], "macos", [256, 256])
        write(f"{directory}/128x128@2x.png", mac_pngs[256], "macos", [256, 256])
        # electron-builder's Linux set resolver takes numeric filenames and
        # ignores icon.png once such files exist, so include the large sizes.
        for size in (32, 64, 128, 256, 512):
            write(f"{directory}/{size}x{size}.png", pngs[size], "linux-web", [size, size])
        write(f"{directory}/icon.png", pngs[512], "linux-web", [512, 512])
        write(f"{directory}/icon.ico", ico_bytes(pngs, ICO_SIZES), "windows-web")
        write(f"{directory}/ios/AppIcon-60x60@3x.png", pngs[180], "apple-touch", [180, 180])
        write(f"{directory}/android/mipmap-xxxhdpi/ic_launcher.png", pngs[192], "pwa", [192, 192])
        web_sources[channel] = web_source
        web_pngs[channel] = pngs

    favicon = "packages/ui/src/assets/favicon"
    for suffix in ("", "-v3"):
        write(f"{favicon}/favicon{suffix}.svg", web_sources["prod"].encode(), "web")
        write(f"{favicon}/favicon{suffix}.ico", ico_bytes(web_pngs["prod"], (16, 32, 48)), "web")
        write(f"{favicon}/favicon-96x96{suffix}.png", web_pngs["prod"][96], "web", [96, 96])
        write(f"{favicon}/apple-touch-icon{suffix}.png", web_pngs["prod"][180], "apple-touch", [180, 180])
    for size in (192, 512):
        write(f"{favicon}/web-app-manifest-{size}x{size}.png", web_pngs["prod"][size], "pwa", [size, size])

    background = social_background()
    background_png = png_bytes(background)
    wordmark_paths = (
        f'<path d={quoteattr(wordmark["letters"])} fill="#EEEEEE"/>'
        f'<path d={quoteattr(wordmark["core"])} fill="#38BDF8"/>'
    )
    bounds_svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 129">{wordmark_paths}</svg>'
    left, top, right, bottom = render_svg(bounds_svg, 720, 129).getchannel("A").getbbox()
    scale = min(880 / (right - left), 160 / (bottom - top))
    x = 640 - (right - left) * scale / 2
    y = 310 - (bottom - top) * scale / 2
    social_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 721">'
        f'<image width="1280" height="721" href="data:image/png;base64,{base64.b64encode(background_png).decode()}"/>'
        f'<g transform="translate({x} {y}) scale({scale}) translate({-left} {-top})">{wordmark_paths}</g></svg>\n'
    )
    social_image = render_svg(social_svg, 1280, 721)
    preserved = ((0, 0, 1280, 220), (0, 400, 1280, 721), (0, 220, 190, 400), (1090, 220, 1280, 400))
    if any(social_image.crop(box).tobytes() != background.crop(box).tobytes() for box in preserved):
        raise ValueError("Social-share background, grid and tagline must retain their original pixels")
    write("packages/desktop/scripts/social-share-source.svg", social_svg.encode(), "social-share")
    write(str(SOCIAL_SHARE.relative_to(ROOT)), png_bytes(social_image), "social-share", [1280, 721])

    receipt = {
        "version": 1,
        "command": "python3 packages/desktop/scripts/generate-brand-icons.py",
        "generator": {"path": str(Path(__file__).resolve().relative_to(ROOT)), "sha256": sha256(Path(__file__).read_bytes())},
        "geometry": {
            "path": str(GEOMETRY_SOURCE.relative_to(ROOT)),
            "sourceSha256": sha256(GEOMETRY_SOURCE.read_bytes()),
            "geometrySha256": geometry_hash(geometry),
            "wing": "WING_STANDARD",
            "core": "Splash rect[data-slot=core]",
        },
        "wordmark": {
            "path": str(WORDMARK_SOURCE.relative_to(ROOT)),
            "sourceSha256": sha256(WORDMARK_SOURCE.read_bytes()),
            "geometrySha256": geometry_hash(wordmark),
            "letters": "LETTER_PATH",
            "core": "CORE_PATH",
        },
        "socialShare": {
            "path": str(SOCIAL_SHARE.relative_to(ROOT)),
            "backgroundSha256": sha256(background_png),
            "replaceBounds": list(SOCIAL_BRAND_BOUNDS),
            "preservedRegions": len(preserved),
            "source": "packages/desktop/scripts/social-share-source.svg",
        },
        "tools": tool_versions(),
        "maskable": {"checkedSize": 192, "safeRadius": 0.4, "essentialPixelsOutsideSafeZone": 0, "webCanvasAlpha": 255},
        "files": dict(sorted(files.items())),
    }
    RECEIPT.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    check()
    print(f"Generated and checked {len(files)} brand assets; receipt: {RECEIPT.relative_to(ROOT)}")


def check():
    receipt = json.loads(RECEIPT.read_text())
    if receipt["generator"]["sha256"] != sha256(Path(__file__).read_bytes()):
        raise ValueError("Generator changed; rebuild the icon assets")
    if receipt["geometry"]["geometrySha256"] != geometry_hash(read_geometry()):
        raise ValueError("Production Splash geometry changed; rebuild the icon assets")
    if receipt["wordmark"]["geometrySha256"] != geometry_hash(read_wordmark()):
        raise ValueError("Production Wordmark geometry changed; rebuild the social-share asset")
    if receipt["socialShare"]["backgroundSha256"] != sha256(png_bytes(social_background())):
        raise ValueError("Social-share background composition changed; rebuild its source SVG and receipt")

    for relative, entry in receipt["files"].items():
        data = (ROOT / relative).read_bytes()
        if sha256(data) != entry["sha256"]:
            raise ValueError(f"Generated icon drift: {relative}")
        if relative.endswith(".png"):
            image = Image.open(io.BytesIO(data)).convert("RGBA")
            if list(image.size) != entry["dimensions"]:
                raise ValueError(f"Wrong PNG dimensions: {relative}")
            if entry["profile"] != "macos" and image.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"Web/platform icon lost its opaque canvas: {relative}")

    for channel in CHANNELS:
        directory = ROOT / "packages/desktop/icons" / channel
        data = (directory / "icon.icns").read_bytes()
        if data[:4] != b"icns" or struct.unpack(">I", data[4:8])[0] != len(data):
            raise ValueError(f"Invalid {channel} ICNS container")
        chunks = {}
        offset = 8
        while offset < len(data):
            tag, length = struct.unpack(">4sI", data[offset:offset + 8])
            if length < 8 or offset + length > len(data):
                raise ValueError(f"Invalid {channel} ICNS chunk")
            chunks[tag] = data[offset + 8:offset + length]
            offset += length
        for tag, size in ICNS_SLOTS:
            if Image.open(io.BytesIO(chunks[tag])).size != (size, size):
                raise ValueError(f"Wrong {channel} ICNS payload dimensions: {tag!r}")
        if chunks[b"ic13"] != (directory / "dock.png").read_bytes():
            raise ValueError(f"{channel} Dock PNG must be the exact ICNS ic13 payload")

        data = (directory / "icon.ico").read_bytes()
        reserved, kind, count = struct.unpack("<HHH", data[:6])
        if (reserved, kind, count) != (0, 1, len(ICO_SIZES)):
            raise ValueError(f"Invalid {channel} ICO directory")
        for index, size in enumerate(ICO_SIZES):
            width, height, _, _, planes, depth, length, offset = struct.unpack("<BBBBHHII", data[6 + 16 * index:22 + 16 * index])
            if (width or 256, height or 256, planes, depth) != (size, size, 1, 32):
                raise ValueError(f"Wrong {channel} ICO directory entry: {size}")
            image = Image.open(io.BytesIO(data[offset:offset + length])).convert("RGBA")
            if image.size != (size, size) or image.getchannel("A").getextrema() != (255, 255):
                raise ValueError(f"Wrong {channel} ICO payload: {size}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check current geometry, recorded hashes, dimensions, opacity and containers without writing")
    arguments = parser.parse_args()
    if arguments.check:
        check()
        print("Brand icon source, hashes and platform containers match the recorded receipt")
    if not arguments.check:
        generate()
