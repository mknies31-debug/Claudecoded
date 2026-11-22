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
    python extract.py "<video>" --comments --frames 6 --brief "1A 2C 3B 4D 5 the price claim"

`--brief` takes your answers to QUESTIONNAIRE.md and puts them at the top of the report.
`--comments` pulls the top comments (works best on YouTube).
`--cookies cookies.txt` passes your browser login (see Limits).

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
- **YouTube blocks cloud servers** ("confirm you're not a bot"). It works from your own
  computer, or here with `--cookies` (export cookies.txt from your browser with a
  "Get cookies.txt" extension while logged in to YouTube).
- Instagram and Facebook often need a login for reels (`--cookies` again). Private posts won't work.
- TikTok works with no login.
- Sites that build the page with JavaScript may come back thin. Save the page
  (Ctrl+S) and run `python extract.py saved-page.html` instead.
- No captions? `--audio` transcribes with Whisper (`pip install openai-whisper`).
