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
 * Ancien contournement d'un prérequis, consigné avec l'étiquette. Le
 * mécanisme a été aboli par l'ordre du propriétaire du 2026-11-27 (« Enlever
 * vérification obligatoire ») : les vérifications sont devenues des points
 * facultatifs qui ne bloquent plus rien, il n'y a plus ni contournement, ni
 * note du directeur, ni code maître. Les entrées déjà consignées restent
 * lisibles dans les modèles sauvegardés, à titre d'historique seulement.
 */
export type LabelOverride = {
  issue: string;
  by: string;
  role: "admin" | "employee";
  method: "note" | "code";
  note: string;
  at: string;
};
/**
 * Élément posé librement sur le canevas du studio visuel (« mon propre
 * Canva », ordre du propriétaire du 2026-11-27). L'utilisateur déplace
 * chaque élément au doigt ou à la souris ; la position, la largeur et la
 * rotation choisies sont sauvegardées avec le modèle et respectées dans
 * l'aperçu et le PDF. `logo` et `nutrition` reprennent les images des
 * champs historiques du modèle ; `barcode` est généré depuis le numéro
 * GS1 (ou le SKU) du produit ; `barcodeImage` est le code-barres ou le
 * code QR déjà créé par GS1, téléversé en image ; `image` est n'importe
 * quelle autre image téléversée ; `text` est un bloc de texte libre.
 */
export type PlacedElementKind =
  | "logo"
  | "nutrition"
  | "barcode"
  | "barcodeImage"
  | "image"
  | "text";
export type PlacedElement = {
  id: string;
  kind: PlacedElementKind;
  /** Coin supérieur gauche sur l'étiquette, en mm. */
  x: number;
  y: number;
  widthMm: number;
  /** Rotation dans le sens horaire : 0, 90, 180 ou 270 degrés. */
  rotation: number;
  /** Image téléversée (kinds `image` et `barcodeImage`), data URL. */
  image: string;
  imageRatio: number;
  /** Bloc de texte libre (kind `text`). */
  text: string;
  fontSizeMm: number;
  bold: boolean;
  /** Couleur du texte, `#rrggbb` ; vide = noir du thème. */
  colour: string;
  align: "left" | "center" | "right";
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
  /** Couleur de fond de l'étiquette (`#rrggbb`) ; vide = fond du thème. */
  background: string;
  /** Image de fond téléversée, posée sur toute l'étiquette ; vide = aucune. */
  backgroundImage: string;
  backgroundRatio: number;
  /**
   * Éléments du studio visuel. Vide = disposition automatique historique.
   * Dès qu'il y a un élément, le canevas libre fait foi : seuls ces
   * éléments sont dessinés (plus le fond), aux positions sauvegardées.
   */
  elements: PlacedElement[];
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
    background: "",
    backgroundImage: "",
    backgroundRatio: 1,
    elements: [],
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
  result.background = placedColour(b.background ?? "", "background");
  result.backgroundImage = placedImage(
    b.backgroundImage ?? "",
    "L’image de fond doit être un PNG/JPEG de 300 Ko maximum.",
  );
  result.backgroundRatio = placedRatio(b.backgroundRatio ?? 1, "backgroundRatio");
  result.elements = placedElementsInput(b.elements ?? []);
  return result;
}
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
const DATA_IMAGE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
function placedColour(value: unknown, name: string): string {
  if (typeof value !== "string" || (value !== "" && !HEX_COLOUR.test(value)))
    throw new ServiceError(
      "invalid_input",
      `La couleur ${name} doit être au format #rrggbb.`,
    );
  return value;
}
function placedImage(value: unknown, message: string): string {
  if (
    typeof value !== "string" ||
    value.length > 450000 ||
    (value !== "" && !DATA_IMAGE.test(value))
  )
    throw new ServiceError("invalid_input", message);
  return value;
}
function placedRatio(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0.1 ||
    value > 10
  )
    throw new ServiceError(
      "invalid_input",
      `Les proportions ${name} ne sont pas prises en charge.`,
    );
  return value;
}
function placedNumber(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    throw new ServiceError(
      "invalid_input",
      `${name} doit être compris entre ${min} et ${max}.`,
    );
  return Math.round(value * 10) / 10;
}
export const PLACED_ELEMENT_KINDS: PlacedElementKind[] = [
  "logo",
  "nutrition",
  "barcode",
  "barcodeImage",
  "image",
  "text",
];
function placedElementsInput(value: unknown): PlacedElement[] {
  if (!Array.isArray(value) || value.length > 40)
    throw new ServiceError(
      "invalid_input",
      "Les éléments du studio sont invalides (40 maximum).",
    );
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new ServiceError("invalid_input", "Élément du studio invalide.");
    const e = entry as Record<string, unknown>;
    if (
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,40}$/.test(e.id) ||
      !PLACED_ELEMENT_KINDS.includes(e.kind as PlacedElementKind)
    )
      throw new ServiceError("invalid_input", "Élément du studio invalide.");
    const rotation = e.rotation ?? 0;
    if (![0, 90, 180, 270].includes(rotation as number))
      throw new ServiceError(
        "invalid_input",
        "La rotation d’un élément doit être 0, 90, 180 ou 270 degrés.",
      );
    const text = e.text ?? "";
    if (
      typeof text !== "string" ||
      text.length > 1500 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
    )
      throw new ServiceError(
        "invalid_input",
        "Le texte d’un élément doit contenir au plus 1 500 caractères.",
      );
    const align = e.align ?? "left";
    if (!["left", "center", "right"].includes(String(align)))
      throw new ServiceError("invalid_input", "Alignement d’élément invalide.");
    return {
      id: e.id,
      kind: e.kind as PlacedElementKind,
      x: placedNumber(e.x ?? 0, "La position horizontale d’un élément", 0, 400),
      y: placedNumber(e.y ?? 0, "La position verticale d’un élément", 0, 400),
      widthMm: placedNumber(e.widthMm ?? 30, "La largeur d’un élément", 5, 400),
      rotation: rotation as number,
      image: placedImage(
        e.image ?? "",
        "L’image d’un élément doit être un PNG/JPEG de 300 Ko maximum.",
      ),
      imageRatio: placedRatio(e.imageRatio ?? 1, "imageRatio"),
      text: text.trim(),
      fontSizeMm: placedNumber(
        e.fontSizeMm ?? 3.5,
        "La taille du texte d’un élément",
        2,
        12,
      ),
      bold: e.bold === true,
      colour: placedColour(e.colour ?? "", "colour"),
      align: align as PlacedElement["align"],
    };
  });
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
/**
 * Points à vérifier (facultatif). Depuis l'ordre du propriétaire du
 * 2026-11-27, cette liste est un rappel seulement : elle ne bloque ni la
 * sauvegarde, ni l'aperçu, ni l'export, ni l'impression, et il n'existe
 * aucun mécanisme de contournement. Le studio l'affiche pour mémoire.
 */
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
