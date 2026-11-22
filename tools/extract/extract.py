#!/usr/bin/env python3
"""
North Star Extractor
Pull everything useful out of a web page or a social video.

  python extract.py <url> [<url> ...] [--frames 6] [--audio] [--out extracted]

Websites:  title, description, headings, main text, contact info, prices,
           VINs, mileage, structured data (schema.org), links, images.
Videos:    YouTube, TikTok, Instagram, Facebook reels (anything yt-dlp knows).
           Title, creator, date, views, likes, description, hashtags,
           captions/transcript, and optional still frames to look at.

Each URL gets its own folder with report.md (easy to read) and data.json.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

try:
    import trafilatura  # better "main article text" extraction
except ImportError:
    trafilatura = None

try:
    import yt_dlp
except ImportError:
    yt_dlp = None


UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

VIDEO_HOSTS = ("youtube.com", "youtu.be", "tiktok.com", "instagram.com",
               "facebook.com", "fb.watch", "vimeo.com", "x.com", "twitter.com")

# ---------- patterns that matter for car work ----------
RX_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
RX_PHONE = re.compile(r"(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
RX_PRICE = re.compile(r"\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\$\s?\d{3,6}(?:\.\d{2})?")
RX_VIN = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b")  # VINs never use I, O, Q
RX_MILES = re.compile(r"\b\d{1,3}(?:,\d{3})+\s?(?:mi|miles)\b|\b\d{1,3}k\s?(?:mi|miles)\b",
                      re.I)
RX_YMM = re.compile(r"\b(19[89]\d|20[0-3]\d)\s+([A-Z][a-zA-Z-]+)\s+([A-Z0-9][\w-]+)")


def uniq(items, limit=None):
    seen, out = set(), []
    for i in items:
        k = i.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out[:limit] if limit else out


def valid_vin(v):
    """Check digit test so random 17-char strings don't show up as VINs."""
    trans = {**{str(d): d for d in range(10)},
             **dict(zip("ABCDEFGH", range(1, 9))), **dict(zip("JKLMN", range(1, 6))),
             "P": 7, "R": 9, **dict(zip("STUVWXYZ", range(2, 10)))}
    weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]
    try:
        total = sum(trans[c] * w for c, w in zip(v, weights))
    except KeyError:
        return False
    check = total % 11
    return v[8] == ("X" if check == 10 else str(check))


def find_facts(text):
    vins = [v for v in uniq(RX_VIN.findall(text)) if valid_vin(v)]
    return {
        "emails": uniq(e for e in RX_EMAIL.findall(text)
                       if not e.lower().endswith((".png", ".jpg", ".webp"))),
        "phones": uniq(RX_PHONE.findall(text), 25),
        "prices": uniq(RX_PRICE.findall(text), 50),
        "vins": vins,
        "mileage": uniq(RX_MILES.findall(text), 50),
        "year_make_model": uniq((" ".join(m) for m in RX_YMM.findall(text)), 50),
        "hashtags": uniq(re.findall(r"(?<!\w)#\w+", text), 50),
    }


# =====================================================================
# WEBSITES
# =====================================================================
def extract_website(url, html=None):
    if html is None:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
        r.raise_for_status()
        html = r.text
    soup = BeautifulSoup(html, "html.parser")

    def meta(*names):
        for n in names:
            tag = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
            if tag and tag.get("content"):
                return tag["content"].strip()
        return ""

    # structured data (dealer sites often publish Vehicle / Product / Offer here)
    structured = []
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            structured.append(json.loads(s.string or ""))
        except (json.JSONDecodeError, TypeError):
            pass

    # main readable text
    main_text = ""
    if trafilatura:
        main_text = trafilatura.extract(html, include_tables=True, include_comments=False) or ""
    for t in soup(["script", "style", "noscript", "svg"]):
        t.decompose()
    full_text = re.sub(r"\n\s*\n+", "\n\n", soup.get_text("\n")).strip()
    if not main_text:
        main_text = full_text

    headings = [{"level": h.name, "text": h.get_text(" ", strip=True)}
                for h in soup.find_all(["h1", "h2", "h3", "h4"]) if h.get_text(strip=True)]

    host = urlparse(url).netloc
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(url, a["href"])
        if href.startswith(("http", "mailto:", "tel:")):
            links.append({"text": a.get_text(" ", strip=True)[:120], "url": href,
                          "internal": urlparse(href).netloc == host})

    images = uniq((urljoin(url, i.get("src") or i.get("data-src") or "")
                   for i in soup.find_all("img") if (i.get("src") or i.get("data-src"))), 100)

    tables = []
    for t in soup.find_all("table")[:10]:
        rows = [[c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
                for tr in t.find_all("tr")]
        if rows:
            tables.append(rows)

    socials = uniq(l["url"] for l in links if any(s in l["url"] for s in
                   ("facebook.com", "instagram.com", "tiktok.com", "youtube.com",
                    "x.com", "twitter.com", "linkedin.com")))

    return {
        "type": "website",
        "url": url,
        "title": (soup.title.string.strip() if soup.title and soup.title.string else meta("og:title")),
        "description": meta("description", "og:description", "twitter:description"),
        "site_name": meta("og:site_name"),
        "share_image": meta("og:image", "twitter:image"),
        "headings": headings,
        "facts": find_facts(full_text + "\n" + json.dumps(structured)),
        "social_profiles": socials,
        "tables": tables,
        "structured_data": structured,
        "links": links[:300],
        "images": images,
        "main_text": main_text,
        "word_count": len(main_text.split()),
    }


# =====================================================================
# VIDEOS
# =====================================================================
def vtt_to_text(vtt):
    lines, last = [], ""
    for line in vtt.splitlines():
        line = line.strip()
        if (not line or line.startswith(("WEBVTT", "Kind:", "Language:", "NOTE"))
                or "-->" in line or line.isdigit()):
            continue
        line = re.sub(r"<[^>]+>", "", line)
        if line != last:  # auto-captions repeat lines a lot
            lines.append(line)
            last = line
    return " ".join(lines)


COOKIES = None  # set by --cookies


def extract_video(url, folder, frames=0, audio=False, comments=False):
    if yt_dlp is None:
        raise RuntimeError("yt-dlp not installed. Run: pip install yt-dlp")
    folder.mkdir(parents=True, exist_ok=True)
    opts = {
        "quiet": True, "no_warnings": True, "skip_download": True,
        "writesubtitles": True, "writeautomaticsub": True,
        "subtitleslangs": ["en.*", "en"], "subtitlesformat": "vtt",
        "outtmpl": str(folder / "video.%(ext)s"),
        "getcomments": comments,
        **({"cookiefile": COOKIES} if COOKIES else {}),
        "extractor_args": {"youtube": {"max_comments": ["100"]}},
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)  # downloads captions only

    transcript = ""
    for f in sorted(folder.glob("video*.vtt")):
        transcript = vtt_to_text(f.read_text(errors="ignore"))
        if transcript:
            break

    media = None
    if frames or audio:
        dl = {"quiet": True, "no_warnings": True,
              "format": "best[height<=720]/best", "outtmpl": str(folder / "media.%(ext)s"),
              **({"cookiefile": COOKIES} if COOKIES else {})}
        with yt_dlp.YoutubeDL(dl) as ydl:
            ydl.download([url])
        media = next(iter(folder.glob("media.*")), None)

    frame_files = []
    if frames and media and shutil.which("ffmpeg"):
        dur = info.get("duration") or 30
        for n in range(frames):
            t = dur * (n + 0.5) / frames
            out = folder / f"frame_{n + 1:02d}.jpg"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{t:.2f}",
                            "-i", str(media), "-frames:v", "1", "-q:v", "3", str(out)])
            if out.exists():
                frame_files.append(out.name)

    if audio and media and not transcript:
        transcript = transcribe(media, folder)

    desc = info.get("description") or ""
    return {
        "type": "video",
        "url": url,
        "platform": info.get("extractor_key"),
        "title": info.get("title"),
        "creator": info.get("uploader") or info.get("channel"),
        "creator_url": info.get("uploader_url") or info.get("channel_url"),
        "upload_date": info.get("upload_date"),
        "duration_sec": info.get("duration"),
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "comments": info.get("comment_count"),
        "followers": info.get("channel_follower_count"),
        "tags": info.get("tags") or [],
        "description": desc,
        "chapters": [{"start": c.get("start_time"), "title": c.get("title")}
                     for c in (info.get("chapters") or [])],
        "facts": find_facts(f"{info.get('title', '')}\n{desc}\n{transcript}"),
        "transcript": transcript or "(no captions found — rerun with --audio to transcribe)",
        "frames": frame_files,
        "top_comments": [{"author": c.get("author"), "likes": c.get("like_count"),
                          "text": c.get("text")}
                         for c in sorted(info.get("comments") or [],
                                         key=lambda c: c.get("like_count") or 0,
                                         reverse=True)[:40]],
        "thumbnail": info.get("thumbnail"),
    }


def transcribe(media, folder):
    """Speech-to-text with local Whisper if installed (pip install openai-whisper)."""
    try:
        import whisper
    except ImportError:
        return "(audio downloaded but Whisper isn't installed: pip install openai-whisper)"
    model = whisper.load_model("base")
    result = model.transcribe(str(media))
    (folder / "transcript.txt").write_text(result["text"])
    return result["text"].strip()


# =====================================================================
# REPORT
# =====================================================================
BRIEF = {
    "1": ("Why this video", {"A": "Competitor check", "B": "Content idea for my own videos",
                             "C": "Vehicle research", "D": "Customer sent it"}),
    "2": ("Pull hardest", {"A": "Hook, script and style", "B": "Vehicles, prices, specs",
                           "C": "Comments: what viewers ask and push back on", "D": "Everything"}),
    "3": ("Audience", {"A": "Buyers", "B": "Private sellers (buy-side)",
                       "C": "Trade-in customers", "D": "Just me"}),
    "4": ("Deliverable", {"A": "Quick 5-line summary", "B": "Full breakdown",
                          "C": "Script for my own version", "D": "Customer message (Direct/Softer/NEPQ)"}),
}


def parse_brief(text):
    """'1A 2C 3B 4D 5 watch for the price claim' -> readable dict."""
    out = {}
    if not text:
        return out
    m = re.search(r"\b5\s*[:.-]?\s*(.+)$", text)
    if m:
        out["Watch for"] = m.group(1).strip()
        text = text[:m.start()]
    for num, letter in re.findall(r"([1-4])\s*([A-Da-d])", text):
        label, opts = BRIEF[num]
        out[label] = opts[letter.upper()]
    return out


def to_markdown(d):
    L = [f"# {d.get('title') or d['url']}", "",
         f"**Source:** {d['url']}  ", f"**Type:** {d['type']}"
         + (f" ({d['platform']})" if d.get("platform") else ""),
         f"**Pulled:** {datetime.now():%Y-%m-%d %H:%M}", ""]
    if d.get("brief"):
        L += ["## Research brief", ""] + [f"- **{k}:** {v}" for k, v in d["brief"].items()] + [""]

    if d["type"] == "video":
        L += ["## Quick look", ""]
        for k, label in [("creator", "Creator"), ("upload_date", "Posted"),
                         ("duration_sec", "Length (sec)"), ("views", "Views"),
                         ("likes", "Likes"), ("comments", "Comments"),
                         ("followers", "Followers")]:
            if d.get(k) is not None:
                L.append(f"- **{label}:** {d[k]}")
        L += ["", "## Description", "", d.get("description") or "(none)", ""]
        if d["chapters"]:
            L += ["## Chapters", ""] + [f"- {c['start']}s: {c['title']}" for c in d["chapters"]] + [""]
        L += ["## Transcript", "", d["transcript"], ""]
        if d.get("top_comments"):
            L += ["## Top comments", ""]
            L += [f"- ({c['likes'] or 0} likes) **{c['author']}:** {c['text']}" for c in d["top_comments"]]
            L.append("")
        if d["frames"]:
            L += ["## Frames", ""] + [f"![{f}]({f})" for f in d["frames"]] + [""]
    else:
        if d.get("description"):
            L += ["## Summary line", "", d["description"], ""]
        if d["headings"]:
            L += ["## Page outline", ""]
            L += [("  " * (int(h["level"][1]) - 1)) + f"- {h['text']}" for h in d["headings"][:80]]
            L.append("")

    f = d["facts"]
    L += ["## Key facts found", ""]
    for k, label in [("prices", "Prices"), ("vins", "VINs (check-digit verified)"),
                     ("mileage", "Mileage"), ("year_make_model", "Year/Make/Model"),
                     ("phones", "Phones"), ("emails", "Emails"), ("hashtags", "Hashtags")]:
        if f.get(k):
            L.append(f"- **{label}:** " + ", ".join(f[k][:25]))
    if not any(f.values()):
        L.append("- (nothing matched)")
    L.append("")

    if d["type"] == "website":
        if d["social_profiles"]:
            L += ["## Social profiles", ""] + [f"- {s}" for s in d["social_profiles"]] + [""]
        for i, t in enumerate(d["tables"], 1):
            L += [f"## Table {i}", ""]
            w = max(len(r) for r in t)
            rows = [r + [""] * (w - len(r)) for r in t]
            L.append("| " + " | ".join(rows[0]) + " |")
            L.append("|" + "---|" * w)
            L += ["| " + " | ".join(r) + " |" for r in rows[1:30]]
            L.append("")
        L += ["## Main text", "", d["main_text"][:20000], ""]
        L += [f"## Links ({len(d['links'])})", ""]
        L += [f"- [{l['text'] or l['url']}]({l['url']})" for l in d["links"][:150]]
        L += ["", f"## Images ({len(d['images'])})", ""] + [f"- {i}" for i in d["images"][:60]]
    return "\n".join(L) + "\n"


def slug(url):
    p = urlparse(url)
    s = re.sub(r"[^\w]+", "-", (p.netloc + p.path)).strip("-")[:70]
    return f"{datetime.now():%Y%m%d-%H%M%S}_{s or 'page'}"


def is_video(url):
    host = urlparse(url).netloc.lower()
    return any(h in host for h in VIDEO_HOSTS) and not url.rstrip("/").endswith(host)


def run(url, out_root, frames, audio, comments=False, brief=None):
    folder = out_root / slug(url)
    folder.mkdir(parents=True, exist_ok=True)
    if Path(url).exists():  # a saved .html file
        data = extract_website(Path(url).resolve().as_uri(), Path(url).read_text(errors="ignore"))
    elif is_video(url):
        data = extract_video(url, folder, frames, audio, comments)
    else:
        data = extract_website(url)
    data["brief"] = parse_brief(brief)
    (folder / "data.json").write_text(json.dumps(data, indent=2, default=str))
    (folder / "report.md").write_text(to_markdown(data))
    return folder


def main():
    ap = argparse.ArgumentParser(description="Extract everything from websites and social videos.")
    ap.add_argument("urls", nargs="+", help="web page, video link, or saved .html file")
    ap.add_argument("--frames", type=int, default=0, help="grab N still frames from a video")
    ap.add_argument("--audio", action="store_true", help="download audio and transcribe if no captions")
    ap.add_argument("--comments", action="store_true", help="pull top comments (video)")
    ap.add_argument("--brief", help='questionnaire answers, e.g. "1A 2C 3B 4D 5 the price claim"')
    ap.add_argument("--cookies", help="cookies.txt from your browser (needed for YouTube here, IG/FB reels)")
    ap.add_argument("--out", default="extracted", help="output folder (default: extracted)")
    a = ap.parse_args()

    global COOKIES
    COOKIES = a.cookies
    out = Path(a.out)
    fails = 0
    for u in a.urls:
        try:
            print(f"OK   {u}\n     -> {run(u, out, a.frames, a.audio, a.comments, a.brief)}/report.md")
        except Exception as e:  # keep going on the rest of the list
            fails += 1
            print(f"FAIL {u}\n     -> {type(e).__name__}: {e}", file=sys.stderr)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
