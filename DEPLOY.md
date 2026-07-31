# העלאה לאוויר — Amora Studio

## המהיר ביותר: Vercel CLI (ללא GitHub)

פורס את התיקייה ישירות. לא נוגע בריפו, לא דורש הרשאות.

```bash
npm i -g vercel
cd amora                      # התיקייה שחילצת מה-ZIP
vercel login
vercel                        # תצוגה מקדימה — קישור זמני לבדיקה
vercel --prod                 # לייב
```

בפעם הראשונה יישאלו כמה שאלות. התשובות:

| שאלה | תשובה |
| --- | --- |
| Set up and deploy? | **Y** |
| Which scope? | החשבון שלך |
| Link to existing project? | **N** |
| Project name? | `amora` |
| In which directory is your code? | `./` (Enter) |
| Want to modify settings? | **N** — `vercel.json` כבר מגדיר הכל |

`.vercelignore` מוודא ש-`project/`, `chats/`, `docs/` ו-`tools/` לא נפרסים.

## אחרי הפריסה הראשונה — חיבור הדומיין

```bash
vercel domains ls                       # מה כבר בחשבון
vercel domains add example.co.il amora  # חיבור לפרויקט
```

או בממשק: Project → Settings → Domains.

**ואז, מיד אחרי שיש כתובת קבועה:**

```bash
tools/set-site-url.sh https://example.co.il
tools/check.sh          # חייב לצאת 0
vercel --prod
```

`SITE_URL` מופיע ב-canonical, ב-og:url, ב-JSON-LD וב-sitemap. עד שתריץ את זה
שיתוף בוואטסאפ לא יציג תמונה ו-Google לא יבין את הסכמה.

## חיבור הטופס ל-Supabase

1. Supabase → SQL Editor → הדבק את `docs/supabase-leads.sql` → Run.
2. Settings → API → העתק **Project URL** ו-**anon public key**.
3. ב-`assets/js/main.js`, בראש `CONFIG`:

```js
supabaseUrl: 'https://xxxxx.supabase.co',
supabaseKey: 'eyJhbG...',
```

4. `vercel --prod`

הלידים יופיעו ב-Table Editor → `leads`. מפתח ה-anon הוא ציבורי בכוונת התכנון —
מדיניות ה-RLS שבקובץ מתירה **INSERT בלבד**, כך שאיש לא יכול לקרוא איתו לידים.

להתראה במייל על כל ליד: Database → Webhooks → INSERT על `leads`.

## חיבור GitHub לפריסה אוטומטית (לא חובה)

אם תרצה שכל push יעדכן את האתר:

```bash
cd amora
git remote add origin https://github.com/Regaflash/amora.git
git fetch origin
git merge origin/main --allow-unrelated-histories -m "merge photo library"
git push -u origin main
```

הריפו מכיל כבר את ספריית התמונות שהעלית; המיזוג משמר אותה.
אחר כך ב-Vercel: Add New → Project → Import `Regaflash/amora`.

**שים לב:** 86 קבצי התמונות יושבים בשורש הריפו. הם לא ייפרסו (`.vercelignore`
לא מכסה אותם — כדאי להעביר אותם ל-`source-photos/` ולהוסיף את התיקייה לקובץ).

## רשימת בדיקה לפני לייב

- [ ] `tools/set-site-url.sh` הורץ עם הדומיין האמיתי
- [ ] `tools/check.sh` יוצא 0
- [ ] הטופס מחובר (Supabase או אחר) ונבדק בשליחה אמיתית
- [ ] `accessibility.html` ו-`privacy.html` — הושלמו ואושרו ע"י עו"ד
- [ ] נבדק בטלפון אמיתי, לא רק בהקטנת חלון
