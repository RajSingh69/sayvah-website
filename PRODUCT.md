# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Everyone equally, with no single priority audience:
- people in the local community who need practical help, and their families;
- volunteers (sevadaars) who want to give time and skills;
- Gurdwaras and community organisations who want to run or support seva through SayVah.

## Product Purpose
SayVah is a community support app, inspired by the Sikh principle of seva (selfless service), that connects people who need practical everyday help with local volunteers willing to give it. Requests, chat and progress stay together in the app. This website explains SayVah to people who have never heard of it, sends them to the app (iOS, Android, or the PC web app), and collects sign-ups from volunteers, people who may need support, and Gurdwaras/organisations.

## Positioning
Local, seva-based practical help with safety built into how people connect: admin approval of connections, visible profiles, reporting and blocking, in-app chat, and optional Gurdwara/organisation involvement. Open to anyone; you do not need to be Sikh or know Sikh terms.

## Operating Context
- The app launched officially on 1 September 2026 and is rolling out area by area (first areas around Camberley/Frimley, Surrey).
- Available on iOS (App Store), Android (Google Play) and on PC at https://seva-app-b6a18.web.app.
- Site is static HTML/CSS/JS on GitHub Pages at sayvah.co.uk; the Admin Hub lives at /admin/ and the privacy page at /privacy/.
- The sign-up form writes to Firestore `launchSignups`; live active areas load from Firestore `locations`.

## Capabilities and Constraints
- Not an emergency service; the site must say so plainly.
- Keep the sign-up form (volunteer, may use for support, Gurdwara/organisation, keep me updated) and its Firestore logic.
- Do not change admin/, privacy/, store links, or the PC app links.

## Brand Commitments
- Name: SayVah. Strapline in use: "Seva made simple".
- Terms: seva, sevadaar, sangat, Gurdwara, explained in plain English for newcomers.

## Evidence on Hand
- Real app screenshots: assets/home-overview.jpg, assets/home-stats.jpg, assets/home-community.jpg, assets/requests.jpg, assets/explore.jpg.
- Real live community figures (members, active helpers, completed seva) may be shown.
- No real testimonials, member photos or public sevadaar profiles yet. Do not invent people, quotes, profiles or numbers.

## Product Principles
- Plain words for people who have never heard of seva or the app.
- Safety is shown through how the app works, not through slogans.
- Real over impressive: show real screenshots and real numbers, never placeholders.
- Every route ends in an action: download, use on PC, or sign up.
