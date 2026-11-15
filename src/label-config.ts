import { ServiceError } from "./service-error";
import {
  defaultQuebecReview,
  hasMetricHoneyMass,
  quebecReviewInput,
  quebecReviewIssues,
  type QuebecReview,
} from "./quebec-requirements";
/**
 * Mention d'ingrédient unique du miel pur. Le panneau imprime déjà l'en-tête
 * bilingue « Ingrédients / Ingredients »; avec ce texte, la mention complète
 * lue sur l'étiquette est « Ingrédients : Miel / Ingredients: Honey ».
 * Le miel pur est un aliment à ingrédient unique et ne périme pas : le preset
 * miel remplit cette mention et active l'option sans date d'expiration. Il ne
 * dispense d'aucune autre vérification (GS1, poids net, adresse, origine,
 * valeur nutritive ou exemption, lot, dossier Québec).
 */
export const HONEY_SINGLE_INGREDIENT_FR = "Miel / Honey";
/**
 * Contournement autorisé d'un prérequis bloquant, consigné avec l'étiquette.
 * Le prérequis n'est jamais effacé : il est marqué « contourné avec
 * autorisation » et l'entrée reste visible dans le modèle sauvegardé.
 * Directeur (admin) : note écrite obligatoire. Employé : code maître à
 * 4 chiffres vérifié côté serveur (méthode « code », le code n'est jamais
 * consigné). Les entrées ne peuvent être créées que par l'endpoint serveur
 * dédié ; une sauvegarde ordinaire ne peut ni en ajouter ni en retirer.
 */
export type LabelOverride = {
  issue: string;
  by: string;
  role: "admin" | "employee";
  method: "note" | "code";
  note: string;
  at: string;
};
export type LabelConfig = {
  version: 1;
  widthMm: number;
  heightMm: number;
  seamMm: number;
  jarShape: "round" | "hexagonal";
  flatFaceWidthMm: number;
  principalDisplayAreaCm2: number;
  dpi: 203 | 300 | 600;
  orientation: "ladder" | "fence";
  theme: "mono" | "blue" | "honey";
  brand: string;
  nameFr: string;
  ingredientsFr: string;
  business: string;
  origin: string;
  grade: string;
  colour: string;
  storage: string;
  notes: string;
  lot: string;
  bestBefore: string;
  logoImage: string;
  logoRatio: number;
  logoWidthMm: number;
  honeyPreset: boolean;
  noBestBefore: boolean;
  overrides: LabelOverride[];
  nutritionImage: string;
  nutritionRatio: number;
  nutritionWidthMm: number;
  nutritionStatus: "unreviewed" | "provided" | "exempt";
  nutritionExemption: string;
  gs1Confirmed: boolean;
  textReviewed: boolean;
  quebec: QuebecReview;
};
export type LabelProduct = {
  id: string;
  businessBrandId: string;
  name: string;
  sku: string;
  category: string;
  size: string;
  ingredients: string;
  gtin: string | null;
  labelConfig?: unknown;
};
export function defaultLabelConfig(brand = ""): LabelConfig {
  return {
    version: 1,
    widthMm: 180,
    heightMm: 65,
    seamMm: 4,
    jarShape: "round",
    flatFaceWidthMm: 0,
    principalDisplayAreaCm2: 0,
    dpi: 300,
    orientation: "ladder",
    theme: "mono",
    brand,
    nameFr: "",
    ingredientsFr: "",
    business: "",
    origin: "",
    grade: "",
    colour: "",
    storage: "",
    notes: "",
    lot: "",
    bestBefore: "",
    logoImage: "",
    logoRatio: 1,
    logoWidthMm: 30,
    honeyPreset: false,
    noBestBefore: false,
    overrides: [],
    nutritionImage: "",
    nutritionRatio: 1.5,
    nutritionWidthMm: 40,
    nutritionStatus: "unreviewed",
    nutritionExemption: "",
    gs1Confirmed: false,
    textReviewed: false,
    quebec: defaultQuebecReview(/miel\s*aissa/i.test(brand)),
  };
}
export function labelConfigInput(value: unknown): LabelConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ServiceError(
      "invalid_input",
      "Label settings must be an object.",
    );
  const b = value as Record<string, unknown>;
  const result = defaultLabelConfig();
  const shape = b.jarShape ?? "round";
  if (shape !== "round" && shape !== "hexagonal")
    throw new ServiceError("invalid_input", "Choose a round or hexagonal jar.");
  result.jarShape = shape;
  const faceWidth = b.flatFaceWidthMm ?? 0;
  if (
    typeof faceWidth !== "number" ||
    !Number.isFinite(faceWidth) ||
    faceWidth < 0 ||
    faceWidth > 150
  )
    throw new ServiceError(
      "invalid_input",
      "Flat-face width must be between 0 and 150 mm; 0 means not measured.",
    );
  result.flatFaceWidthMm = Math.round(faceWidth * 10) / 10;
  const displayArea = b.principalDisplayAreaCm2 ?? 0;
  if (
    typeof displayArea !== "number" ||
    !Number.isFinite(displayArea) ||
    displayArea < 0 ||
    displayArea > 10000
  )
    throw new ServiceError(
      "invalid_input",
      "La principale surface exposée doit être comprise entre 0 et 10 000 cm²; 0 signifie non vérifiée.",
    );
  result.principalDisplayAreaCm2 = displayArea;
  for (const [key, min, max] of [
    ["widthMm", 90, 350],
    ["heightMm", 40, 150],
    ["seamMm", 0, 15],
  ] as const) {
    const n = b[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max)
      throw new ServiceError(
        "invalid_input",
        `${key} must be between ${min} and ${max} mm.`,
      );
    result[key] = Math.round(n * 10) / 10;
  }
  if (![203, 300, 600].includes(b.dpi as number))
    throw new ServiceError("invalid_input", "Choose 203, 300 or 600 DPI.");
  result.dpi = b.dpi as LabelConfig["dpi"];
  if (b.orientation !== "ladder" && b.orientation !== "fence")
    throw new ServiceError(
      "invalid_input",
      "Choose ladder or fence barcode orientation.",
    );
  if (b.theme !== "mono" && b.theme !== "blue" && b.theme !== "honey")
    throw new ServiceError("invalid_input", "Choose a label colour style.");
  result.orientation = b.orientation;
  result.theme = b.theme;
  for (const key of [
    "brand",
    "nameFr",
    "ingredientsFr",
    "business",
    "origin",
    "grade",
    "colour",
    "storage",
    "notes",
    "lot",
    "bestBefore",
  ] as const) {
    const text = b[key];
    const limit =
      key === "ingredientsFr" || key === "notes"
        ? 1500
        : key === "business"
          ? 400
          : 160;
    if (
      typeof text !== "string" ||
      text.length > limit ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
    )
      throw new ServiceError(
        "invalid_input",
        `${key} must be text of at most ${limit} characters.`,
      );
    result[key] = text.trim();
  }
  const logo = b.logoImage ?? "";
  if (
    typeof logo !== "string" ||
    logo.length > 450000 ||
    (logo && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logo))
  )
    throw new ServiceError(
      "invalid_input",
      "Logo artwork must be a PNG/JPEG under 300 KB.",
    );
  result.logoImage = logo;
  const logoRatio = b.logoRatio ?? 1;
  if (
    typeof logoRatio !== "number" ||
    !Number.isFinite(logoRatio) ||
    logoRatio < 0.1 ||
    logoRatio > 10
  )
    throw new ServiceError(
      "invalid_input",
      "Logo image proportions are unsupported.",
    );
  result.logoRatio = logoRatio;
  const logoWidth = b.logoWidthMm ?? 30;
  if (
    typeof logoWidth !== "number" ||
    !Number.isFinite(logoWidth) ||
    logoWidth < 10 ||
    logoWidth > 80
  )
    throw new ServiceError(
      "invalid_input",
      "Logo width must be between 10 and 80 mm.",
    );
  result.logoWidthMm = logoWidth;
  result.honeyPreset = b.honeyPreset === true;
  result.noBestBefore = b.noBestBefore === true;
  const rawOverrides = b.overrides ?? [];
  if (!Array.isArray(rawOverrides) || rawOverrides.length > 100)
    throw new ServiceError(
      "invalid_input",
      "Les contournements consignés sont invalides.",
    );
  result.overrides = rawOverrides.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ServiceError(
        "invalid_input",
        "Contournement consigné invalide.",
      );
    const o = entry as Record<string, unknown>;
    const text = (v: unknown, max: number) => {
      if (
        typeof v !== "string" ||
        v.length > max ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
      )
        throw new ServiceError(
          "invalid_input",
          "Contournement consigné invalide.",
        );
      return v.trim();
    };
    if (o.role !== "admin" && o.role !== "employee")
      throw new ServiceError(
        "invalid_input",
        "Contournement consigné invalide.",
      );
    if (o.method !== "note" && o.method !== "code")
      throw new ServiceError(
        "invalid_input",
        "Contournement consigné invalide.",
      );
    return {
      issue: text(o.issue, 300),
      by: text(o.by, 160),
      role: o.role,
      method: o.method,
      note: text(o.note, 600),
      at: text(o.at, 40),
    };
  });
  const image = b.nutritionImage ?? "";
  if (
    typeof image !== "string" ||
    image.length > 450000 ||
    (image && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image))
  )
    throw new ServiceError(
      "invalid_input",
      "Nutrition artwork must be a PNG/JPEG under 300 KB.",
    );
  result.nutritionImage = image;
  const ratio = b.nutritionRatio ?? 1.5;
  if (
    typeof ratio !== "number" ||
    !Number.isFinite(ratio) ||
    ratio < 0.5 ||
    ratio > 4
  )
    throw new ServiceError(
      "invalid_input",
      "Nutrition image proportions are unsupported.",
    );
  result.nutritionRatio = ratio;
  const panelWidth = b.nutritionWidthMm ?? 40;
  if (
    typeof panelWidth !== "number" ||
    !Number.isFinite(panelWidth) ||
    panelWidth < 25 ||
    panelWidth > 100
  )
    throw new ServiceError(
      "invalid_input",
      "Nutrition panel width must be between 25 and 100 mm.",
    );
  result.nutritionWidthMm = panelWidth;
  const status = b.nutritionStatus ?? "unreviewed";
  if (!["unreviewed", "provided", "exempt"].includes(String(status)))
    throw new ServiceError(
      "invalid_input",
      "Choose a nutrition review status.",
    );
  result.nutritionStatus = status as LabelConfig["nutritionStatus"];
  if (
    typeof (b.nutritionExemption ?? "") !== "string" ||
    String(b.nutritionExemption ?? "").length > 400
  )
    throw new ServiceError(
      "invalid_input",
      "Nutrition exemption note is too long.",
    );
  result.nutritionExemption = String(b.nutritionExemption ?? "").trim();
  result.gs1Confirmed = b.gs1Confirmed === true;
  result.textReviewed = b.textReviewed === true;
  result.quebec = quebecReviewInput(
    b.quebec,
    /miel\s*aissa/i.test(result.brand),
  );
  return result;
}
export function readLabelConfig(value: unknown, brand = ""): LabelConfig {
  if (!value) return defaultLabelConfig(brand);
  try {
    return labelConfigInput(value);
  } catch {
    return defaultLabelConfig(brand);
  }
}
export function barcodeMatchesScan(
  product: Pick<LabelProduct, "sku" | "gtin">,
  scanned: string,
): boolean {
  const code = scanned.trim();
  return (
    code.toUpperCase() === product.sku.toUpperCase() ||
    (!!product.gtin &&
      /^\d{12,13}$/.test(code) &&
      code.padStart(13, "0") === product.gtin.padStart(13, "0"))
  );
}
export function labelReadiness(
  product: LabelProduct,
  config: LabelConfig,
): string[] {
  const result: string[] = [];
  if (!product.gtin)
    result.push("Add the product’s assigned GS1 UPC/EAN for a retail barcode.");
  if (!config.gs1Confirmed)
    result.push(
      "Confirm that this GS1 number belongs to this product and business.",
    );
  if (!config.brand || !config.nameFr || !config.business || !config.origin)
    result.push(
      "Complete brand, French product name, legal business/address and country-of-origin text.",
    );
  if (
    config.nutritionStatus === "unreviewed" ||
    (config.nutritionStatus === "provided" && !config.nutritionImage) ||
    (config.nutritionStatus === "exempt" && !config.nutritionExemption)
  )
    result.push(
      "Provide approved Nutrition Facts artwork, or record the reviewed exemption that applies.",
    );
  if (!config.textReviewed)
    result.push(
      "Review the required food-label information before producing final packaging.",
    );
  result.push(...quebecReviewIssues(config.quebec));
  if (config.quebec.enabled) {
    if (!config.principalDisplayAreaCm2)
      result.push(
        "Confirmer la principale surface exposée (PSE) pour dimensionner les déclarations réglementaires.",
      );
    if (!config.ingredientsFr)
      result.push(
        "Renseigner la composition française imprimée sur cette maquette.",
      );
    if (!hasMetricHoneyMass(product.size))
      result.push(
        "Miel au Québec : saisir le poids net confirmé en g ou kg; la capacité du pot en mL ne le remplace pas.",
      );
    if (!config.lot)
      result.push(
        "Ajouter le lot de conditionnement pour la distribution prévue et son registre de traçabilité.",
      );
  }
  return result;
}

/** Business details supplied by the owner; jar size and recipe are still unconfirmed. */
export function mielAissaLabelConfig(): LabelConfig {
  return {
    ...defaultLabelConfig("MIEL AISSA"),
    theme: "honey",
    nameFr: "Miel",
    // Le produit de départ est un miel pur : preset miel appliqué (ingrédient
    // unique standard, pas de date d'expiration). Modifiable dans le studio.
    honeyPreset: true,
    noBestBefore: true,
    ingredientsFr: HONEY_SINGLE_INGREDIENT_FR,
    business: "MIEL AISSA\n5837 Rue Jean-Talon E\nH1S 1M4\nMIELAISSA.CA",
    origin: "Produit du Québec",
  };
}
