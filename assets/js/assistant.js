/* ==========================================================================
   Amora Studio — עוזר האתר / site assistant
   Two tiers, in this order:
     1. A scripted knowledge base built only from what index.html actually says.
        Works offline, with no key and no backend.
     2. An optional Supabase Edge Function that asks Claude for free text.
        If it is absent, slow, or broken, tier 1 answers instead and the
        visitor never sees an error.
   Same house rules as main.js: one IIFE, var, no arrow functions, no template
   literals, defensive guards everywhere.
   ========================================================================== */

(function () {
  'use strict';

  var CONFIG = {
    // Set to false to remove the assistant without touching the markup.
    enabled: true,

    // --- Tier 2 (optional) -------------------------------------------------
    // The anon key is public by design — the Edge Function holds the Anthropic
    // key server-side and the browser never sees it. Leave remoteEnabled false
    // until supabase/functions/assistant is actually deployed; tier 1 is a
    // complete feature on its own.
    remoteEnabled: false,
    supabaseUrl: 'https://dkejuaildigikufrdiru.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZWp1YWlsZGlnaWt1ZnJkaXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU0ODkxODgsImV4cCI6MjEwMTA2NTE4OH0.rN244HfLzw7iI2J9uF9lmRoW96aMAN117fVWvlCDWLE',
    assistantPath: '/functions/v1/assistant',
    remoteTimeout: 14000,

    // --- Escape hatches to a human ----------------------------------------
    whatsapp: '972503662699',
    phone: '050-3662699',
    // Dial string, kept apart from the label. CONFIG.phone is what a visitor
    // reads; this is what a phone actually dials, and the leading trunk 0 does
    // not connect from a foreign network.
    tel: '+972503662699',
    formHash: '#contact'
  };

  if (!CONFIG.enabled) return;

  var SHEET_QUERY = '(max-width: 760px)';
  var MAX_INPUT = 300;          // characters accepted from the visitor
  var MAX_REPLY = 1600;         // characters accepted back from the model
  var HISTORY_TURNS = 3;        // pairs of messages sent to tier 2
  var STRONG = 4;               // local score that answers without the network
  var WEAK = 3;                 // local score good enough as a fallback answer
  var THINK_MS = 260;           // small delay so a scripted reply reads as one

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var sheetQuery = window.matchMedia(SHEET_QUERY);

  /* ============================================================ tier 1 === */

  /* Every answer below is a restatement of copy that already exists in
     index.html (the FAQ, the services cards, the process steps and the about
     section). Nothing here is invented: no prices, no availability promises,
     no counts, no credentials. Anything outside this set routes to a human. */

  var KB = [
    {
      id: 'price',
      chip: 'מה המחיר?',
      keys: ['מחיר', 'מחירון', 'עלות', 'עלויות', 'כמה עולה', 'כמה עולות', 'כמה זה עולה', 'כמה כסף', 'תקציב', 'הצעת מחיר', 'כמה תעלה', 'שקל', 'עולה לי'],
      a: 'אין לנו מחירון קבוע — כל חתונה נבנית אחרת: מספר שעות, מספר צלמים, לוקיישנים.\n' +
         'השאירו פרטים ונשמח לשלוח הצעה מותאמת עוד באותו יום.',
      actions: ['cost', 'form', 'wa'],
      next: ['package', 'hours', 'availability']
    },
    {
      id: 'delivery',
      chip: 'תוך כמה זמן מקבלים את החומרים?',
      keys: ['כמה זמן', 'מתי נקבל', 'אספקה', 'תוך כמה', 'מתי מקבלים', 'זמן עריכה', 'מתי הסרט', 'מתי התמונות', 'מתי הגלריה'],
      a: 'גלריית תמונות ראשונה תוך 7 ימים.\n' +
         'הגלריה המלאה והסרט תוך 30 יום מהאירוע.\n' +
         'אלבום מודפס — עוד שבועיים אחרי שאתם מאשרים את הבחירה.',
      next: ['package', 'film', 'album']
    },
    {
      id: 'area',
      chip: 'אתם מגיעים לכל הארץ?',
      keys: ['מגיעים', 'אזור', 'איפה אתם', 'כל הארץ', 'צפון', 'דרום', 'גליל', 'אילת', 'ירושלים', 'מרכז', 'נסיעות', 'נסיעה', 'תל אביב', 'רחוק'],
      a: 'כן. הבסיס שלנו בתל אביב ואנחנו מצלמים מהגליל ועד אילת, בלי תוספת נסיעות באזור המרכז.',
      next: ['availability', 'package']
    },
    {
      id: 'photographers',
      chip: 'יש צלם שני?',
      // 'הצלמים', not bare 'צלמים': the bare form silently stole "אתם מצלמים
      // גם את ההכנות" from prep in simulation (מצלמים contains צלמימ).
      keys: ['צלם שני', 'שני צלמים', 'כמה צלמים', 'צוות', 'מי מצלם', 'צלמת', 'הצלם', 'הצלמים', 'עוד צלם', 'צלם נוסף'],
      a: 'בחתונה מלאה תמיד. אחד על הסטילס ואחד על הווידאו, ובחופה ובריקודים שניהם על הזוג משתי זוויות.',
      next: ['package', 'people', 'gear']
    },
    {
      id: 'package',
      chip: 'מה כוללת החבילה?',
      // חבילות/חבילת: the plural and construct forms never contain חבילה, and
      // the widget's own chip subject scored 0 on "מה יש בחבילות".
      keys: ['מה כולל', 'כוללת', 'חבילה', 'חבילות', 'חבילת', 'מה מקבלים', 'מה נכנס', 'מה יש בפנים', 'כלול'],
      a: 'כיסוי מלא של היום, סטילס ווידאו, עריכת צבע לכל תמונה נבחרת, גלריה דיגיטלית לשיתוף, ' +
         'סרט חתונה של 3–5 דקות, טיזר קצר לאינסטגרם ומגנטים עם סורק AR שהופך כל תמונה לסרטון.\n' +
         'אלבום מודפס וצילומי Save the Date אפשר להוסיף.',
      next: ['magnets', 'delivery', 'photographers']
    },
    {
      id: 'magnets',
      chip: 'יש מגנטים?',
      // 'AR' normalises to 2 chars — below WEAK, it could never win. Dead key.
      keys: ['מגנט', 'מגנטים', 'מגנטים בחתונה', 'סורק', 'מציאות רבודה', 'מציאות מוגברת', 'תמונה שזזה', 'מתעורר', 'מתעוררים לחיים'],
      a: 'כן, ובכל עסקה — לא כתוספת בתשלום.\n' +
         'הם מגיעים עם סורק AR: מכוונים את הטלפון למגנט והתמונה הופכת לסרטון.\n' +
         'את זה מייצר Regaflash, העסק האח שלנו.',
      next: ['package', 'delivery', 'price']
    },
    {
      id: 'gallery',
      chip: 'אפשר לראות אלבום שלם של חתונה?',
      keys: ['אלבום שלם', 'גלריה מלאה', 'לראות עבודות', 'עבודות שלמות', 'תיק עבודות', 'דוגמאות', 'לראות חתונה שלמה', 'פורטפוליו', 'לשתף תמונה', 'קישור לתמונה'],
      // Line 1 is shared with the trust answer the studio gives in person;
      // line 2 describes the gallery as it is NOW — a swipeable strip on the
      // phone, filterable, every photo opening full-screen. "לגלול" was the
      // one verb that no longer described it.
      a: 'בשמחה. בשיחה נשלח לכם 2–3 גלריות מלאות של חתונות דומות לשלכם, מהבוקר ועד הסוף — לא רק את הפריים המושלם.\n' +
         'בינתיים יש כאן באתר גלריה: בטלפון מחליקים בין התמונות, אפשר לסנן לפי סוג אירוע, ולפתוח כל תמונה במסך מלא.',
      actions: ['gallery:weddings', 'gallery', 'form'],
      next: ['film', 'std', 'events']
    },
    {
      id: 'postpone',
      chip: 'ומה אם התאריך זז?',
      keys: ['התאריך זז', 'תאריך זז', 'התאריך שלנו זז', 'תאריך שלנו זז', 'לדחות', 'דחייה', 'לשנות תאריך', 'לשנות את התאריך', 'מקדמה', 'ביטול', 'לבטל'],
      a: 'התאריך עובר איתכם ללא עלות, בכפוף לזמינות. אם אנחנו תפוסים בתאריך החדש — נחזיר את המקדמה במלואה.',
      next: ['availability', 'price']
    },
    {
      id: 'availability',
      chip: 'התאריך שלנו פנוי?',
      keys: ['זמינות', 'פנוי', 'פנויים', 'תפוסים', 'שלנו פנוי', 'יש לכם מקום', 'להזמין', 'לסגור תאריך', 'לתפוס תאריך'],
      a: 'זמינות אני לא יכול לבדוק מכאן — היומן לא אצלי.\n' +
         'השאירו תאריך ופרטים בטופס ונחזור אליכם היום עם תשובה, או כתבו לנו בוואטסאפ.',
      actions: ['form', 'wa'],
      next: ['contact', 'datetbd', 'postpone']
    },
    {
      id: 'film',
      chip: 'איך נראה סרט החתונה?',
      // "שלוש דקות" stays in the keys: it is what a visitor might type, and the
      // section used to be titled that. Only the section name in the answer had
      // to move, and it moved because the heading did.
      // The length/teaser phrasings outrank delivery's 'כמה זמן' (7) and
      // contact's 'אינסטגרם' (8): a question about the FILM gets the film.
      keys: ['סרט', 'סרטון', 'וידאו', 'קליפ', 'טיזר', 'הפקה', 'צילום וידאו', 'שלוש דקות', 'נראה סרט', 'זמן הסרט', 'אורך הסרט', 'כמה דקות', 'סרטון לאינסטגרם', 'טיזר לאינסטגרם'],
      a: 'סרט חתונה של 3–5 דקות, ועוד טיזר קצר לאינסטגרם.\n' +
         'יש באתר סרט אחד שלם שאנחנו הכי אוהבים להראות — בקטע "חתונה אחת, סרט אחד". שווה אוזניות.',
      actions: ['film', 'form'],
      next: ['package', 'delivery', 'gallery']
    },
    {
      id: 'std',
      chip: 'מה זה צילומי Save the Date?',
      keys: ['save the date', 'זוגיות', 'צילומי זוגיות', 'לפני החתונה', 'לוקיישן', 'סייב דה דייט'],
      a: 'שעה וחצי בלוקיישן שאתם אוהבים, לפני היום הגדול. אפשר להוסיף את זה לחבילת החתונה.',
      actions: ['gallery:std', 'form'],
      next: ['package', 'price', 'gallery']
    },
    {
      id: 'prep',
      chip: 'אתם מצלמים גם את ההכנות?',
      keys: ['הכנות', 'בבוקר', 'הבוקר', 'איפור', 'שיער', 'השמלה', 'מלתחה', 'לפני החופה'],
      a: 'כן — איפור, שיער, השמלה על הקולב, הרגעים השקטים של הבוקר. בחתונה מלאה אנחנו איתכם מההכנות ועד השיר האחרון.',
      actions: ['gallery:prep', 'form'],
      next: ['package', 'photographers', 'process']
    },
    {
      id: 'events',
      chip: 'ואירועים שהם לא חתונה?',
      keys: ['חינה', 'אירוסין', 'בר מצווה', 'בת מצווה', 'מצווה', 'יום הולדת', 'אירוע אחר', 'ברית מילה', 'מסיבה', 'שהם לא חתונה', 'מצלמים אירועים'],
      a: 'כן — חינה, אירוסין, בר ובת מצווה וימי הולדת. אותה עין, אותו צוות.',
      actions: ['gallery:events', 'form'],
      next: ['package', 'area', 'price']
    },
    {
      id: 'people',
      chip: 'מצלמים גם משפחה ושושבינות?',
      keys: ['משפחה', 'שושבינות', 'סבתא', 'סבא', 'פורטרט', 'האנשים שלנו', 'חברות'],
      a: 'בהחלט — משפחה, סבתות, שושבינות. הפורטרטים שנשארים.',
      next: ['package', 'prep']
    },
    {
      id: 'process',
      chip: 'איך התהליך עובד?',
      keys: ['תהליך', 'איך זה עובד', 'שיחת היכרות', 'פגישה', 'תכנון', 'לוח זמנים', 'איך מתחילים'],
      a: 'ארבעה שלבים:\n' +
         '1. שיחת היכרות — 20 דקות בטלפון או קפה.\n' +
         '2. תכנון האירוע — לוח זמנים, לוקיישנים, רגעים שאסור לפספס.\n' +
         '3. יום הצילומים — אנחנו שם מההכנות ועד הסוף.\n' +
         // Was "4. תוך 30 יום: גלריה מלאה, אלבום מודפס והסרט." — which put the
         // printed album inside 30 days while the album entry below, the FAQ
         // and the JSON-LD all put it two weeks after the selection is
         // approved. The widget contradicted itself inside one session.
         '4. תוך 30 יום: הגלריה המלאה והסרט. האלבום המודפס — שבועיים אחרי אישור הבחירה.',
      actions: ['form'],
      next: ['delivery', 'about', 'availability']
    },
    {
      id: 'gear',
      chip: 'עם מה אתם מצלמים?',
      keys: ['ציוד', 'מצלמה', 'עדשות', 'עדשה', 'פלאש', 'תאורה', 'פול פריים', 'מצלמות', 'עם מה אתם מצלמים'],
      a: 'גוף פול־פריים, עדשות פריים מהירות, ותאורה שמכבדת את האור שיש בחדר — בלי פלאשים שמסמאים את האורחים.\n' +
         'יש באתר דגם תלת־ממד של המצלמה, אפשר לסובב אותו.',
      actions: ['camera', 'form'],
      next: ['light', 'photographers', 'package']
    },
    {
      id: 'light',
      chip: 'האולם שלנו חשוך — איך זה מצטלם?',
      // The eighth FAQ answer, which had no way in: "האולם שלנו חשוך"
      // normalises to nothing in any keys list, so the site's own question
      // came back as "אין לי תשובה מהאתר". The answer is copied out of
      // .faq__a — one-way, nothing enters index.html, the byte-lock stands.
      // No bare 'אור' key: it is a substring of 'תאורה' and would fight the
      // gear entry at 3 characters against 5; every key here either cannot
      // appear in a gear question or outranks the gear key it contains.
      keys: ['חשוך', 'חושך', 'אולם חשוך', 'איך זה מצטלם', 'תאורה באולם', 'אור נמוך', 'גן אירועים חשוך', 'בערב'],
      a: 'אנחנו מצלמים על גוף פול־פריים ועדשות פריים מהירות, כאלה שאוספות הרבה אור, ומשלימים בתאורה שמכבדת את האור שכבר יש בחדר. בלי פלאשים שמסמאים את האורחים.',
      next: ['gear', 'photographers', 'package']
    },
    {
      id: 'hours',
      chip: 'עד איזו שעה אתם נשארים?',
      // 'כמה זמן אתם' outranks delivery's 'כמה זמן' by length: a question
      // about how long WE stay gets the hours answer, not turnaround times.
      keys: ['כמה שעות', 'שעות צילום', 'מספר שעות', 'שעות של צילום', 'עד מתי', 'עד סוף הריקודים', 'כמה זמן אתם'],
      a: 'בחתונה מלאה אנחנו איתכם מההכנות ועד השיר האחרון — לא הולכים באמצע הריקודים.\n' +
         'מספר השעות הוא אחד מהדברים שקובעים את המחיר, יחד עם מספר הצלמים והלוקיישנים, ולכן אין לנו מחירון קבוע.',
      actions: ['cost', 'form'],
      next: ['package', 'price', 'prep']
    },
    {
      id: 'datetbd',
      chip: 'עוד אין לנו תאריך — אפשר לדבר?',
      // The form's own checkbox says 'עוד לא קבענו תאריך'; the answer quotes
      // it so the visitor recognises the control when they reach it.
      keys: ['לא קבענו', 'עוד לא קבענו תאריך', 'אין לנו תאריך', 'עדיין אין תאריך', 'לא סגרנו אולם', 'בלי תאריך'],
      a: 'ברור. בטופס יש סימון "עוד לא קבענו תאריך" — משאירים פרטים גם בלי תאריך, ומדברים על הסגנון והחבילה עוד לפני שסוגרים אולם.\n' +
         'כשיהיה תאריך, פשוט תעדכנו אותנו.',
      actions: ['form', 'wa'],
      next: ['availability', 'price', 'area']
    },
    {
      id: 'album',
      chip: 'יש אלבום מודפס?',
      // 'ספר' is gone: 3 chars = exactly WEAK, and a substring of מספר — the
      // site's own price vocabulary. "מספר הצלמים" was answered with the ALBUM.
      keys: ['אלבום מודפס', 'הדפסה', 'אלבום', 'להדפיס', 'ספר תמונות'],
      a: 'כן, אפשר להוסיף אלבום מודפס לחבילה. הוא מגיע אליכם כשבועיים אחרי שאתם מאשרים את בחירת התמונות.',
      next: ['package', 'delivery', 'price']
    },
    {
      id: 'about',
      chip: 'מי אתם?',
      keys: ['מי אתם', 'אודות', 'עליכם', 'על עצמכם', 'הסטודיו', 'amora', 'אמורה'],
      a: 'Amora Studio — סטודיו לצילום וידאו וסטילס לחתונות ואירועים, מתל אביב, פעילים בכל הארץ.\n' +
         'שנינו מצלמים ביחד, סטילס ווידאו, מהבוקר של ההכנות ועד השיר האחרון — בלי לביים לכם את החתונה.',
      next: ['photographers', 'process', 'gallery']
    },
    {
      id: 'contact',
      chip: 'איך יוצרים אתכם קשר?',
      // 'עונים להודעה' must be here: without it "תוך כמה זמן עונים להודעה
      // בוואטסאפ" matched the delivery entry and answered with photo turnaround
      // times. Longer keys win, so this outranks the shorter delivery match.
      keys: ['ליצור קשר', 'טלפון', 'וואטסאפ', 'ווטסאפ', 'וואצאפ', 'whatsapp', 'להתקשר', 'מייל', 'אינסטגרם', 'לדבר איתכם', 'לדבר עם בן אדם', 'נציג', 'עונים להודעה', 'אתכם קשר'],
      a: 'בטלפון 050-3662699, בוואטסאפ, או דרך טופס בדיקת הזמינות באתר — ונחזור אליכם היום.\n' +
         'גם באינסטגרם, @amora___studio.',
      actions: ['wa', 'tel', 'form'],
      next: ['availability', 'price']
    }
  ];

  var OPENING_CHIPS = ['package', 'delivery', 'price', 'area', 'gallery'];

  var FALLBACK =
    'על זה אין לי תשובה מהאתר, ואני מעדיף לא לנחש.\n' +
    'השאירו פרטים בטופס ונחזור אליכם היום, או כתבו לנו ישירות בוואטסאפ.';

  /* -------------------------------------------------- Hebrew normalisation */

  // Final letters, niqqud, geresh and punctuation all break naive matching:
  // "בכמה?" and "כמה" must reach the same entry.
  var FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

  function normalise(text) {
    var out = String(text == null ? '' : text).toLowerCase();
    out = out.replace(/[֑-ׇ]/g, '');            // niqqud / cantillation
    out = out.replace(/[׳״'"`]/g, '');          // geresh, gershayim, quotes
    out = out.replace(/[ךםןףץ]/g, function (ch) { return FINALS[ch]; });
    out = out.replace(/[^א-תa-z0-9]+/g, ' ');   // everything else is a gap
    return ' ' + out.replace(/\s+/g, ' ').trim() + ' ';
  }

  // Pre-normalise the keyword lists once, so matching is a plain substring test.
  var i, j;
  for (i = 0; i < KB.length; i++) {
    KB[i].nkeys = [];
    for (j = 0; j < KB[i].keys.length; j++) {
      KB[i].nkeys.push(normalise(KB[i].keys[j]).slice(1, -1));
    }
  }

  function byId(id) {
    for (var k = 0; k < KB.length; k++) {
      if (KB[k].id === id) return KB[k];
    }
    return null;
  }

  /** Longest matching keyword wins: "התאריך זז" (9) beats "תאריך" (5), so a
   *  postponement question does not get answered as an availability question. */
  function matchLocal(question) {
    var text = normalise(question);
    var best = null;
    var bestScore = 0;
    for (var k = 0; k < KB.length; k++) {
      var score = 0;
      for (var n = 0; n < KB[k].nkeys.length; n++) {
        var key = KB[k].nkeys[n];
        if (key && text.indexOf(key) !== -1 && key.length > score) score = key.length;
      }
      if (score > bestScore) { bestScore = score; best = KB[k]; }
    }
    return { entry: best, score: bestScore };
  }

  /* ============================================================ tier 2 === */

  var remoteDown = false;   // one hard failure and we stop trying this visit

  function remoteReady() {
    return CONFIG.remoteEnabled && !remoteDown &&
           Boolean(CONFIG.supabaseUrl) && Boolean(CONFIG.supabaseKey) &&
           typeof window.fetch === 'function' && typeof AbortController === 'function';
  }

  /** Resolves with a clean string, or with null — never rejects. A null means
   *  "use tier 1", which is what the visitor sees. */
  function askRemote(question, history) {
    return new Promise(function (resolve) {
      var abort = new AbortController();
      var timedOut = false;
      var timer = setTimeout(function () { timedOut = true; abort.abort(); }, CONFIG.remoteTimeout);
      var url = CONFIG.supabaseUrl.replace(/\/+$/, '') + CONFIG.assistantPath;

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          apikey: CONFIG.supabaseKey,
          Authorization: 'Bearer ' + CONFIG.supabaseKey
        },
        body: JSON.stringify({ question: question, history: history }),
        signal: abort.signal
      }).then(function (res) {
        clearTimeout(timer);
        // 5xx and 429 mean the backend is unhappy; stop asking for this visit.
        if (res.status >= 500 || res.status === 429) remoteDown = true;
        if (!res.ok) return null;
        return res.json();
      }).then(function (data) {
        if (!data || typeof data.reply !== 'string') { resolve(null); return; }
        // Strip control characters. Newlines survive — addMessage turns them
        // into paragraphs — and the reply is rendered as text, never as markup.
        var reply = data.reply.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
        if (!reply) { resolve(null); return; }
        resolve(reply.slice(0, MAX_REPLY));
      }).catch(function () {
        clearTimeout(timer);
        // A hang is not a blip. remoteDown was latched only for 5xx/429, so a
        // timeout left it false and the next free-text question froze the
        // widget for another full remoteTimeout — measured at 14.0s, twice in
        // a row, input, send button and all five chips disabled, with closing
        // and reopening the panel no help. A one-off transport error is NOT
        // latched: that may recover on the next question.
        if (timedOut) remoteDown = true;
        resolve(null);
      });
    });
  }

  /* ============================================================= widget === */

  var launcher = null;
  var panel = null;
  var logEl = null;
  var statusEl = null;
  var chipsEl = null;
  var inputEl = null;
  var formEl = null;
  var typingEl = null;
  var lastFocused = null;
  var open = false;
  var busy = false;
  var history = [];   // [{ role: 'user' | 'assistant', content: '…' }]

  function waLink(text) {
    return 'https://wa.me/' + CONFIG.whatsapp +
      (text ? '?text=' + encodeURIComponent(text) : '');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;   // always text, never HTML
    return node;
  }

  function buildLauncher() {
    launcher = el('button', 'am-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    // aria-controls is set in setOpen(), once the panel it points at exists.
    // A reference to a missing id is an error in every a11y checker.
    launcher.setAttribute('aria-label', 'פתיחת עוזר האתר — שאלות נפוצות');
    launcher.appendChild(el('span', 'am-launcher__dot'));
    launcher.appendChild(el('span', 'am-launcher__label', 'יש שאלה?'));
    // The circle's glyph. Only one of icon/label is ever visible — see the
    // --header rules in assistant.css.
    launcher.appendChild(el('span', 'am-launcher__icon', '?'));
    launcher.addEventListener('click', function () { setOpen(!open); });

    // Preferred home is the mobile header bar, beside the burger and the
    // availability CTA, so the launcher reads as site chrome rather than as a
    // card dropped on the hero. Only the BUTTON moves; the panel stays a child
    // of body, because a fixed modal nested inside the header would inherit its
    // stacking context. Pages without that bar (the legal shell) keep the
    // free-floating launcher, which is why the fallback is not dead code.
    var bar = document.querySelector('.nav-mobile');
    if (bar) {
      launcher.classList.add('am-launcher--header');
      bar.appendChild(launcher);
    } else {
      document.body.appendChild(launcher);
    }
  }

  function buildPanel() {
    panel = el('div', 'am-panel');
    panel.id = 'am-assistant-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'am-assistant-title');
    panel.hidden = true;

    var head = el('div', 'am-panel__head');
    var titles = el('div', 'am-panel__titles');
    var title = el('p', 'am-panel__title', 'עוזר האתר');
    title.id = 'am-assistant-title';
    titles.appendChild(title);
    // Said plainly, once: nobody should think they are texting a photographer.
    titles.appendChild(el('p', 'am-panel__sub', 'עונה ממה שכתוב באתר · לבני אדם: ' + CONFIG.phone));
    head.appendChild(titles);

    var close = el('button', 'am-panel__close', '✕');
    close.type = 'button';
    close.setAttribute('aria-label', 'סגירת העוזר');
    close.addEventListener('click', function () { setOpen(false); });
    head.appendChild(close);
    panel.appendChild(head);

    logEl = el('div', 'am-log');
    logEl.setAttribute('role', 'log');
    logEl.setAttribute('aria-live', 'polite');
    logEl.setAttribute('aria-relevant', 'additions');
    logEl.setAttribute('aria-label', 'שיחה');
    panel.appendChild(logEl);

    statusEl = el('p', 'visually-hidden');
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');
    panel.appendChild(statusEl);

    chipsEl = el('div', 'am-chips');
    chipsEl.setAttribute('aria-label', 'שאלות מוצעות');
    chipsEl.setAttribute('role', 'group');
    panel.appendChild(chipsEl);

    formEl = el('form', 'am-form');
    formEl.setAttribute('novalidate', 'novalidate');

    var label = el('label', 'visually-hidden', 'השאלה שלכם');
    label.setAttribute('for', 'am-assistant-input');
    formEl.appendChild(label);

    inputEl = el('input', 'am-form__input');
    inputEl.id = 'am-assistant-input';
    inputEl.type = 'text';
    inputEl.autocomplete = 'off';
    inputEl.maxLength = MAX_INPUT;
    inputEl.placeholder = 'שאלו משהו…';
    formEl.appendChild(inputEl);

    var send = el('button', 'am-form__send', 'שליחה');
    send.type = 'submit';
    formEl.appendChild(send);

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = inputEl.value.trim();
      if (!value || busy) return;
      inputEl.value = '';
      ask(value);
    });
    panel.appendChild(formEl);

    var foot = el('div', 'am-foot');
    foot.appendChild(makeAction('form'));
    foot.appendChild(makeAction('wa'));
    panel.appendChild(foot);

    document.body.appendChild(panel);
  }

  /** Same target, two pages. This file loads on index.html, cost.html and
   *  camera-3d.html, and the sections the actions point at exist only on the
   *  first (cost.html at least has its own form). The old fallback wrote a
   *  fragment that resolves to nothing — the panel closed, the page did not
   *  move: the visible-but-dead control cost.html's glimpse comment refuses
   *  to ship. location.search rides along on the navigation: leadSource()
   *  reads utm_* off the address at submit and refuses a same-origin
   *  referrer, so a bare 'index.html#contact' would silently lose the
   *  campaign tag that paid for the visit. */
  function goTo(selector, fallbackHash) {
    var target = document.querySelector(selector);
    setOpen(false);
    if (target) {
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      return target;
    }
    window.location.href = 'index.html' + window.location.search + fallbackHash;
    return null;
  }

  /** Two actions are PAGES, not sections. The href carries location.search by
   *  hand — carryCampaign() rewrote the document's links long before these are
   *  built per-message, so the utm rule has to be applied here. On the target
   *  page itself the control would be a link to where the visitor already
   *  stands, so makeAction returns null and the callers skip it — the same
   *  dead-control rule that keeps the strip counter off the desktop. */
  var PAGE_ACTIONS = {
    cost: { file: 'cost.html', label: 'מה משפיע על המחיר' },
    camera: { file: 'camera-3d.html', label: 'לדגם התלת־ממד' }
  };

  // Same four names cost.html's glimpse links use, so a visitor sent to
  // "לגלריית ההכנות" from either surface arrives at the same place.
  var GALLERY_LABELS = {
    weddings: 'לגלריית החתונות',
    prep: 'לגלריית ההכנות',
    events: 'לגלריית האירועים',
    std: 'לגלריית ה-Save the Date'
  };

  /** The escape hatches. Every one of them ends at a person. */
  function makeAction(kind) {
    var node;
    if (kind === 'form') {
      node = el('button', 'am-action', 'להשארת פרטים');
      node.type = 'button';
      node.addEventListener('click', function () {
        if (!goTo(CONFIG.formHash, CONFIG.formHash)) return;
        var field = document.querySelector('[data-field="name"]');
        if (field) setTimeout(function () { field.focus(); }, reducedMotion ? 0 : 600);
      });
      return node;
    }
    if (kind === 'wa') {
      node = el('a', 'am-action am-action--wa', 'וואטסאפ');
      node.href = waLink('היי, הגעתי מהאתר של Amora Studio ואשמח לבדוק זמינות לתאריך שלנו.');
      node.target = '_blank';
      node.rel = 'noopener';
      return node;
    }
    if (kind === 'tel') {
      node = el('a', 'am-action', CONFIG.phone);
      node.href = 'tel:' + CONFIG.tel;
      return node;
    }
    if (PAGE_ACTIONS[kind]) {
      var page = PAGE_ACTIONS[kind];
      if (window.location.pathname.split('/').pop() === page.file) return null;
      node = el('a', 'am-action', page.label);
      node.href = page.file + window.location.search;
      return node;
    }
    if (kind.indexOf('gallery:') === 0) {
      var cat = kind.slice(8);
      node = el('button', 'am-action', GALLERY_LABELS[cat] || 'לגלריה');
      node.type = 'button';
      node.addEventListener('click', function () {
        // #gallery-<cat> is main.js's territory: it applies the filter on
        // hashchange and on load, and the fragment is not an element id, so
        // nothing scrolls on its own — hence the explicit scrollIntoView.
        // Assigning .hash keeps pathname AND search, the utm rule the chips
        // follow. Off the homepage this becomes a real navigation and
        // main.js's load path reads the same fragment.
        var hash = '#gallery-' + cat;
        var section = document.querySelector('#gallery');
        setOpen(false);
        if (!section) {
          window.location.href = 'index.html' + window.location.search + hash;
          return;
        }
        if (window.location.hash !== hash) window.location.hash = hash;
        section.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      });
      return node;
    }
    if (kind === 'gallery' || kind === 'film') {
      node = el('button', 'am-action', kind === 'gallery' ? 'לגלריה' : 'לסרט');
      node.type = 'button';
      node.addEventListener('click', function () {
        if (kind === 'gallery') goTo('#gallery', '#gallery');
        else goTo('[data-section="film"]', '#film');
      });
      return node;
    }
    return el('span');
  }

  function addMessage(role, text, actions) {
    if (!logEl) return null;
    var wrap = el('div', 'am-msg am-msg--' + role);
    var bubble = el('div', 'am-bubble');
    var lines = String(text).split('\n');
    for (var k = 0; k < lines.length; k++) {
      if (!lines[k]) continue;
      bubble.appendChild(el('p', 'am-bubble__p', lines[k]));
    }
    wrap.appendChild(bubble);

    if (actions && actions.length) {
      var row = el('div', 'am-msg__actions');
      for (var a = 0; a < actions.length; a++) {
        var act = makeAction(actions[a]);
        if (act) row.appendChild(act);
      }
      if (row.childNodes.length) wrap.appendChild(row);
    }

    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
    return wrap;
  }

  function setChips(ids) {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    for (var k = 0; k < ids.length; k++) {
      var entry = byId(ids[k]);
      if (!entry) continue;
      var chip = el('button', 'am-chip', entry.chip);
      chip.type = 'button';
      chip.dataset.amChip = entry.chip;
      chip.addEventListener('click', function (e) {
        if (busy) return;
        ask(e.currentTarget.dataset.amChip);
      });
      chipsEl.appendChild(chip);
    }
  }

  function showTyping(on) {
    if (!logEl) return;
    if (on) {
      if (typingEl) return;
      typingEl = el('div', 'am-msg am-msg--bot am-typing');
      typingEl.setAttribute('aria-hidden', 'true');
      var bubble = el('div', 'am-bubble am-bubble--typing');
      bubble.appendChild(el('span', 'am-typing__dot'));
      bubble.appendChild(el('span', 'am-typing__dot'));
      bubble.appendChild(el('span', 'am-typing__dot'));
      typingEl.appendChild(bubble);
      logEl.appendChild(typingEl);
      logEl.scrollTop = logEl.scrollHeight;
      if (statusEl) statusEl.textContent = 'מחפש תשובה…';
    } else if (typingEl) {
      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
      typingEl = null;
    }
  }

  function setBusy(on) {
    busy = on;
    if (inputEl) inputEl.disabled = on;
    if (formEl) {
      var send = $('.am-form__send', formEl);
      if (send) send.disabled = on;
    }
    if (chipsEl) {
      var chips = chipsEl.querySelectorAll('button');
      for (var k = 0; k < chips.length; k++) chips[k].disabled = on;
    }
    // Disabling the element that has focus drops focus to <body>, which puts a
    // keyboard or screen-reader user behind the open dialog. Only reclaim it
    // when it was actually lost — never steal it from wherever they moved.
    if (!on && open && inputEl) {
      var here = document.activeElement;
      if (!here || here === document.body || here === document.documentElement) {
        inputEl.focus();
      }
    }
  }

  function remember(role, content) {
    history.push({ role: role, content: content });
    // Keep the tail only — the Edge Function caps this again server-side.
    while (history.length > HISTORY_TURNS * 2) history.shift();
  }

  function answerWith(entry, weak) {
    var text = entry.a;
    if (weak) {
      text = 'אולי זה מה שחיפשתם:\n' + text + '\nאם לא — השאירו פרטים ונענה בעצמנו.';
    }
    var actions = entry.actions ? entry.actions.slice(0) : [];
    if (!actions.length) actions = ['form'];
    addMessage('bot', text, actions);
    remember('assistant', entry.a);
    setChips(entry.next && entry.next.length ? entry.next : OPENING_CHIPS);
    if (statusEl) statusEl.textContent = 'התקבלה תשובה.';
  }

  function answerFallback() {
    addMessage('bot', FALLBACK, ['form', 'wa']);
    remember('assistant', FALLBACK);
    setChips(OPENING_CHIPS);
    if (statusEl) statusEl.textContent = 'לא נמצאה תשובה, מוצעות דרכי יצירת קשר.';
  }

  function ask(question) {
    var text = String(question).slice(0, MAX_INPUT).trim();
    if (!text) return;

    addMessage('user', text);
    remember('user', text);
    setBusy(true);

    var local = matchLocal(text);

    // A confident scripted answer never touches the network.
    if (local.entry && local.score >= STRONG) {
      setTimeout(function () {
        answerWith(local.entry, false);
        setBusy(false);
      }, reducedMotion ? 0 : THINK_MS);
      return;
    }

    if (!remoteReady()) {
      setTimeout(function () {
        if (local.entry && local.score >= WEAK) answerWith(local.entry, true);
        else answerFallback();
        setBusy(false);
      }, reducedMotion ? 0 : THINK_MS);
      return;
    }

    showTyping(true);
    askRemote(text, history.slice(0, -1)).then(function (reply) {
      showTyping(false);
      if (reply) {
        addMessage('bot', reply, ['form', 'wa']);
        remember('assistant', reply);
        setChips(OPENING_CHIPS);
        if (statusEl) statusEl.textContent = 'התקבלה תשובה.';
      } else if (local.entry && local.score >= WEAK) {
        answerWith(local.entry, true);
      } else {
        answerFallback();
      }
      setBusy(false);
    });
  }

  /* ------------------------------------------------------- open / close --- */

  function focusables() {
    var list = panel.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    var out = [];
    for (var k = 0; k < list.length; k++) {
      if (list[k].offsetParent !== null) out.push(list[k]);
    }
    return out;
  }

  /** Only the full-screen sheet locks the page behind it, and it hands the lock
   *  back only if neither of main.js's own dialogs is holding it — otherwise
   *  closing the assistant would unlock the page under an open menu. */
  function lockScroll(on) {
    var menu = document.getElementById('mobile-menu');
    var lightbox = document.querySelector('[data-lightbox]');
    if (on) {
      document.body.style.overflow = 'hidden';
    } else if ((!menu || menu.hidden) && (!lightbox || lightbox.hidden)) {
      document.body.style.overflow = '';
    }
  }

  function setOpen(next) {
    if (!panel) {
      buildPanel();
      launcher.setAttribute('aria-controls', panel.id);
    }
    if (next === open) return;
    open = next;
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.classList.toggle('is-open', open);

    // Full-screen on a phone: that is a modal dialog, and Tab must stay inside
    // it. Docked on a desktop it is not modal — the page behind stays usable.
    panel.setAttribute('aria-modal', String(sheetQuery.matches));

    lockScroll(open && sheetQuery.matches);

    if (open) {
      lastFocused = document.activeElement;
      if (!logEl.childNodes.length) {
        addMessage('bot',
          'היי! אני עונה על שאלות ממה שכתוב באתר — מה כוללת החבילה, תוך כמה זמן מקבלים חומרים, לאן אנחנו מגיעים.\n' +
          'על זמינות ומחיר עונים אנחנו עצמנו, ולשם אעביר אתכם.');
        setChips(OPENING_CHIPS);
      }
      if (inputEl) inputEl.focus();
    } else {
      showTyping(false);
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      else launcher.focus();
      lastFocused = null;
    }
  }

  document.addEventListener('keydown', function (e) {
    if (!open || !panel) return;
    if (e.key === 'Escape') {
      // The lightbox and the mobile menu sit above us and own Escape first.
      var menu = document.getElementById('mobile-menu');
      var lightbox = document.querySelector('[data-lightbox]');
      if (menu && !menu.hidden) return;
      if (lightbox && !lightbox.hidden) return;
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab' || !sheetQuery.matches) return;
    var items = focusables();
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  });

  sheetQuery.addEventListener('change', function () {
    if (!panel || !open) return;
    panel.setAttribute('aria-modal', String(sheetQuery.matches));
    lockScroll(sheetQuery.matches);
  });

  // The mobile menu is full-screen and sits above the panel; opening it while
  // the assistant is open would leave an invisible dialog behind it.
  document.addEventListener('click', function (e) {
    if (!open) return;
    var toggle = e.target.closest && e.target.closest('[data-menu-toggle]');
    if (toggle) setOpen(false);
  }, true);

  /* ------------------------------------------------------------- start --- */

  // Nothing is built until the page has finished its own work, so the
  // assistant cannot compete with the hero for LCP.
  function start() {
    if (document.getElementById('am-assistant-panel') || launcher) return;
    buildLauncher();
  }

  function schedule() {
    if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 1200);
  }

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
