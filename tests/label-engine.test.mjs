// Moteur d'étiquettes : GS1 durci, éléments du studio visuel, fond,
// rotation et PDF — tests unitaires sur les sources TypeScript.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gtinCheckDigit,
  ean13,
  upcA,
  retailBarcode,
  barcodeSvg,
} from "../dist/engine/barcodes.js";
import { normalizeGtin } from "../dist/engine/validation.js";
import {
  defaultLabelConfig,
  labelConfigInput,
} from "../dist/engine/label-config.js";
import { buildLabelScene, rotatedAnchor } from "../dist/engine/label-layout.js";
import { labelPdf } from "../dist/engine/label-pdf.js";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const product = {
  id: "label",
  businessBrandId: "label",
  name: "Miel",
  sku: "AISSA",
  category: "Honey",
  size: "250 g",
  ingredients: "Miel",
  gtin: "036000291452",
};

test("GS1 : chiffre de contrôle calculé, complété et validé (UPC-A et EAN-13)", () => {
  // Ancres réelles : 036000291452 (UPC-A connu) et 4006381333931 (EAN-13 connu).
  assert.equal(gtinCheckDigit("03600029145"), 2);
  assert.equal(gtinCheckDigit("400638133393"), 1);
  // Saisie sans le chiffre de contrôle : il est calculé et ajouté.
  assert.equal(upcA("03600029145").text, "036000291452");
  assert.equal(ean13("400638133393").text, "4006381333931");
  // Saisie complète valide : acceptée telle quelle.
  assert.equal(upcA("036000291452").text, "036000291452");
  assert.equal(ean13("4006381333931").text, "4006381333931");
  // Chiffre de contrôle faux : refusé, en français, avec le bon chiffre.
  assert.throws(() => upcA("036000291453"), /chiffre de contrôle UPC-A est invalide/);
  assert.throws(() => ean13("4006381333932"), /chiffre de contrôle EAN-13 est invalide/);
  assert.throws(() => upcA("123"), /11 chiffres.*ou 12 chiffres/);
  assert.throws(() => ean13("40063813339A"), /que des chiffres/);
  // Corps du code Miel Aïssa lu sur l'étiquette : l'algorithme GS1 standard
  // (le même que normalizeGtin) donne 7 — voir la note dans la PR #7.
  assert.equal(gtinCheckDigit("89466032577"), 7);
  const miel = retailBarcode("89466032577");
  assert.equal(miel.kind, "upc-a");
  assert.equal(miel.display, "894660325777");
  // Cohérence moteur ↔ validation produit.
  assert.equal(normalizeGtin("036000291452"), "0036000291452");
  assert.throws(() => normalizeGtin("036000291453"), /chiffre de contrôle/);
});

test("GS1 : zones de silence et rendu SVG autonome", () => {
  const code = ean13("4006381333931");
  assert.equal(code.width, 117);
  // Aucune barre dans les zones de silence de 11 modules, des deux côtés.
  assert.equal(Math.min(...code.bars.map((b) => b.x)), 11);
  assert.equal(Math.max(...code.bars.map((b) => b.x + b.width)), 106);
  const svg = barcodeSvg("036000291452", "upc-a", 37.29, 25.93);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 37\.29 25\.93"/);
  assert.ok(svg.includes("036000291452"));
  assert.ok((svg.match(/<rect/g) ?? []).length > 40);
  assert.throws(() => barcodeSvg("036000291452", "upc-a", 5, 25), /Dimensions/);
});

test("studio visuel : la configuration valide et conserve les éléments posés", () => {
  const base = defaultLabelConfig("MIEL AISSA");
  const config = labelConfigInput({
    ...base,
    background: "#102030",
    elements: [
      {
        id: "el-1",
        kind: "text",
        x: 12,
        y: 9,
        widthMm: 60,
        rotation: 0,
        text: "Miel crémeux",
        fontSizeMm: 5,
        bold: true,
        colour: "#95661B",
        align: "center",
      },
      {
        id: "el-2",
        kind: "barcodeImage",
        x: 100,
        y: 10,
        widthMm: 37,
        rotation: 90,
        image: TINY_PNG,
        imageRatio: 1.4,
      },
    ],
  });
  assert.equal(config.background, "#102030");
  assert.equal(config.elements.length, 2);
  assert.equal(config.elements[0].text, "Miel crémeux");
  assert.equal(config.elements[1].rotation, 90);
  assert.throws(
    () =>
      labelConfigInput({
        ...base,
        elements: [{ id: "x", kind: "video", x: 0, y: 0, widthMm: 30 }],
      }),
    /Élément du studio invalide/,
  );
  assert.throws(
    () => labelConfigInput({ ...base, background: "rouge" }),
    /#rrggbb/,
  );
});

test("studio visuel : la scène pose les éléments où l'utilisateur les a mis, sans blocage", async () => {
  const config = labelConfigInput({
    ...defaultLabelConfig(""),
    background: "#102030",
    elements: [
      {
        id: "txt",
        kind: "text",
        x: 12,
        y: 9,
        widthMm: 60,
        rotation: 0,
        text: "Miel crémeux",
        fontSizeMm: 5,
        bold: true,
        colour: "",
        align: "left",
      },
      {
        id: "img",
        kind: "barcodeImage",
        x: 100,
        y: 10,
        widthMm: 37,
        rotation: 0,
        image: TINY_PNG,
        imageRatio: 1.4,
      },
      {
        id: "code",
        kind: "barcode",
        x: 150,
        y: 6,
        widthMm: 37,
        rotation: 90,
      },
    ],
  });
  const scene = await buildLabelScene(product, config);
  // Aucun blocage : la marque et l'origine sont vides, des points
  // facultatifs existent, mais la scène n'est pas une épreuve.
  assert.equal(scene.draft, false);
  assert.ok(scene.issues.length > 0);
  // Fond personnalisé en premier.
  assert.equal(scene.elements[0].kind, "rect");
  assert.equal(scene.elements[0].colour, "#102030");
  // Les trois boîtes, aux positions sauvegardées.
  assert.equal(scene.boxes.length, 3);
  const txt = scene.boxes.find((b) => b.id === "txt");
  assert.deepEqual([txt.x, txt.y, txt.width], [12, 9, 60]);
  const img = scene.elements.find((e) => e.id === "img");
  assert.equal(img.kind, "image");
  assert.deepEqual([img.x, img.y, img.width], [100, 10, 37]);
  assert.ok(Math.abs(img.height - 37 / 1.4) < 0.01);
  // Code-barres tourné : la boîte occupée échange largeur et hauteur.
  const code = scene.boxes.find((b) => b.id === "code");
  assert.equal(code.rotation, 90);
  assert.ok(code.height > 36 && code.width < code.height);
  // Le PDF se produit tel quel, éléments tournés compris.
  const pdf = await labelPdf(scene, "roll", 1);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 4)), "%PDF");
});

test("rotation : l'ancre PDF garde le centre de l'objet", () => {
  const a0 = rotatedAnchor(100, 50, 40, 20, 0);
  assert.deepEqual([a0.x, a0.y, a0.pdfDeg], [80, 40, 0]);
  const a180 = rotatedAnchor(100, 50, 40, 20, 180);
  assert.ok(Math.abs(a180.x - 120) < 1e-9 && Math.abs(a180.y - 60) < 1e-9);
  assert.equal(a180.pdfDeg, -180);
  const a90 = rotatedAnchor(100, 50, 40, 20, 90);
  assert.ok(Math.abs(a90.x - 90) < 1e-9 && Math.abs(a90.y - 70) < 1e-9);
});
