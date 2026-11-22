# North Star Extractor

Pulls everything useful out of a web page or a social video and saves a clean report.

## Setup (one time)
    pip install -r requirements.txt
ffmpeg is needed for still frames.

## Use
    python extract.py https://some-dealer.com/listing/123
    python extract.py "https://www.youtube.com/watch?v=..." --frames 6
    python extract.py "https://www.tiktok.com/@user/video/..." --audio
    python extract.py link1 link2 link3        # a whole batch

Each link gets a folder in `extracted/` with:
- `report.md` - easy to read summary
- `data.json` - everything, for other tools
- `frame_01.jpg ...` - stills from the video (with --frames)

## What it grabs
- **Websites:** title, description, outline, main text, prices, VINs (check-digit verified),
  mileage, year/make/model, phones, emails, social links, tables, schema.org data, links, images.
- **Videos (YouTube, TikTok, Instagram, Facebook):** title, creator, date, views, likes,
  description, hashtags, chapters, captions as a transcript, still frames.

## Limits
- Instagram and Facebook often need a login for reels. Private posts won't work.
- Sites that build the page with JavaScript may come back thin. Save the page
  (Ctrl+S) and run `python extract.py saved-page.html` instead.
- No captions? `--audio` transcribes with Whisper (`pip install openai-whisper`).
