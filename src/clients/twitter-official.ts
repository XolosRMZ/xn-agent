import { TwitterApi } from "twitter-api-v2";
import { elizaLogger } from "@elizaos/core";

export class TwitterOfficialClient {
  public client: TwitterApi;

  constructor() {
    const appKey = process.env.TWITTER_API_KEY;
    const appSecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;

    if (!appKey || !appSecret || !accessToken || !accessSecret) {
      throw new Error(
        "Faltan credenciales Twitter API (TWITTER_API_KEY/SECRET + TWITTER_ACCESS_TOKEN/SECRET) en .env"
      );
    }

    // OAuth 1.0a user context: permite leer y publicar como el usuario (si tu App tiene permiso)
    this.client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });
  }

  async start() {
    elizaLogger.log("Conectando a X vía API oficial (OAuth 1.0a)...");
    // ping simple: obtener el usuario autenticado
    const me = await this.client.v2.me();
    elizaLogger.success(`Conectado como @${me.data.username}`);
    return this;
  }

  // Para trivias: buscar tweets (si tu tier lo permite)
  async searchRecent(query: string, maxResults = 10) {
    return this.client.v2.search(query, {
      max_results: Math.min(Math.max(maxResults, 10), 100),
      // añade fields si los necesitas
      "tweet.fields": ["author_id", "created_at", "conversation_id"],
    });
  }

  // Para publicar (si tienes Read+Write)
  async tweet(text: string) {
    return this.client.v2.tweet(text);
  }
}

// Interfaz compatible con tu patrón start(runtime)
export const TwitterOfficialInterface = {
  start: async (_runtime: any) => {
    const c = new TwitterOfficialClient();
    await c.start();
    return c;
  },
};
