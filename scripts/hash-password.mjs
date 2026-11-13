// Prépare les trois valeurs du compte SC4NNER à coller dans Coolify.
// Usage : node scripts/hash-password.mjs <utilisateur>
// Le mot de passe est demandé au clavier, sans affichage. Rien n'est écrit sur disque.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline";

const username = process.argv[2];
if (!username) {
  console.error("Usage : node scripts/hash-password.mjs <utilisateur>");
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) =>
  new Promise((resolve) => {
    rl.question(question, (answer) => {
      process.stdout.write("\n");
      resolve(answer);
    });
    // Masque la saisie : seule la question reste visible.
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(question);
    };
  });

const password = await ask("Mot de passe (12 caractères ou plus) : ");
const again = await ask("Encore une fois : ");
rl.close();
if (password !== again) {
  console.error("Les deux saisies sont différentes. Rien n'a été produit.");
  process.exit(1);
}
if (password.length < 12 || password.length > 200) {
  console.error("Le mot de passe doit avoir de 12 à 200 caractères.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
console.log("\nÀ coller dans Coolify → Environment Variables (Runtime) :\n");
console.log(`SC4NNER_USERNAME=${username}`);
console.log(`SC4NNER_SALT=${salt}`);
console.log(`SC4NNER_PASSWORD_HASH=${hash}`);
