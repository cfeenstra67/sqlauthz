import { Oso } from "oso";

export interface CreateOsoArgs {
  paths: string[];
  vars?: Record<string, string>;
}

export async function createOso({ paths, vars }: CreateOsoArgs): Promise<Oso> {
  const oso = new Oso();

  for (const [key, value] of Object.entries(vars ?? {})) {
    oso.registerConstant(value, key);
  }

  await oso.loadFiles(paths);

  return oso;
}
