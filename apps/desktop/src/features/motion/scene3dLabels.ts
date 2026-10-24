/** Names for 3D looks, materials, moods and camera moves, in the UI's language. */

import { t } from "../../i18n";
import type { Material3Name, Recipe3 } from "./engine/types";

export const RECIPE_LABELS: Record<Recipe3, string> = {
  logoReveal: t("شعار مجسّم"),
  particleText: t("نص من جزيئات"),
  kineticType3D: t("كتابة 3D"),
  galaxy: t("مجرّة"),
  globeArcs: t("كرة أرضية"),
  solarSystem: t("نظام شمسي"),
  voxelCity: t("مدينة مكعّبات"),
  chromeBlob: t("فقاعة كروم"),
  productSpin: t("منتج بيلف"),
  cardStack: t("كروت 3D"),
  bars3D: t("أعمدة 3D"),
  physicsDrop: t("أشكال بتوقع"),
};

export const MATERIAL_LABELS: Partial<Record<Material3Name, string>> = {
  chrome: t("كروم"),
  gold: t("ذهب"),
  glass: t("زجاج"),
  holographic: t("هولوغرام"),
  neon: t("نيون"),
  plastic: t("بلاستيك"),
  clay: t("صلصال"),
  metal: t("معدن"),
};

export const MOOD_LABELS: Record<string, string> = {
  night: t("ليل"),
  studio: t("استوديو"),
  sunset: t("غروب"),
  dawn: t("فجر"),
  city: t("مدينة"),
};

export const MOVE_LABELS: Record<string, string> = {
  orbit: t("دوران"),
  dolly: t("اقتراب هادي"),
  push: t("اقتراب"),
  crane: t("نزول"),
  handheld: t("يد"),
  none: t("ثابتة"),
};

/** Which params each look reads. */
export const RECIPE_USES: Record<Recipe3, { text?: "line" | "lines"; material?: boolean; mood?: boolean }> = {
  logoReveal: { text: "line", material: true, mood: true },
  particleText: { text: "line", mood: true },
  kineticType3D: { text: "lines", material: true, mood: true },
  galaxy: {},
  globeArcs: { mood: true },
  solarSystem: {},
  voxelCity: {},
  chromeBlob: { material: true },
  productSpin: { material: true, mood: true },
  cardStack: { mood: true },
  bars3D: { material: true, mood: true },
  physicsDrop: { material: true, mood: true },
};
