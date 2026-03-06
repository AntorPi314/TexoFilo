# Texofilo

<div align="center">
  <img src="https://img.shields.io/badge/status-live-brightgreen?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img src="https://img.shields.io/badge/built%20with-Firebase-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/login-optional-purple?style=flat-square" />
</div>

<br />

> **Share text & files instantly — no login required. Optional accounts unlock extra features.**

Texofilo is a minimalist real-time notepad and file sharing web app. Pick any URL path, start typing, and anyone with that link can instantly collaborate.

No accounts are required to start — simply open a link and begin editing.  
Users who choose to sign in can claim ownership of pads and manage additional settings.

**Live →** https://antorpi314.github.io/TexoFilo/

---

# Features

### Real-time Notepad
Collaborative text editor that auto-saves as you type. Changes sync instantly across all open sessions using Firebase Realtime Database.

### File Sharing
Upload up to **5 files per pad**. Files are stored securely and automatically deleted after **30 days**.

### Gallery
Add direct image or video URLs to build a shared visual gallery using a masonry grid layout.

### Secret URLs
Pads are only accessible to people who know the exact URL path. There is no indexing or public discovery.

### Viewer Presence
See how many people have viewed the pad since the last edit, updated live.

### Read-Only Mode
Pad owners can lock a pad to prevent edits from other users.

### Optional Login & Ownership
Users can sign in with **Google** or **Email/Password** to claim ownership of a pad and manage its settings.

### Admin Panel
Administrative interface for managing pads, users, and storage.

### Fully Responsive
Works smoothly on both desktop and mobile browsers.

### QR Code Sharing
Generate a QR code for any pad to share the link instantly offline.

---

# Screenshots

![Screenshot](https://raw.githubusercontent.com/AntorPi314/TexoFilo/main/img/0.png)

![Screenshot](https://raw.githubusercontent.com/AntorPi314/TexoFilo/main/img/1.png)

![Screenshot](https://raw.githubusercontent.com/AntorPi314/TexoFilo/main/img/2.png)

![Screenshot](https://raw.githubusercontent.com/AntorPi314/TexoFilo/main/img/3.png)

![Screenshot](https://raw.githubusercontent.com/AntorPi314/TexoFilo/main/img/4.png)

---

# Getting Started

## 1. Set up Firebase

1. Go to https://console.firebase.google.com/
2. Create a new project.
3. Enable **Realtime Database**.
4. Enable **Authentication** and turn on:
   - Google
   - Email/Password
5. Copy your Firebase configuration and update:

```
js/config.js
```

```javascript
const firebaseConfig = {
  apiKey           : "YOUR_API_KEY",
  authDomain       : "YOUR_PROJECT.firebaseapp.com",
  databaseURL      : "https://YOUR_PROJECT-default-rtdb.REGION.firebasedatabase.app",
  projectId        : "YOUR_PROJECT",
  storageBucket    : "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId            : "YOUR_APP_ID"
};
```

---

# 2. Set up Cloudflare Worker (File Uploads)

File uploads are handled by a Cloudflare Worker that acts as a proxy/storage endpoint.

Deploy your own worker and update the following constant in:

```
js/config.js
```

```javascript
export const WORKER_URL = "https://your-worker.your-subdomain.workers.dev/";
```

---

# 3. Firebase Security Rules (Recommended)

```json
{
  "rules": {
    "pads": {
      ".read": true,
      "$padPath": {
        ".write": true
      }
    },
    "admin": {
      "settings": {
        ".read": true,
        ".write": false
      },
      "$other": {
        ".read": false,
        ".write": false
      }
    }
  }
}
```

---

# License

This project is licensed under the **MIT License**.
