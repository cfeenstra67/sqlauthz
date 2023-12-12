import { Oso } from "oso";

export interface CreateOsoArgs {
	paths: string[];
}

export async function createOso({ paths }: CreateOsoArgs): Promise<Oso> {
	const oso = new Oso();

	await oso.loadFiles(paths);

	return oso;
}
