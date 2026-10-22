# Mt. SAC TERC Schedule Portal

Schedule web app for the Technology Education Resource Center (TERC).

**Live Demo**: https://mtsac-terc-preproduction1.robonxt.xyz/
**Backup Link**: https://robonxt.github.io/web-mtsac-terc-preproduction1/

> Note: Created by humans, tool-assisted by AI.

---

## Overview

This repository contains the working prototype and frontend code for the TERC schedule portal. It can be hosted as-is, embedded into an existing page template, or used as a functional reference if rebuilding inside the college CMS.

---

## Files

- **`index.html`** — Main entry page and DOM structure.
- **`styles.css`** — All CSS and responsive layout rules.
- **`app.js`** — UI logic (search, department/day filtering, modals, keyboard focus handling).
- **`data.js`** — Fetches Google Sheets CSV data, calculates shift hours, and handles local caching.
- **`terc-badge.png`** — TERC logo graphic.
- **`favicon_io/`** — Favicon assets.

---

## Technical Notes

- **Tech Stack**: Plain HTML, CSS, and JavaScript. No build tools or package managers required.
- **Data Source**: Pulls from published Google Sheets CSV links defined at the top of `data.js`.
- **Accessibility**: Baseline accessibility features included (skip link, modal focus trapping, aria labels) for your team's review and testing.
- **Integration**: Intended as a working reference for the web team or vendor to adapt, embed, or rebuild to match college web standards.
