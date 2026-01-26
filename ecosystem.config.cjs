const path = require("path");
const dotenv = require("dotenv");

const envPath = path.resolve(process.cwd(), ".env");
const dotenvResult = dotenv.config({ path: envPath });
const parsedEnv = dotenvResult.parsed || {};

const env = {
  ...process.env,
  ...parsedEnv,
  USE_OLLAMA_EMBEDDING: "false",
  OLLAMA_MODEL: "disabled",
  LLAMALOCAL_PATH: "disabled",
};

module.exports = {
  apps: [
    {
      name: "xologuardian",
      script: "pnpm",
      args: "start -- --character characters/xolo_guardian.character.json",
      interpreter: "none",
      env,
    },
  ],
};
