import {
  mielAissaLabelConfig,
  readLabelConfig,
  barcodeMatchesScan,
  HONEY_SINGLE_INGREDIENT_FR,
  type LabelConfig,
  type LabelProduct,
  type PlacedElement,
} from "./src/label-config";
import {
  buildLabelScene,
  type LabelScene,
  type LabelPaper,
} from "./src/label-layout";
import { upcA } from "./src/barcodes";
import { labelPdf } from "./src/label-pdf";
import { quebecRequirements } from "./src/quebec-requirements";
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
type SavedLabel = {
  id: string;
  version: number;
  title: string;
  payload: {
    product: LabelProduct;
    config: LabelConfig;
    inventory?: InventoryLink | null;
  };
};
// Lien vers un produit de l'inventaire TAKATAK (V1) : l'étiquette part du
// produit réel, son SKU et son code UPC/EAN sont ceux de l'inventaire.
type InventoryLink = {
  productId: string;
  clientId: string;
  businessBrandId: string;
  brandName: string;
  name: string;
  sku: string;
  gtin: string | null;
  category: string;
};
type InventoryProduct = {
  id: string;
  businessBrandId: string;
  name: string;
  sku: string;
  category: string;
  size: string;
  ingredients: string;
  gtin: string | null;
  priceCents: number;
  quantity: number;
  threshold: number;
};
type InventoryWorkspace = {
  clientId: string;
  clientName: string;
  brands: { id: string; name: string }[];
  products: InventoryProduct[];
};
const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Action impossible. Réessayez.";
let config = mielAissaLabelConfig(),
  scene: LabelScene | null = null,
  lastScene: LabelScene | null = null,
  selectedEl: string | null = null,
  revision = 0,
  current: { id: string; version: number } | null = null,
  records: SavedLabel[] = [],
  inventoryLink: InventoryLink | null = null,
  inventoryCatalog: InventoryWorkspace[] = [],
  role: "admin" | "employee" | null = null;
config.heightMm = 80;
config.origin = "";
const fields = [
  "brand",
  "logoWidthMm",
  "nameFr",
  "ingredientsFr",
  "honeyPreset",
  "business",
  "origin",
  "lot",
  "bestBefore",
  "noBestBefore",
  "widthMm",
  "heightMm",
  "jarShape",
  "flatFaceWidthMm",
  "principalDisplayAreaCm2",
  "dpi",
  "orientation",
  "theme",
  "gs1Confirmed",
  "textReviewed",
  "grade",
  "colour",
  "storage",
  "nutritionStatus",
  "nutritionWidthMm",
  "nutritionExemption",
];
const numeric = new Set([
  "logoWidthMm",
  "widthMm",
  "heightMm",
  "flatFaceWidthMm",
  "principalDisplayAreaCm2",
  "dpi",
  "nutritionWidthMm",
]);
const escape = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function product() {
  const rawGtin = $("gtin").value.trim();
  let gtin: string | null = rawGtin || null;
  if (rawGtin && /^\d{11}$/.test(rawGtin)) {
    // Corps UPC-A saisi sans son chiffre de contrôle : on le complète,
    // le studio accepte le numéro GS1 avec ou sans le dernier chiffre.
    try {
      gtin = upcA(rawGtin).text;
    } catch {
      gtin = rawGtin;
    }
  }
  return {
    id: inventoryLink?.productId ?? "label",
    businessBrandId: inventoryLink?.businessBrandId ?? "label",
    name: $("nameFr").value,
    category: inventoryLink?.category ?? "Honey",
    sku: $("sku").value.trim().toUpperCase(),
    size: $("size").value.trim() || "Poids à confirmer",
    ingredients: $("ingredientsFr").value,
    gtin,
  };
}
function renderReviews() {
  const host = $("quebec");
  host.innerHTML = "";
  for (const r of quebecRequirements) {
    const box = document.createElement("div");
    box.innerHTML = `<label>${escape(r.title)}<select id="review-${r.key}"><option value="pending">À vérifier</option><option value="recorded">Vérifié — pièce référencée</option>${r.allowNotApplicable ? '<option value="not_applicable">Non applicable — justification</option>' : ""}</select></label><label>Référence du document<input id="ref-${r.key}" maxlength="600"></label>`;
    host.append(box);
    $(`review-${r.key}`).value = config.quebec.items[r.key].status;
    $(`ref-${r.key}`).value = config.quebec.items[r.key].reference;
  }
}
function formToConfig() {
  for (const f of fields) {
    const el = $(f);
    (config as unknown as Record<string, unknown>)[f] =
      el.type === "checkbox"
        ? el.checked
        : numeric.has(f)
          ? Number(el.value)
          : el.value;
  }
  for (const r of quebecRequirements) {
    config.quebec.items[r.key] = {
      status: $(`review-${r.key}`).value as
        "pending" | "recorded" | "not_applicable",
      reference: $(`ref-${r.key}`).value,
    };
  }
}
function renderLogo() {
  const has = Boolean(config.logoImage);
  $("logo-tools").hidden = !has;
  if (has) $("logo-thumb").src = config.logoImage;
  else $("logo-file").value = "";
}
function configToForm() {
  for (const f of fields) {
    const el = $(f);
    if (el.type === "checkbox")
      el.checked = !!(config as unknown as Record<string, unknown>)[f];
    else
      el.value = String(
        (config as unknown as Record<string, unknown>)[f] ?? "",
      );
  }
  $("bestBefore").disabled = config.noBestBefore;
  renderLogo();
  renderReviews();
  renderCanvasTools();
}
const BOX_PLACEHOLDERS: Record<string, string> = {
  logo: "Logo à téléverser",
  nutrition: "Affiche à téléverser",
  barcodeImage: "Code-barres en image",
  image: "Image à téléverser",
  text: "Texte vide",
};
function paint(s: LabelScene) {
  lastScene = s;
  const parts: string[] = [];
  for (const e of s.elements) {
    let g = "";
    if (e.kind === "rect")
      g = `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" fill="${e.colour}"/>`;
    else if (e.kind === "text")
      g = `<text x="${e.x}" y="${e.y}" font-size="${e.size}" font-family="Arial,Helvetica,sans-serif" font-weight="${e.bold ? 700 : 400}" fill="${e.colour}">${escape(e.text)}</text>`;
    else if (e.kind === "textblock") {
      const lines = e.lines
        .map(
          (line, i) =>
            `<text x="${e.x + line.dx}" y="${e.y + e.size + i * e.lineHeight}" font-size="${e.size}" font-family="Arial,Helvetica,sans-serif" font-weight="${e.bold ? 700 : 400}" fill="${e.colour}">${escape(line.text)}</text>`,
        )
        .join("");
      g = e.rotation
        ? `<g transform="rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.height / 2})">${lines}</g>`
        : lines;
    } else if (e.kind === "image") {
      const img = `<image x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" href="${escape(e.data)}"/>`;
      g = e.rotation
        ? `<g transform="rotate(${e.rotation} ${e.x + e.width / 2} ${e.y + e.height / 2})">${img}</g>`
        : img;
    } else
      g = `<g transform="${e.rotated ? `translate(${e.x + e.height} ${e.y}) rotate(90)` : `translate(${e.x} ${e.y})`}">${e.bars.map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="${b.height}" fill="#111"/>`).join("")}<text x="${e.width / 2}" y="${e.barHeight + 4}" text-anchor="middle" font-family="Arial" font-size="3.2">${escape(e.text)}</text></g>`;
    parts.push(e.id ? `<g data-el="${escape(e.id)}">${g}</g>` : g);
  }
  // Éléments sans contenu (ex. logo pas encore téléversé) : un repère
  // pointillé qu'on peut quand même attraper et déplacer.
  for (const b of s.boxes) {
    if (!b.missing) continue;
    parts.push(
      `<g data-el="${escape(b.id)}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${Math.max(b.height, 8)}" fill="#eef2f7" stroke="#98a8bd" stroke-dasharray="2 1.5"/><text x="${b.x + b.width / 2}" y="${b.y + Math.max(b.height, 8) / 2 + 1}" text-anchor="middle" font-family="Arial" font-size="2.6" fill="#5c6a80">${escape(BOX_PLACEHOLDERS[b.kind] ?? "Élément vide")}</text></g>`,
    );
  }
  // Cadre de sélection de l'élément choisi, avec poignée de redimensionnement.
  const sel = s.boxes.find((b) => b.id === selectedEl);
  if (sel) {
    const h = Math.max(sel.height, 8);
    parts.push(
      `<g pointer-events="none" transform="rotate(${sel.rotation} ${sel.x + sel.width / 2} ${sel.y + h / 2})"><rect x="${sel.x}" y="${sel.y}" width="${sel.width}" height="${h}" fill="none" stroke="#1565D8" stroke-width="0.5" stroke-dasharray="1.6 1.1"/><rect data-handle="resize" pointer-events="all" x="${sel.x + sel.width - 2.5}" y="${sel.y + h - 2.5}" width="5" height="5" fill="#1565D8"/></g>`,
    );
  }
  $("preview").innerHTML =
    `<svg role="img" aria-label="Aperçu de l’étiquette" viewBox="0 0 ${s.width} ${s.height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
function renderPoints(s: LabelScene) {
  const host = $("overrides");
  const parts: string[] = [];
  if (s.issues.length) {
    const items = s.issues
      .map((issue) => `<li>${escape(issue)}</li>`)
      .join("");
    parts.push(
      `<h3>Points à vérifier (facultatif)</h3><p class="muted">Des rappels seulement : ils ne bloquent ni la sauvegarde, ni l’aperçu, ni le PDF. Faites vos vérifications dans le formulaire quand vous le pouvez — aucune autorisation, aucun code, aucun contournement.</p><ul>${items}</ul>`,
    );
  }
  if (config.overrides.length) {
    const items = config.overrides
      .map(
        (o) =>
          `<li>${escape(o.issue)}<br><span class="muted">${escape(o.by)} — ${escape(o.at.slice(0, 10))}</span></li>`,
      )
      .join("");
    parts.push(
      `<h3>Anciens contournements consignés (historique)</h3><ul>${items}</ul>`,
    );
  }
  host.innerHTML = parts.join("");
}
async function preview() {
  const n = ++revision;
  try {
    formToConfig();
    $("bestBefore").disabled = config.noBestBefore;
    const s = await buildLabelScene(product(), config);
    if (n !== revision) return;
    scene = s;
    paint(s);
    $("pdf").disabled = false;
    $("readiness").textContent = s.issues.length
      ? `Étiquette prête à exporter.\nPoints à vérifier (facultatif) : ${s.issues.length} — ils ne bloquent ni la sauvegarde ni le PDF.`
      : "Étiquette prête à exporter. Vérifiez l’étiquette imprimée et la lecture réelle avant la production.";
    renderPoints(s);
  } catch (e: unknown) {
    if (n !== revision) return;
    scene = null;
    $("pdf").disabled = true;
    $("readiness").textContent =
      errorMessage(e) || "Vérifiez les dimensions et le code-barres.";
  }
}
async function api<T = { ok: boolean }>(path: string, body?: unknown) {
  const res = await fetch(
    "/api/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data: unknown = await res.json();
  if (!res.ok)
    throw new Error(
      typeof data === "object" && data !== null && "error" in data
        ? String(data.error)
        : "Action impossible",
    );
  return data as T;
}
async function load() {
  records = (await api<{ labels: SavedLabel[] }>("labels")).labels;
  const select = $("saved");
  select.innerHTML = '<option value="">Mes étiquettes sauvegardées</option>';
  for (const r of records) {
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.title;
    select.append(opt);
  }
  if (current) select.value = current.id;
}
async function loadInventory() {
  const block = $("inventory-import");
  try {
    const data = await api<{
      linked: boolean;
      workspaces: InventoryWorkspace[];
    }>("inventory/products");
    inventoryCatalog = data.linked ? data.workspaces : [];
  } catch {
    inventoryCatalog = [];
  }
  const select = $("inventory-product");
  select.innerHTML =
    '<option value="">Choisir un produit de l’inventaire…</option>';
  for (const workspace of inventoryCatalog) {
    const brandName = (id: string) =>
      workspace.brands.find((b) => b.id === id)?.name ?? "";
    const groups = new Map<string, InventoryProduct[]>();
    for (const p of workspace.products) {
      const key = brandName(p.businessBrandId);
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    for (const [brand, products] of groups) {
      const group = document.createElement("optgroup");
      group.label = brand
        ? `${workspace.clientName} — ${brand}`
        : workspace.clientName;
      for (const p of products) {
        const opt = document.createElement("option");
        opt.value = `${workspace.clientId}|${p.id}`;
        opt.textContent = `${p.name} — ${p.size} (SKU ${p.sku}) · en stock : ${p.quantity}`;
        group.append(opt);
      }
      select.append(group);
    }
  }
  block.hidden = inventoryCatalog.length === 0;
  showInventoryLink();
}
function showInventoryLink() {
  $("inventory-status").textContent = inventoryLink
    ? `Étiquette liée à l’inventaire TAKATAK : ${inventoryLink.name} (SKU ${inventoryLink.sku}). Changer le SKU ou le code UPC/EAN à la main retire le lien.`
    : "";
}
async function show() {
  $("login").hidden = true;
  $("app").hidden = false;
  $("logout").hidden = false;
  try {
    const s = await api<{
      role?: string | null;
      email?: string | null;
      username?: string | null;
    }>("session");
    role =
      s.role === "admin" ? "admin" : s.role === "employee" ? "employee" : null;
    // Le compte connecté s'affiche : le courriel du compte TAKATAK lié
    // quand il y en a un, sinon le nom d'utilisateur de l'atelier.
    const accountLabel = s.email || s.username || "";
    $("account").textContent = accountLabel;
    $("account").hidden = !accountLabel;
  } catch {
    role = null;
  }
  await load();
  await loadInventory();
  await preview();
}
$("logout").onclick = async () => {
  try {
    await api("logout", {});
    location.reload();
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
$("inventory-use").onclick = () => {
  const [clientId, productId] = $("inventory-product").value.split("|");
  const workspace = inventoryCatalog.find((w) => w.clientId === clientId);
  const found = workspace?.products.find((p) => p.id === productId);
  if (!workspace || !found) {
    $("messages").textContent =
      "Choisissez d’abord un produit de l’inventaire.";
    return;
  }
  const brandName =
    workspace.brands.find((b) => b.id === found.businessBrandId)?.name ?? "";
  if (brandName) $("brand").value = brandName;
  $("nameFr").value = found.name;
  $("ingredientsFr").value = found.ingredients;
  $("size").value = found.size;
  $("sku").value = found.sku;
  $("gtin").value = found.gtin ?? "";
  inventoryLink = {
    productId: found.id,
    clientId: workspace.clientId,
    businessBrandId: found.businessBrandId,
    brandName,
    name: found.name,
    sku: found.sku,
    gtin: found.gtin,
    category: found.category,
  };
  // Comme une saisie manuelle : les confirmations repartent à vérifier.
  config.gs1Confirmed = false;
  config.textReviewed = false;
  $("gs1Confirmed").checked = false;
  $("textReviewed").checked = false;
  for (const r of quebecRequirements)
    config.quebec.items[r.key].status = "pending";
  renderReviews();
  showInventoryLink();
  $("messages").textContent =
    "Produit de l’inventaire chargé. Vérifiez les mentions, puis sauvegardez.";
  void preview();
};
$("editor").addEventListener("input", (event) => {
  const target = event.target as HTMLInputElement;
  if (
    inventoryLink &&
    ((target.id === "sku" &&
      $("sku").value.trim().toUpperCase() !==
        inventoryLink.sku.toUpperCase()) ||
      (target.id === "gtin" &&
        $("gtin").value.trim() !== (inventoryLink.gtin ?? "")))
  ) {
    // Le code ne vient plus de l'inventaire : le lien ne tient plus.
    inventoryLink = null;
    showInventoryLink();
  }
  if (
    [
      "brand",
      "nameFr",
      "ingredientsFr",
      "business",
      "origin",
      "size",
      "sku",
      "gtin",
      "lot",
      "widthMm",
      "heightMm",
      "jarShape",
      "flatFaceWidthMm",
      "principalDisplayAreaCm2",
      "grade",
      "colour",
      "storage",
    ].includes(target.id)
  ) {
    config.gs1Confirmed = false;
    config.textReviewed = false;
    $("gs1Confirmed").checked = false;
    $("textReviewed").checked = false;
    for (const r of quebecRequirements)
      config.quebec.items[r.key].status = "pending";
    renderReviews();
  }
  $("messages").textContent = "";
  void preview();
});
$("editor").addEventListener("submit", (e) => e.preventDefault());
$("save").onclick = async () => {
  const btn = $("save");
  btn.disabled = true;
  try {
    formToConfig();
    const p = product();
    if (!p.name.trim() || !p.sku) throw new Error("Nom et SKU requis.");
    const result = await api<{ id: string; version: number }>("labels", {
      id: current?.id,
      version: current?.version,
      title: `${config.brand} — ${p.name} — ${p.size}`,
      payload: { product: p, config, inventory: inventoryLink },
    });
    current = result;
    await load();
    await preview();
    $("messages").textContent = "Étiquette sauvegardée en ligne.";
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  } finally {
    btn.disabled = false;
  }
};
$("saved").onchange = () => {
  const r = records.find((x) => x.id === $("saved").value);
  if (!r) return;
  current = r;
  selectedEl = null;
  config = readLabelConfig(r.payload.config, "MIEL AISSA");
  inventoryLink = r.payload.inventory ?? null;
  configToForm();
  for (const f of ["sku", "size", "gtin"] as const)
    $(f).value = r.payload.product[f] || "";
  showInventoryLink();
  void preview();
};
$("new").onclick = () => {
  current = null;
  selectedEl = null;
  config = mielAissaLabelConfig();
  config.origin = "";
  config.heightMm = 80;
  inventoryLink = null;
  configToForm();
  $("size").value = "";
  $("gtin").value = "";
  $("sku").value = "AISSA";
  $("saved").value = "";
  showInventoryLink();
  $("messages").textContent = "";
  void preview();
};
$("pdf").onclick = async () => {
  try {
    await preview();
    if (!scene) throw new Error("Corrigez la mise en page.");
    const bytes = await labelPdf(
      scene,
      $("paper").value as LabelPaper,
      1,
    );
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `MIEL-AISSA-${scene.draft ? "epreuve" : "etiquette"}-${scene.width}x${scene.height}mm.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    $("messages").textContent = "PDF créé. Imprimez à taille réelle (100 %).";
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
$("scan").oninput = () => {
  $("scan-result").textContent = barcodeMatchesScan(product(), $("scan").value)
    ? "Lecture correspondante au produit."
    : "En attente d’un code correspondant.";
};
/** Lit un fichier image téléversé : PNG/JPEG de 300 Ko maximum, avec ses proportions. */
async function readImageFile(
  file: File,
): Promise<{ data: string; ratio: number }> {
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 300000)
    throw new Error("Image PNG/JPEG de 300 Ko maximum.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = data;
  await image.decode();
  return { data, ratio: image.width / image.height };
}
$("logo-file").onchange = async () => {
  try {
    const file = $("logo-file").files?.[0];
    if (!file) return;
    const { data, ratio } = await readImageFile(file);
    config.logoImage = data;
    config.logoRatio = ratio;
    renderLogo();
    await preview();
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
$("logo-remove").onclick = () => {
  config.logoImage = "";
  config.logoRatio = 1;
  renderLogo();
  void preview();
};
$("honeyPreset").addEventListener("change", () => {
  if ($("honeyPreset").checked) {
    // Preset miel : mention d'ingrédient unique standard + aucune date.
    // Les autres prérequis (GS1, poids, origine, lot, valeur nutritive…)
    // restent exigés exactement comme pour les autres produits.
    $("ingredientsFr").value = HONEY_SINGLE_INGREDIENT_FR;
    $("noBestBefore").checked = true;
  }
  void preview();
});
$("noBestBefore").addEventListener("change", () => {
  void preview();
});
$("nutrition-file").onchange = async () => {
  try {
    const file = $("nutrition-file").files?.[0];
    if (!file) return;
    const { data, ratio } = await readImageFile(file);
    config.nutritionImage = data;
    config.nutritionRatio = ratio;
    await preview();
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
/* ------------------------------------------------------------------ */
/* Studio libre : canevas glisser-déposer (le « Canva » du propriétaire) */
/* ------------------------------------------------------------------ */
const KIND_NAMES: Record<PlacedElement["kind"], string> = {
  logo: "Logo de l’entreprise",
  nutrition: "Affiche nutritive",
  barcode: "Code-barres (numéro GS1)",
  barcodeImage: "Code-barres / QR en image",
  image: "Image",
  text: "Texte",
};
const clampMm = (v: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, v)) * 10) / 10;
function newElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function blankElement(kind: PlacedElement["kind"]): PlacedElement {
  return {
    id: newElementId(),
    kind,
    x: 10,
    y: 10,
    widthMm: 40,
    rotation: 0,
    image: "",
    imageRatio: 1,
    text: "",
    fontSizeMm: 3.5,
    bold: false,
    colour: "",
    align: "left",
  };
}
function selectedElement(): PlacedElement | null {
  return config.elements.find((e) => e.id === selectedEl) ?? null;
}
function renderCanvasTools() {
  const free = config.elements.length > 0;
  $("free-mode").hidden = free;
  $("auto-mode").hidden = !free;
  $("free-tools").hidden = !free;
  $("bg-colour").value = config.background || "#fffcf4";
  if (!free) {
    selectedEl = null;
    renderElProps();
  }
}
/** Premier passage en mode libre : on pose les éléments actuels du modèle aux endroits habituels, l'utilisateur les replace ensuite à sa façon. */
function seedElements() {
  const p = product();
  const W = config.widthMm;
  const accent =
    config.theme === "blue"
      ? "#1565D8"
      : config.theme === "honey"
        ? "#95661B"
        : "#111111";
  const els: PlacedElement[] = [];
  const frontW = Math.min(70, W * 0.36);
  const frontX = Math.max(4, W * 0.4);
  if (config.nutritionImage)
    els.push({
      ...blankElement("nutrition"),
      x: 4,
      y: 8,
      widthMm: config.nutritionWidthMm,
    });
  const infoX = config.nutritionImage ? 8 + config.nutritionWidthMm : 4;
  const infoLines = [
    "Ingrédients / Ingredients",
    config.ingredientsFr || p.ingredients,
    "",
    config.business,
    config.origin,
  ]
    .filter((line, i) => i === 0 || line)
    .join("\n");
  els.push({
    ...blankElement("text"),
    x: infoX,
    y: 8,
    widthMm: Math.max(30, frontX - infoX - 6),
    text: infoLines,
    fontSizeMm: 3.1,
  });
  let fy = 6;
  if (config.logoImage) {
    const logoW = Math.min(config.logoWidthMm, frontW);
    els.push({
      ...blankElement("logo"),
      x: frontX + (frontW - logoW) / 2,
      y: fy,
      widthMm: logoW,
    });
    fy += logoW / config.logoRatio + 3;
  }
  els.push({
    ...blankElement("text"),
    x: frontX,
    y: fy,
    widthMm: frontW,
    text: config.brand || "VOTRE MARQUE",
    fontSizeMm: 4.2,
    bold: true,
    colour: accent,
    align: "center",
  });
  els.push({
    ...blankElement("text"),
    x: frontX,
    y: fy + 8,
    widthMm: frontW,
    text: config.nameFr || p.name,
    fontSizeMm: 5.2,
    bold: true,
    colour: "#111111",
    align: "center",
  });
  els.push({
    ...blankElement("text"),
    x: frontX,
    y: fy + 19,
    widthMm: frontW,
    text: p.size,
    fontSizeMm: 5.3,
    bold: true,
    colour: "#111111",
    align: "center",
  });
  const barcodeX = Math.max(4, W - config.seamMm - 46);
  els.push({
    ...blankElement("barcode"),
    x: barcodeX,
    y: 6,
    widthMm: 37,
  });
  const under: string[] = [];
  if (config.lot) under.push(`Lot: ${config.lot}`);
  if (config.bestBefore && !config.noBestBefore)
    under.push(`Best before / Meilleur avant: ${config.bestBefore}`);
  if (under.length)
    els.push({
      ...blankElement("text"),
      x: barcodeX,
      y: 40,
      widthMm: 42,
      text: under.join("\n"),
      fontSizeMm: 2.7,
    });
  config.elements = els;
}
function addElement(el: PlacedElement) {
  config.elements = [...config.elements, el];
  selectedEl = el.id;
  renderCanvasTools();
  renderElProps();
  void preview();
}
function renderElProps() {
  const host = $("el-props");
  const el = selectedElement();
  if (!el) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }
  host.hidden = false;
  const idx = config.elements.indexOf(el);
  host.innerHTML = `
    <p style="font-weight:600;font-size:13px;margin:10px 0 4px">Élément sélectionné : ${KIND_NAMES[el.kind]}</p>
    <p class="muted" style="margin:0">Glissez-le directement sur l’aperçu, ou précisez ici :</p>
    <div class="row">
      <label>Position horizontale (mm)<input id="el-x" type="number" step="0.5" value="${el.x}"></label>
      <label>Position verticale (mm)<input id="el-y" type="number" step="0.5" value="${el.y}"></label>
    </div>
    <div class="row">
      <label>Largeur (mm)<input id="el-w" type="number" step="1" min="8" value="${el.widthMm}"></label>
      <label>Rotation<button id="el-rotate" type="button" style="margin-top:6px">Tourner (actuel : ${el.rotation}°)</button></label>
    </div>
    ${
      el.kind === "text"
        ? `
    <label>Texte<textarea id="el-text" maxlength="1500">${escape(el.text)}</textarea></label>
    <div class="row">
      <label>Taille du texte (mm)<input id="el-size" type="number" step="0.5" min="2" max="12" value="${el.fontSizeMm}"></label>
      <label>Couleur du texte<input id="el-colour" type="color" value="${el.colour || "#111111"}"></label>
    </div>
    <label class="check"><input id="el-bold" type="checkbox" ${el.bold ? "checked" : ""}>Texte en gras</label>
    <label>Alignement<select id="el-align"><option value="left" ${el.align === "left" ? "selected" : ""}>À gauche</option><option value="center" ${el.align === "center" ? "selected" : ""}>Centré</option><option value="right" ${el.align === "right" ? "selected" : ""}>À droite</option></select></label>`
        : ""
    }
    <div class="actions">
      <button id="el-front" type="button" ${idx === config.elements.length - 1 ? "disabled" : ""}>Mettre devant</button>
      <button id="el-back" type="button" ${idx === 0 ? "disabled" : ""}>Mettre derrière</button>
      <button id="el-delete" type="button">Retirer l’élément</button>
    </div>`;
  const num = (id: string, apply: (v: number) => void) => {
    const input = host.querySelector(`#${id}`) as HTMLInputElement | null;
    input?.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) {
        apply(v);
        renderElProps();
        void preview();
      }
    });
  };
  num("el-x", (v) => (el.x = clampMm(v, 0, 400)));
  num("el-y", (v) => (el.y = clampMm(v, 0, 400)));
  num("el-w", (v) => (el.widthMm = clampMm(v, 8, 400)));
  host.querySelector("#el-rotate")?.addEventListener("click", () => {
    el.rotation =
      el.kind === "barcode"
        ? el.rotation === 90
          ? 0
          : 90
        : (el.rotation + 90) % 360;
    renderElProps();
    void preview();
  });
  host.querySelector("#el-text")?.addEventListener("input", (e) => {
    el.text = (e.target as HTMLTextAreaElement).value;
    void preview();
  });
  num("el-size", (v) => (el.fontSizeMm = clampMm(v, 2, 12)));
  host.querySelector("#el-colour")?.addEventListener("input", (e) => {
    el.colour = (e.target as HTMLInputElement).value;
    void preview();
  });
  host.querySelector("#el-bold")?.addEventListener("change", (e) => {
    el.bold = (e.target as HTMLInputElement).checked;
    void preview();
  });
  host.querySelector("#el-align")?.addEventListener("change", (e) => {
    el.align = (e.target as HTMLSelectElement).value as PlacedElement["align"];
    void preview();
  });
  host.querySelector("#el-front")?.addEventListener("click", () => {
    config.elements = [
      ...config.elements.filter((e) => e.id !== el.id),
      el,
    ];
    renderElProps();
    void preview();
  });
  host.querySelector("#el-back")?.addEventListener("click", () => {
    config.elements = [
      el,
      ...config.elements.filter((e) => e.id !== el.id),
    ];
    renderElProps();
    void preview();
  });
  host.querySelector("#el-delete")?.addEventListener("click", () => {
    config.elements = config.elements.filter((e) => e.id !== el.id);
    selectedEl = null;
    renderCanvasTools();
    renderElProps();
    void preview();
  });
}
$("free-mode").onclick = () => {
  if (!config.elements.length) seedElements();
  selectedEl = null;
  renderCanvasTools();
  renderElProps();
  $("messages").textContent =
    "Mode libre activé : touchez un élément sur l’aperçu et glissez-le où vous voulez. Sauvegardez pour conserver vos positions.";
  void preview();
};
$("auto-mode").onclick = () => {
  config.elements = [];
  selectedEl = null;
  renderCanvasTools();
  renderElProps();
  $("messages").textContent =
    "Disposition automatique de retour. Les éléments libres ont été retirés du modèle (sauvegardez pour confirmer).";
  void preview();
};
$("bg-colour").addEventListener("input", () => {
  config.background = $("bg-colour").value;
  void preview();
});
$("bg-file").onchange = async () => {
  try {
    const file = $("bg-file").files?.[0];
    if (!file) return;
    const { data, ratio } = await readImageFile(file);
    config.backgroundImage = data;
    config.backgroundRatio = ratio;
    await preview();
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
$("bg-clear").onclick = () => {
  config.background = "";
  config.backgroundImage = "";
  config.backgroundRatio = 1;
  renderCanvasTools();
  void preview();
};
$("add-text").onclick = () =>
  addElement({
    ...blankElement("text"),
    text: "Nouveau texte",
    widthMm: 60,
    fontSizeMm: 4,
  });
$("add-logo").onclick = () => {
  if (!config.logoImage) {
    $("messages").textContent =
      "Téléversez d’abord le logo de l’entreprise (section 1), puis posez-le ici.";
    return;
  }
  addElement({
    ...blankElement("logo"),
    x: 20,
    y: 5,
    widthMm: config.logoWidthMm,
  });
};
$("add-nutrition").onclick = () => {
  if (!config.nutritionImage) {
    $("messages").textContent =
      "Téléversez d’abord le tableau de valeur nutritive (section « Mentions alimentaires »), puis posez-le ici.";
    return;
  }
  addElement({
    ...blankElement("nutrition"),
    x: 4,
    y: 8,
    widthMm: config.nutritionWidthMm,
  });
};
$("add-barcode").onclick = () =>
  addElement({
    ...blankElement("barcode"),
    x: Math.max(4, config.widthMm - config.seamMm - 46),
    y: 6,
    widthMm: 37,
  });
$("add-image-file").onchange = async () => {
  try {
    const file = $("add-image-file").files?.[0];
    if (!file) return;
    const { data, ratio } = await readImageFile(file);
    addElement({
      ...blankElement("image"),
      image: data,
      imageRatio: ratio,
      widthMm: 40,
    });
    $("add-image-file").value = "";
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
$("barcode-image-file").onchange = async () => {
  try {
    const file = $("barcode-image-file").files?.[0];
    if (!file) return;
    const { data, ratio } = await readImageFile(file);
    addElement({
      ...blankElement("barcodeImage"),
      image: data,
      imageRatio: ratio,
      widthMm: 37,
    });
    $("barcode-image-file").value = "";
  } catch (e: unknown) {
    $("messages").textContent = errorMessage(e);
  }
};
/* Glisser-déposer sur l'aperçu : pointeur (doigt ou souris), en mm. */
type DragState = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  group: Element | null;
  baseTransform: string;
};
let dragState: DragState | null = null;
function previewPoint(evt: PointerEvent): { x: number; y: number } | null {
  const svg = $("preview").querySelector("svg");
  if (!svg || !lastScene) return null;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: ((evt.clientX - rect.left) / rect.width) * lastScene.width,
    y: ((evt.clientY - rect.top) / rect.height) * lastScene.height,
  };
}
function elementGroup(id: string): Element | null {
  for (const g of $("preview").querySelectorAll("[data-el]"))
    if (g.getAttribute("data-el") === id) return g;
  return null;
}
$("preview").addEventListener("pointerdown", (evt) => {
  const target = evt.target as Element;
  const handle = target.closest?.("[data-handle]");
  const holder = target.closest?.("[data-el]");
  if (!handle && !holder) return;
  const id = handle ? selectedEl : holder?.getAttribute("data-el");
  if (!id) return;
  const el = config.elements.find((e) => e.id === id);
  const pt = previewPoint(evt as PointerEvent);
  if (!el || !pt) return;
  evt.preventDefault();
  if (selectedEl !== id) {
    selectedEl = id;
    renderElProps();
    if (lastScene) paint(lastScene);
  }
  const group = elementGroup(id);
  dragState = {
    id,
    mode: handle ? "resize" : "move",
    startX: pt.x,
    startY: pt.y,
    origX: el.x,
    origY: el.y,
    origW: el.widthMm,
    group,
    baseTransform: group?.getAttribute("transform") ?? "",
  };
});
window.addEventListener("pointermove", (evt) => {
  if (!dragState || dragState.mode !== "move") return;
  const pt = previewPoint(evt);
  if (!pt) return;
  const dx = pt.x - dragState.startX,
    dy = pt.y - dragState.startY;
  dragState.group?.setAttribute(
    "transform",
    `translate(${dx} ${dy}) ${dragState.baseTransform}`.trim(),
  );
});
window.addEventListener("pointerup", (evt) => {
  if (!dragState) return;
  const state = dragState;
  dragState = null;
  const el = config.elements.find((e) => e.id === state.id);
  const pt = previewPoint(evt);
  if (!el || !pt || !lastScene) {
    if (lastScene) paint(lastScene);
    return;
  }
  if (state.mode === "move") {
    el.x = clampMm(state.origX + (pt.x - state.startX), 0, Math.max(0, lastScene.width - 5));
    el.y = clampMm(state.origY + (pt.y - state.startY), 0, Math.max(0, lastScene.height - 5));
  } else {
    el.widthMm = clampMm(state.origW + (pt.x - state.startX), 8, lastScene.width);
  }
  renderElProps();
  void preview();
});
configToForm();
const authMessages: Record<string, string> = {
  invalid:
    "Ce lien de connexion n'est plus valide. Recommencez la connexion avec TAKATAK.",
  refused:
    "TAKATAK n'a pas confirmé cette connexion. Recommencez la connexion avec TAKATAK.",
  not_configured:
    "La connexion TAKATAK n'est pas encore configurée sur cet atelier.",
};
const authResult = new URLSearchParams(location.search).get("auth");
if (authResult && authMessages[authResult]) {
  $("login-error").textContent = authMessages[authResult];
  history.replaceState(null, "", location.pathname);
}
void api<{ takatak?: string }>("release")
  .then((r) => {
    if (r.takatak === "ready") $("takatak-login").hidden = false;
  })
  .catch(() => undefined);
void api<{ signedIn: boolean }>("session")
  .then((s) => (s.signedIn ? show() : null))
  .catch((e) => {
    $("login-error").textContent = errorMessage(e);
  });
