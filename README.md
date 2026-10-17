# ClaudeTwin

Do Claude accounts (Company + Personal), aik window, aik central memory.

- **extension/**: Chrome extension (recommended). Aapke apne Chrome mein ek click se Company aur Personal ke darmiyan switch, dono ki history ek side panel mein. Login claude.ai par normal tareeqe se hota hai, is liye "Continue with Google" bhi chalta hai.
- **app/**: Electron desktop app. Dono accounts side by side, limit khatam hote hi doosre par auto-switch, aur dono ki history aik panel mein. Google is app ke andar "Sign in with Google" block karta hai, is liye Google wale accounts ke liye extension use karein.
- **connector/**: Remote MCP server. Dono accounts isse connect hote hain, is liye handoff, history aur search dono taraf available rehte hain.
- **plugin/**: Claude Code plugin. Isme connector ki setting aur `claudetwin` skill dono hain. Skill Claude ko batati hai ke handoff kab save karna hai aur switch ke baad context kaise uthana hai.

```
 ┌──────────── ClaudeTwin app ────────────┐
 │  [Company ●]  [Personal ●]   ⏱ history │
 │   claude.ai          claude.ai          │
 └─────┬──────────────────────┬────────────┘
       │ prompts/replies log  │
       ▼                      ▼
   ┌──────────── claudetwin connector ────────────┐
   │ save_handoff · get_handoff · search · recent │
   └──────────────────────────────────────────────┘
       ▲  custom connector   ▲  custom connector
   Company account        Personal account
```

---

## 1. Connector chalayein

```bash
cd connector
npm install
cp .env.example .env    # dono tokens generate karke daalein
export $(cat .env | xargs) && npm start
```

claude.ai ko connector tak pohanchne ke liye **public HTTPS URL** chahiye. Do tareeqe:

- **Jaldi test (apni machine se):** `cloudflared tunnel --url http://localhost:8787`. Ye aik `https://xxxx.trycloudflare.com` URL dega. Har dafa ye URL badal jata hai, is liye ye sirf test ke liye hai.
- **Hamesha ke liye:** `connector/Dockerfile` ko Render, Railway ya Fly.io par deploy karein. `/data` par aik persistent volume lagayein aur dono tokens env mein daalein.

Check: `https://<host>/health` par `{"ok":true}` aana chahiye.

## 2. Dono accounts mein connector add karein

claude.ai → Settings → Connectors → **Add custom connector**

| Account  | URL |
|----------|-----|
| Company  | `https://<host>/mcp/<CLAUDETWIN_WORK_TOKEN>` |
| Personal | `https://<host>/mcp/<CLAUDETWIN_PERSONAL_TOKEN>` |

Token URL ke andar hai, is liye URL kisi ko na dein. Company account Team ya Enterprise plan par ho to custom connector ke liye admin ki ijazat lag sakti hai.

## 3. Claude Code mein install karein

Claude Code ke andar ye do commands chalayein:

```
/plugin marketplace add deadlydiamond/claudetwin
/plugin install claudetwin@claudetwin
```

Install ke baad `/plugin configure claudetwin@claudetwin` se do cheezein set karein:
- **connector_url**: `https://<host>` (aakhir mein `/` na lagayein)
- **account_token**: is machine par jo account use hota hai uska token. Office laptop par work token, ghar par personal token.

Terminal se ye aik line kaafi hai:

```bash
claude plugin marketplace add deadlydiamond/claudetwin && \
claude plugin install claudetwin@claudetwin --config connector_url=https://<host> --config account_token=<TOKEN>
```

Check karne ke liye Claude Code mein `/mcp` chalayein. Wahan `claudetwin` connected dikhna chahiye. Phir kahein "claudetwin list_recent dikhao".

Agar sirf connector chahiye, plugin nahi:

```bash
claude mcp add --transport http --scope user claudetwin https://<host>/mcp/<TOKEN>
```

## 3b. claude.ai mein skill add karein (dono accounts mein)

`plugin/skills/claudetwin` folder ko zip karein aur claude.ai → Settings → Capabilities → Skills mein upload karein.

## 4. Chrome extension (recommended)

Install (abhi Chrome Web Store par nahi hai):

1. Chrome mein `chrome://extensions` kholein aur upar daayen **Developer mode** on karein.
2. **Load unpacked** dabayein aur repo ka `extension/` folder chunein.
3. Toolbar mein ClaudeTwin ko pin kar dein.

Pehli dafa:

1. ClaudeTwin icon par click karein. Wo poochega ke claude.ai mein abhi kaunsa account login hai. Sahi wala chunein.
2. Doosre account ke button par click karein. claude.ai logged out khulega. Wahan us account se normal login karein, Google bhi chalega.
3. Bas. Ab icon se, ya **Alt+Shift+S** se, dono ke darmiyan switch karein. Dobara login nahi karna padta.

Connector ke liye icon → **Settings** mein connector URL aur dono tokens daalein, phir **Connection check karein**. Connector ke baghair bhi switch chalta hai. Connector ho to:

- Dono accounts ke prompts aur jawab connector mein save hote hain, aur **History** side panel mein ek jagah search hote hain.
- Switch karte waqt aakhri prompt doosre account ke composer mein paste ho jata hai. Send aap khud karte hain.
- Limit ka message dikhe to icon par `!` aata hai aur popup switch ka mashwara deta hai. Switch hamesha aap khud karte hain.

Kaise kaam karta hai: har account ki claude.ai cookies (login) `chrome.storage.local` mein alag rakhi jaati hain, aur switch par cookie jar badal diya jata hai. Ye login sirf aapke computer par, isi Chrome profile mein rehte hain, kahin bheje nahi jaate. Jis kisi ke paas aapke Chrome profile ki files tak rasai ho, wo inhein parh sakta hai, jaise Chrome ki apni cookies.

## 4b. Electron app

Google wale accounts is app mein login nahi kar sakte, kyunke Google app ke andar bani browser windows mein sign-in rokta hai. Email + code se login karne wale accounts ke liye ye chalti hai.

```bash
cd app
npm install
npm start
```

Pehli dafa dono tabs mein apne apne account se login karein. Har tab ka session alag aur permanent hai.

Connector ko app se jorne ke liye ye file banayein (aapke tokens repo mein na jaayen, is liye yahan):

- macOS: `~/Library/Application Support/ClaudeTwin/config.json`
- Windows: `%APPDATA%\ClaudeTwin\config.json`
- Linux: `~/.config/ClaudeTwin/config.json`

```json
{
  "connector": {
    "url": "https://<host>",
    "tokens": { "work": "<WORK_TOKEN>", "personal": "<PERSONAL_TOKEN>" },
    "logMessages": true
  }
}
```

Installer banana ho to: `npm run dist` (mac par .dmg, Windows par .exe, Linux par AppImage).

### App mein kya kya hai

| Cheez | Kaam |
|---|---|
| Auto-switch | Limit ka message nazar aate hi doosre account par switch, aur reset ka waqt tab par countdown ke saath |
| Prompt carry | Aakhri prompt doosre account mein paste. Connector laga ho to saath mein hidayat bhi jaati hai ke pehle `get_handoff` se context lo |
| Auto-send | On ho to carry kiya hua prompt khud send ho jata hai (default off, taake aap pehle dekh lein) |
| History (⌘/Ctrl + H) | Dono accounts ki chats aur handoffs aik jagah. Search karein, chat kholein, ya text paste karein |
| Split view (⌘/Ctrl + \\) | Dono accounts side by side |
| ⌘/Ctrl + 1 / 2 | Account switch |
| Tab par right-click | Account ko khud limited ya available mark karein |

## Ehtiyat

- **Detection DOM par chalti hai.** claude.ai apna UI badle to limit ya reply detect hona ruk sakta hai. Us surat mein `config.json` mein `limitPatterns` ya `assistantSelectors` update karein. Tab par right-click se manual switch hamesha kaam karega.
- **Company data.** Default `shared` mode mein Personal account Company ki history dekh sakta hai. Agar company policy ijazat nahi deti to `CLAUDETWIN_MODE=isolated` rakhein. Is mode mein sirf woh handoff doosri taraf jaate hain jo khud "shared" ke taur par save kiye jaayen.
- **Sab ke liye release.** Public karne se pehle Anthropic ki Consumer Terms aur Usage Policy dekh lein, khaas taur par automated account switching ke hawale se.
- Last prompt sirf memory mein rehta hai, disk par nahi likha jata. History sirf aapke apne connector par jaati hai.

## Tests

```bash
cd connector && npm test   # MCP end-to-end, shared + isolated
cd app && npm test         # reset-time parser
cd extension && npm test   # account switching (cookie swap)
```
