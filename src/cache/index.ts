
import { CacheManager, DbCacheAdapter } from "@elizaos/core";
import type { Character, IDatabaseCacheAdapter } from "@elizaos/core";

export function initializeDbCache(
  character: Character,
  db: IDatabaseCacheAdapter
) {
  const cache = new CacheManager(new DbCacheAdapter(db, character.id));
  return cache;
}
