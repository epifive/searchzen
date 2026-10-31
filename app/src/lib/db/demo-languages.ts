import "server-only";
import type { Kysely } from "kysely";
import type { Database } from "./schema";
import { acquireSeedLock, finishSeedLock, releaseSeedLock } from "./seed-lock";

/** Translations of the default site texts, so the demo's home page is fully translated. */
const SITE_TEXTS: Record<string, Record<string, string>> = {
  ar: {
    "setting.site_tagline": "تتبّع الترتيب وتدقيق المواقع بكل سهولة",
    "setting.home_hero_title": "اعرف ترتيبك في نتائج البحث، وأصلح ما يعيقك.",
    "setting.home_hero_subtitle":
      "تتبّع ترتيبك في Google يوميًا، ودقّق موقعك بحثًا عن مشكلات السيو التقنية، وأرسل إلى عملائك تقارير تحمل علامتك التجارية، كل ذلك من لوحة تحكم واحدة.",
    "setting.footer_text": "تتبّع ترتيب الكلمات المفتاحية وتدقيق المواقع وتقارير سيو جاهزة للعملاء.",
    "setting.copyright_text": "© {year} {site_name}. جميع الحقوق محفوظة.",
    "setting.cookie_consent_text": "نستخدم ملفات تعريف الارتباط لإبقائك مسجلًا الدخول ولفهم كيفية استخدام الموقع. باستمرارك في التصفح فإنك توافق على استخدامنا لها.",
  },
  hi: {
    "setting.site_tagline": "रैंक ट्रैकिंग और साइट ऑडिट, अब आसान",
    "setting.home_hero_title": "जानिए आप कहाँ रैंक करते हैं, और जो रोक रहा है उसे ठीक कीजिए।",
    "setting.home_hero_subtitle":
      "Google पर अपनी रैंकिंग रोज़ ट्रैक करें, तकनीकी SEO समस्याओं के लिए अपनी साइट का ऑडिट करें और क्लाइंट्स को अपनी ब्रांडिंग वाली रिपोर्ट भेजें, सब एक ही डैशबोर्ड से।",
    "setting.footer_text": "कीवर्ड रैंक ट्रैकिंग, साइट ऑडिट और क्लाइंट्स के लिए तैयार SEO रिपोर्ट।",
    "setting.copyright_text": "© {year} {site_name}. सर्वाधिकार सुरक्षित।",
    "setting.cookie_consent_text": "हम आपको साइन इन रखने और साइट के इस्तेमाल को समझने के लिए कुकी का इस्तेमाल करते हैं। आगे बढ़कर आप कुकी के इस्तेमाल से सहमत होते हैं।",
  },
};

interface LanguagePack {
  language: { code: string; name: string; native_name: string; direction: "ltr" | "rtl" };
  translations: Record<string, string>;
}

/** Install the bundled Hindi and Arabic packs on a demo site (once, guarded by a settings row). */
export async function seedDemoLanguages(db: Kysely<Database>): Promise<void> {
  const lock = await acquireSeedLock(db, "demo_languages_seeded_at");
  if (!lock) return;
  try {
    await installPacks(db);
  } catch (err) {
    await releaseSeedLock(db, lock);
    throw err;
  }
  await finishSeedLock(db, lock);
}

async function installPacks(db: Kysely<Database>): Promise<void> {
  const packs = [(await import("../../../languages/hi.json")).default, (await import("../../../languages/ar.json")).default] as LanguagePack[];
  for (const [index, pack] of packs.entries()) {
    const { code, name, native_name, direction } = pack.language;
    const exists = await db.selectFrom("languages").select("code").where("code", "=", code).executeTakeFirst();
    if (exists) continue;
    const rows = Object.entries({ ...pack.translations, ...SITE_TEXTS[code] }).map(([key, value]) => ({ lang: code, key, value }));
    await db.transaction().execute(async (trx) => {
      await trx.insertInto("languages").values({ code, name, native_name, direction, is_active: 1, sort_order: (index + 1) * 10 }).execute();
      for (let i = 0; i < rows.length; i += 200) await trx.insertInto("translations").values(rows.slice(i, i + 200)).execute();
    });
  }
}
