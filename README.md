# Wiggle Studio

A private, browser-based stop-motion studio designed for children aged 4–5. Children can photograph a scene, make simple frame edits, preview the animation, and download it as an animated GIF. Photos stay in the browser.

## Requirements

- Node.js 22 or later
- A modern browser with camera access

## Development

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access works on `localhost`; testing from another tablet requires an HTTPS development URL.

Firefox also requires a secure context for camera access. Use the GitHub Pages HTTPS URL, `localhost`, or an HTTPS development tunnel—not a plain `http://192.168.x.x` LAN address.

Other commands:

```sh
npm test        # JavaScript syntax checks
npm run build   # Production build in dist/
npm run preview # Serve the production build locally
```

## Project structure

```text
.
├── .github/workflows/deploy-pages.yml  # CI and GitHub Pages deployment
├── public/                             # Files copied directly to dist/
│   ├── favicon.svg
│   ├── site.webmanifest
│   └── robots.txt
├── src/
│   ├── app.js                          # Camera and editor behaviour
│   ├── gif-encoder.js                  # Local animated GIF encoder
│   └── styles.css                      # Responsive application design
├── index.html                          # Vite application entry
├── package.json                        # Scripts and dependency metadata
└── vite.config.js                      # Production build configuration
```

## GitHub Pages deployment

The workflow builds and deploys every push to `main` and can also be run manually.

In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. Push to `main`; the workflow will run checks, create the Vite production build, and deploy `dist/`.

Vite uses relative production asset paths, so the site works from both a project URL such as `https://username.github.io/repository/` and a custom domain.
