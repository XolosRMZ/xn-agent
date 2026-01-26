import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

process.env.USE_OLLAMA_EMBEDDING = "false";
process.env.OLLAMA_MODEL = "disabled";
process.env.LLAMALOCAL_PATH = "disabled";

console.log(
  "[startup]",
  "OPENAI_API_KEY_PRESENT:",
  Boolean(process.env.OPENAI_API_KEY),
  "USE_OLLAMA_EMBEDDING:",
  process.env.USE_OLLAMA_EMBEDDING,
  "OLLAMA_MODEL:",
  process.env.OLLAMA_MODEL,
  "LLAMALOCAL_PATH:",
  process.env.LLAMALOCAL_PATH
);

import("./index.ts").catch((error) => {
  console.error("BOOTSTRAP_FATAL", error);
  process.exit(1);
});
