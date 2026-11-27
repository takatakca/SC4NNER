export type Bar = { x: number; width: number };
const characters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*";
const patterns = [
  0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064, 0x109,
  0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c, 0x103, 0x043,
  0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016, 0x181, 0x0c1, 0x1c0,
  0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4, 0x0a8, 0x0a2, 0x08a, 0x02a, 0x094,
];
export function code39(value: string): {
  bars: Bar[];
  width: number;
  text: string;
} {
  if (!/^[A-Z0-9 -]{1,40}$/.test(value))
    throw new Error("Unsupported internal SKU");
  let x = 20;
  const bars: Bar[] = [];
  for (const char of `*${value}*`) {
    const pattern = patterns[characters.indexOf(char)];
    for (let i = 0; i < 9; i++) {
      const width = pattern & (1 << (8 - i)) ? 3 : 1;
      if (i % 2 === 0) bars.push({ x, width });
      x += width;
    }
    x++;
  }
  return { bars, width: x + 20, text: value };
}
const left = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
];
const even = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
];
const parity = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGLGL",
];
/**
 * Chiffre de contrôle GS1 (mod-10) d'un corps de numéro SANS son chiffre de
 * contrôle : en partant de la droite du corps, les chiffres sont multipliés
 * par 3, 1, 3, 1… en commençant par 3 pour le chiffre juste à gauche du
 * chiffre de contrôle. Même algorithme que la validation des produits
 * (normalizeGtin) : un numéro accepté d'un côté l'est de l'autre.
 */
export function gtinCheckDigit(body: string): number {
  if (!/^\d+$/.test(body))
    throw new Error("Le numéro GS1 ne doit contenir que des chiffres.");
  const sum = [...body]
    .reverse()
    .reduce((n, c, i) => n + Number(c) * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}
export type RetailBarcodeKind = "upc-a" | "ean-13";
export type RetailBarcode = {
  kind: RetailBarcodeKind;
  /** Numéro complet sur 13 chiffres (UPC-A précédé d'un 0). */
  digits: string;
  /** Numéro tel qu'il s'imprime sous les barres (12 chiffres UPC, 13 EAN). */
  display: string;
  checkDigit: number;
  bars: Bar[];
  width: number;
};
const KIND_LABEL: Record<RetailBarcodeKind, string> = {
  "upc-a": "UPC-A",
  "ean-13": "EAN-13",
};
/**
 * Complète ou valide un numéro de détail. La saisie est acceptée AVEC ou
 * SANS le chiffre de contrôle : UPC-A = 11 chiffres (corps) ou 12 (complet),
 * EAN-13 = 12 chiffres (corps) ou 13 (complet). Un chiffre de contrôle
 * présent mais faux est refusé, avec le bon chiffre indiqué.
 */
export function completeRetailBarcode(
  value: string,
  kind: RetailBarcodeKind,
): string {
  const label = KIND_LABEL[kind];
  const fullLength = kind === "upc-a" ? 12 : 13;
  const s = value.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s))
    throw new Error(`Le numéro ${label} ne doit contenir que des chiffres.`);
  if (s.length === fullLength - 1) return s + gtinCheckDigit(s);
  if (s.length === fullLength) {
    const expected = gtinCheckDigit(s.slice(0, -1));
    if (expected !== Number(s.at(-1)))
      throw new Error(
        `Le chiffre de contrôle ${label} est invalide : le numéro se termine par ${s.at(-1)}, il devrait se terminer par ${expected}.`,
      );
    return s;
  }
  throw new Error(
    `Le numéro ${label} doit compter ${fullLength - 1} chiffres (sans le chiffre de contrôle) ou ${fullLength} chiffres (avec).`,
  );
}
function encodeEan13(s: string): { bars: Bar[]; width: number } {
  let bits = "101";
  for (let i = 1; i < 7; i++)
    bits += (parity[Number(s[0])][i - 1] === "L" ? left : even)[Number(s[i])];
  bits += "01010";
  for (let i = 7; i < 13; i++)
    bits += left[Number(s[i])].replace(/[01]/g, (bit) =>
      bit === "0" ? "1" : "0",
    );
  bits += "101";
  return {
    bars: [...bits].flatMap((bit, i) =>
      bit === "1" ? [{ x: i + 11, width: 1 }] : [],
    ),
    width: 117,
  };
}
export function ean13(value: string): {
  bars: Bar[];
  width: number;
  text: string;
} {
  const s = completeRetailBarcode(value, "ean-13");
  return { ...encodeEan13(s), text: s };
}
/** UPC-A : même symbole qu'un EAN-13 commençant par 0, texte de 12 chiffres. */
export function upcA(value: string): {
  bars: Bar[];
  width: number;
  text: string;
} {
  const s = completeRetailBarcode(value, "upc-a");
  return { ...encodeEan13(`0${s}`), text: s };
}
/**
 * Lit un numéro de détail tel que saisi : 11 chiffres = corps UPC-A,
 * 12 chiffres = UPC-A complet, 13 chiffres = EAN-13 complet (12 chiffres
 * peuvent aussi être un corps EAN-13 : utiliser alors ean13() directement).
 */
export function retailBarcode(value: string): RetailBarcode {
  const s = value.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s))
    throw new Error("Le numéro GS1 ne doit contenir que des chiffres.");
  if (s.length === 11 || s.length === 12) {
    const full = completeRetailBarcode(s, "upc-a");
    return {
      kind: "upc-a",
      digits: `0${full}`,
      display: full,
      checkDigit: Number(full.at(-1)),
      ...encodeEan13(`0${full}`),
    };
  }
  if (s.length === 13) {
    const full = completeRetailBarcode(s, "ean-13");
    return {
      kind: "ean-13",
      digits: full,
      display: full,
      checkDigit: Number(full.at(-1)),
      ...encodeEan13(full),
    };
  }
  throw new Error(
    "Le numéro GS1 doit compter 11 ou 12 chiffres (UPC-A) ou 13 chiffres (EAN-13).",
  );
}
/**
 * Rendu SVG autonome d'un code-barres de détail, aux dimensions demandées
 * (mm) : barres vectorielles, chiffres lisibles sous le symbole et zones de
 * silence incluses dans la largeur (117 modules au total). Les barres de
 * garde descendent un peu plus bas, comme sur les symboles imprimés.
 */
export function barcodeSvg(
  value: string,
  kind: RetailBarcodeKind,
  widthMm = 37.29,
  heightMm = 25.93,
): string {
  const code = kind === "upc-a" ? upcA(value) : ean13(value);
  if (
    !Number.isFinite(widthMm) ||
    widthMm < 15 ||
    widthMm > 200 ||
    !Number.isFinite(heightMm) ||
    heightMm < 10 ||
    heightMm > 200
  )
    throw new Error(
      "Dimensions du code-barres invalides : largeur de 15 à 200 mm, hauteur de 10 à 200 mm.",
    );
  const moduleMm = widthMm / code.width;
  const textMm = Math.max(2.6, heightMm * 0.16);
  const barMm = heightMm - textMm;
  const guardMm = barMm + textMm * 0.45;
  const rects = code.bars
    .map((bar) => {
      const guard = [0, 2, 46, 48, 92, 94].includes(bar.x - 11);
      return `<rect x="${(bar.x * moduleMm).toFixed(3)}" y="0" width="${(bar.width * moduleMm).toFixed(3)}" height="${(guard ? guardMm : barMm).toFixed(3)}"/>`;
    })
    .join("");
  const label = kind === "upc-a" ? "UPC-A" : "EAN-13";
  return `<svg role="img" aria-label="Code-barres ${label} ${code.text}" viewBox="0 0 ${widthMm} ${heightMm}" width="${widthMm}mm" height="${heightMm}mm" xmlns="http://www.w3.org/2000/svg"><g fill="#000">${rects}</g><text x="${(widthMm / 2).toFixed(3)}" y="${heightMm}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="${textMm.toFixed(3)}">${code.text}</text></svg>`;
}
export function csvCell(value: string | number): string {
  const s = String(value);
  return (
    '"' + (/^[\s]*[=+\-@]/.test(s) ? "'" + s : s).replace(/"/g, '""') + '"'
  );
}
