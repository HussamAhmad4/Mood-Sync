# Mood Sync 🎧

Mood Sync is a frontend-only web application that generates fresh, mood-based music playlists with audio previews.  
Users must create an account to generate and share playlists, while visitors can still explore what the site does.

This project was built using **HTML, CSS, and JavaScript only**, with a focus on usability, playlist freshness, and clean UI design.

---

## Features

- 🎭 **Mood-based playlists**
  - Available moods: Happy, Sad, Chill, Mad, Hype, Sleep, Focus
  - Each playlist contains **10 tracks**
  - Songs do **not overlap between moods**

- 🔁 **Fresh playlists**
  - Playlists are randomized every time
  - Previously generated tracks are avoided to encourage revisits

- 🔐 **User authentication**
  - Users must sign up or log in to generate and share playlists
  - Authentication is implemented client-side using `localStorage`

- 🔗 **Playlist sharing**
  - Logged-in users can share playlists using a unique link
  - Shared playlists are viewable by anyone with the link

- 🎵 **Song previews**
  - Uses the **iTunes Search API** to provide 30-second audio previews
  - Album artwork and track metadata included

- 🛡️ **Fail-safe playlist system**
  - Primary: live API results
  - Backup: cached results stored locally
  - Offline fallback prevents the app from breaking if the API fails

- 🌗 **Dark / Light mode**
  - User-toggleable theme
  - Saved between sessions

- 📊 **Playlist counter**
  - Displays total playlists generated
  - Displays playlists generated per user

---

## Technology Stack

- **HTML** – semantic structure
- **CSS** – custom styling, responsive layout, dark/light themes
- **JavaScript (Vanilla)** – app logic, authentication, API calls
- **iTunes Search API** – music data and previews (no API key required)

---



