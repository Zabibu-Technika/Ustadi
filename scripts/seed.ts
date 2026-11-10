import { resolve } from "node:path";
import { FileStore } from "../core/store.ts";
import { seedDemo } from "../core/seed.ts";

const dataDir = resolve(process.argv[2] ?? process.env.USTADI_DATA ?? "data");
const store = new FileStore(dataDir);
const seeded = seedDemo(store);

console.log(`Data: ${dataDir}`);
console.log(`Events: ${store.events.length}`);
console.log(seeded ? "Demo ledger seeded." : "Existing ledger found; nothing seeded.");
console.log(`Pair code: ${store.meta.pairingCode}`);
