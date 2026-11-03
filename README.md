# Galaxy AI

A free, installable AI chat app (PWA) with a deep-space look. It streams answers live, remembers your chats on your device, and works on Android, iPhone and desktop.

- **Frontend:** one HTML file, no build step
- **Backend:** one Vercel Edge Function (free hosting) that hides your API key
- **AI:** Google Gemini free tier by default. Switch to Groq, OpenRouter or GitHub Models by changing environment variables only

## Folder structure

```
galaxy-ai/
├── api/
│   └── chat.js          Backend: streaming proxy, rate limit, system prompt
├── public/
│   ├── index.html       The whole app (HTML + CSS + JS)
│   ├── manifest.json    Makes it installable
│   ├── sw.js            Service worker (never caches /api/)
│   ├── icon.svg         Logo
│   └── icons/           PNG icons (192, 512, maskable 512)
├── package.json
├── vercel.json
└── README.md
```

---

## Step 1: Get a free Gemini API key

1. Open **https://aistudio.google.com/apikey** and sign in with your Google account.
2. Click **Create API key**.
3. Copy the key and keep it private. Never paste it into the app code, a chat, or GitHub.

## Step 2: Put the project on GitHub

1. Create a free account at **https://github.com** if you do not have one.
2. Click **New repository**, name it `galaxy-ai`, keep it **Private** (or Public, both work), and create it.
3. Upload all the files, keeping the folders exactly as shown above.
   - Easiest way: on the new repository page click **uploading an existing file**, then drag in the whole contents of the `galaxy-ai` folder.
   - Or with Git on a computer:
     ```bash
     cd galaxy-ai
     git init
     git add .
     git commit -m "Galaxy AI"
     git branch -M main
     git remote add origin https://github.com/YOUR-NAME/galaxy-ai.git
     git push -u origin main
     ```

## Step 3: Deploy on Vercel (free)

1. Go to **https://vercel.com** and sign up with your GitHub account.
2. Click **Add New → Project** and pick your `galaxy-ai` repository.
3. Leave **Framework Preset** as **Other**. Do not change the build settings.
4. Open **Environment Variables** and add:

   | Name | Value |
   |------|-------|
   | `API_KEY` | your Gemini key from Step 1 |

   Optional ones (you can add them later):

   | Name | Default | Meaning |
   |------|---------|---------|
   | `API_BASE` | `https://generativelanguage.googleapis.com/v1beta/openai` | Provider address |
   | `MODEL` | `gemini-3.8-flash` | Model name |
   | `HOURLY_LIMIT` | `40` | Messages per hour for each visitor (IP address) |

5. Click **Deploy**. After about a minute you get a link like `https://galaxy-ai-yourname.vercel.app`.

**Changed a variable later?** Go to Project → Settings → Environment Variables, edit it, then Deployments → the latest one → **Redeploy**. Variables only apply to new deployments.

## Step 4: Install on your phone

**Android (Chrome):** open your link, tap the menu (three dots), then **Install app** (or **Add to Home screen**). You can also tap **Install app** inside Galaxy AI's side menu.

**iPhone (Safari only):** open your link in Safari, tap the **Share** button, then **Add to Home Screen**.

Galaxy AI then opens full screen like a normal app.

---

## How to switch AI provider

Only environment variables change. No code changes. Redeploy after editing.

**Google Gemini (default)**
```
API_BASE = https://generativelanguage.googleapis.com/v1beta/openai
MODEL    = gemini-3.8-flash
```
Key from https://aistudio.google.com/apikey

**Groq**
```
API_BASE = https://api.groq.com/openai/v1
MODEL    = (pick a current model from the Groq console, for example a Llama model)
```
Key from https://console.groq.com/keys

**OpenRouter**
```
API_BASE = https://openrouter.ai/api/v1
MODEL    = (a model whose name ends in ":free", copied from openrouter.ai/models)
```
Key from https://openrouter.ai/keys

**GitHub Models**
```
API_BASE = https://models.github.ai/inference
MODEL    = (a model id from the GitHub Models catalog, for example openai/gpt-4.1-mini)
```
Key: a GitHub personal access token with the models permission, created in your own GitHub settings.

Model names change often. If you see "The model was not found", copy a current model name from your provider's website into `MODEL`. Image upload only works if the chosen model can read images.

---

## Optional: free Android APK with PWABuilder

1. Deploy first (Step 3). Your app must be on an `https://` link.
2. Open **https://www.pwabuilder.com**, paste your link, and click **Start**.
3. Wait for the report, then click **Package for stores → Android**.
4. Choose the options and download the zip. It contains an `.apk` you can install on a phone (you may need to allow "install unknown apps"), and an `.aab` file for Google Play.
5. Keep the signing key file from the zip safe. You need it for future updates.

Publishing on Google Play needs a one-time paid developer account. A plain APK for your own use is free.

---

## Free-tier notes (read this)

- **Limits change.** Free limits for Gemini, Groq, OpenRouter and GitHub Models are set by those companies and change over time. Check the limits page of your provider. They are usually counted per minute and per day.
- **Free key, shared by all visitors.** Everyone using your app shares your one key's free quota. If you share the link widely, the quota can run out and users will see "The AI provider free limit was reached."
- **Rate limit is best effort.** `HOURLY_LIMIT` is kept in memory on the server. Vercel may run several copies and restart them, so the count can reset. It stops casual abuse but is not a hard guarantee. For a strict limit, store counts in a database such as Upstash Redis or Vercel KV.
- **Privacy on free tiers.** Some providers may use free-tier requests to improve their products. Read your provider's terms and do not send private or sensitive data.
- **Vercel Hobby plan** is free for personal, non-commercial projects and has usage limits. See vercel.com/pricing.
- **Chats stay on the device.** History is saved in your browser's localStorage. Clearing browser data deletes it, and chats do not sync between devices.
- **Images** are resized to 1024 px. Only the 3 newest images are sent with each request to save quota.
- **Voice input** uses your browser's speech service. It works best in Chrome on Android and desktop. On iPhone it is limited. Read aloud depends on the voices installed on your device.

## Troubleshooting

| Message | Fix |
|---------|-----|
| "The server has no API_KEY set" | Add `API_KEY` in Vercel and redeploy |
| "The AI provider rejected the API key" | The key is wrong or disabled. Create a new one |
| "The model was not found" | Fix `MODEL` / `API_BASE` |
| "free limit was reached" | Wait, or switch provider |
| "The chat service was not found" (testing locally) | Run `npx vercel dev` instead of opening the file |
| Install option missing | The site needs `https://`. Vercel links already have it |

## Run locally (optional)

```bash
npm i -g vercel
cd galaxy-ai
echo "API_KEY=your-key-here" > .env.local
vercel dev
```
Then open http://localhost:3000. Never commit `.env.local`.

## Security

- The API key lives only in Vercel environment variables. It is never in the frontend.
- Chat text is HTML-escaped before display, so replies cannot inject scripts.
- Never use leaked or shared keys. Each person should create their own key on the provider's official website.

License: MIT
