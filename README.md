# SayVah public website

A responsive static information / onboarding website designed to visually match the SayVah Flutter app.

## Files
- `index.html` — website content
- `styles.css` — responsive styling
- `script.js` — mobile menu, tabs, guides, FAQs and contact mailto form
- `assets/` — real SayVah screenshots supplied for the site

## Quick launch
Upload the contents of this folder to your web hosting public directory (`public_html`, GitHub Pages, Netlify, Firebase Hosting, etc.). No build step is required.

## Change before publishing
1. In `script.js`, update `SUPPORT_EMAIL`.
2. In `index.html`, replace the `#` App Store and Google Play links with the live store URLs.
3. Replace the `#` Privacy Policy and Terms links when those pages are available.
4. Update the visible statistics whenever required, or later connect them to Firebase.
5. Replace the placeholder sevadaar cards with approved public profiles only.

## Future phase
The public website can later be connected to Firebase for live stats, approved sevadaar profiles, public requests, FAQ/Q&A content, announcements and eventually web account login.
