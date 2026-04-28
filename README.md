# Let's Eat TikTok

Paste a TikTok (or YouTube / direct) recipe video link, preview/play it in the app, then run AI analysis to detect:

- Whether the video contains food content
- Ingredient list with estimated quantities
- A structured, editable recipe draft

The analysis is frame-first (visual evidence is prioritized) and transcript-assisted (audio transcription is used as secondary context).

## Setup

1. In `.env`, set:

   `GEMINI_API_KEY=your_key_here`
   
   Optional for Shop and Macros:
   
   `GOOGLE_MAPS_API_KEY=`
   
   `PLACES_API_KEY=`
   
   `GROCERY_PRICE_API_KEY=`
   
   `USDA_API_KEY=`

2. Install dependencies:

   `npm install`

3. Run:

   `npm start`

4. Open:

   `http://localhost:3000`

## Notes

- TikTok links are downloaded via yt-dlp and previewed using TikTok's embed player.
- YouTube links are previewed in an embedded player.
- Direct video URLs are played in an HTML5 video player.
- The backend extracts frames and audio locally, sends them to the model, and returns structured JSON.
