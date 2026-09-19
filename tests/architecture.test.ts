import { it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
it("keeps the domain and application independent of vendors and transport", async () => {
  for (const layer of ["domain", "application"]) {
    const dir = `packages/${layer}/src`;
    for (const file of await readdir(dir)) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(join(dir, file), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      for (const path of imports)
        expect(path).not.toMatch(
          /adapters|runtime|conversation|fastify|openai|elevenlabs|pg|^ws$/,
        );
    }
  }
});
