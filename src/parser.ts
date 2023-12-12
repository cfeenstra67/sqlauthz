import { Oso, Variable } from "oso";
import { SQLEntities } from "./backend.js";
import {
	AndClause,
	Clause,
	Column,
	EvaluateClauseArgs,
	OrClause,
	ValidationError,
	Value,
	evaluateClause,
	factorOrClauses,
	mapClauses,
	optimizeClause,
	simpleEvaluator,
	valueToClause,
} from "./clause.js";
import {
	Permission,
	SQLSchema,
	SQLTableMetadata,
	SQLUser,
	SchemaPrivilege,
	SchemaPrivileges,
	TablePermission,
	TablePrivilege,
	TablePrivileges,
	formatTableName,
} from "./sql.js";
import { arrayProduct, printQuery } from "./utils.js";

export interface ConvertPermissionSuccess {
	type: "success";
	permissions: Permission[];
}

export interface ConvertPermissionError {
	type: "error";
	errors: string[];
}

export type ConvertPermissionResult =
	| ConvertPermissionSuccess
	| ConvertPermissionError;

function userEvaluator(user: SQLUser): EvaluateClauseArgs["evaluate"] {
	return simpleEvaluator({
		variableName: "actor",
		getValue: (value) => {
			if (value.type === "value") {
				return value.value;
			}
			if (value.value === "_this" || value.value === "_this.name") {
				return user.name;
			}
			throw new ValidationError(`actor: invalid user field: ${value.value}`);
		},
	});
}

type TableEvaluatorMatch = {
	type: "match";
	columnClause: Clause;
	rowClause: Clause;
};

type TableEvaluatorNoMatch = {
	type: "no-match";
};

type TableEvaluatorError = {
	type: "error";
	errors: string[];
};

type TableEvaluatorResult =
	| TableEvaluatorMatch
	| TableEvaluatorNoMatch
	| TableEvaluatorError;

function tableEvaluator(
	table: SQLTableMetadata,
	clause: Clause,
): TableEvaluatorResult {
	const tableName = formatTableName(table);

	const metaEvaluator = simpleEvaluator({
		variableName: "resource",
		getValue: (value) => {
			if (value.type === "value") {
				return value.value;
			}
			if (value.value === "_this") {
				return tableName;
			}
			if (value.value === "_this.name") {
				return table.name;
			}
			if (value.value === "_this.schema") {
				return table.schema;
			}
			if (value.value === "_this.type") {
				return table.type;
			}
			throw new ValidationError(
				`resource: invalid table field: ${value.value}`,
			);
		},
	});

	const andParts = clause.type === "and" ? clause.clauses : [clause];

	const getColumnSpecifier = (column: Column) => {
		let rest: string;
		if (column.value.startsWith("_this.")) {
			rest = column.value.slice("_this.".length);
		} else if (column.value.startsWith(`${tableName}.`)) {
			rest = column.value.slice(`${tableName}.`.length);
		} else {
			return null;
		}
		const restParts = rest.split(".");
		if (restParts[0] === "col" && restParts.length === 1) {
			return { type: "col" } as const;
		}
		if (restParts[0] === "row" && restParts.length === 2) {
			return { type: "row", row: restParts[1]! } as const;
		}
		return null;
	};

	const isColumnClause = (clause: Clause) => {
		if (clause.type === "not") {
			return isColumnClause(clause.clause);
		}
		if (clause.type === "expression") {
			let colCount = 0;
			for (const value of clause.values) {
				if (value.type === "value") {
					continue;
				}
				const spec = getColumnSpecifier(value);
				if (spec && spec.type === "col") {
					colCount++;
					continue;
				}
				return false;
			}
			return colCount > 0;
		}
		return false;
	};

	const isRowClause = (clause: Clause) => {
		if (clause.type === "not") {
			return isRowClause(clause.clause);
		}
		if (clause.type === "expression") {
			let colCount = 0;
			for (const value of clause.values) {
				if (value.type === "value") {
					continue;
				}
				const spec = getColumnSpecifier(value);
				if (spec && spec.type === "row") {
					colCount++;
					continue;
				}
				return false;
			}
			return colCount > 0;
		}
		if (clause.type === "column") {
			const spec = getColumnSpecifier(clause);
			return spec && spec.type === "row";
		}
		return false;
	};

	const metaClauses: Clause[] = [];
	const colClauses: Clause[] = [];
	const rowClauses: Clause[] = [];
	for (const clause of andParts) {
		if (isColumnClause(clause)) {
			colClauses.push(clause);
		} else if (isRowClause(clause)) {
			rowClauses.push(clause);
		} else {
			metaClauses.push(clause);
		}
	}

	const rawColClause: Clause =
		colClauses.length === 1
			? colClauses[0]!
			: { type: "and", clauses: colClauses };

	const errors: string[] = [];

	const columnClause = mapClauses(rawColClause, (clause) => {
		if (clause.type === "column") {
			return { type: "column", value: "col" };
		}
		if (clause.type === "value") {
			if (typeof clause.value !== "string") {
				errors.push(`resource: invalid column specifier: ${clause.value}`);
			} else if (!table.columns.includes(clause.value)) {
				errors.push(
					`resource: invalid column for ${tableName}: ${clause.value}`,
				);
			}
		}
		return clause;
	});

	const rawRowClause: Clause =
		rowClauses.length === 1
			? rowClauses[0]!
			: { type: "and", clauses: rowClauses };

	const rowClause = mapClauses(rawRowClause, (clause) => {
		if (clause.type === "column") {
			let key: string;
			if (clause.value.startsWith(`${tableName}.`)) {
				key = clause.value.slice(`${tableName}.row.`.length);
			} else {
				key = clause.value.slice("_this.row.".length);
			}
			if (!table.columns.includes(key)) {
				errors.push(`resource: invalid column for ${tableName}: ${key}`);
			}
			return { type: "column", value: key };
		}
		return clause;
	});

	const evalResult = evaluateClause({
		clause: { type: "and", clauses: metaClauses },
		evaluate: metaEvaluator,
	});
	if (evalResult.type === "error") {
		return evalResult;
	}
	if (!evalResult.result) {
		return { type: "no-match" };
	}
	if (errors.length > 0) {
		return { type: "error", errors };
	}
	return {
		type: "match",
		columnClause,
		rowClause,
	};
}

function schemaEvaluator(schema: SQLSchema): EvaluateClauseArgs["evaluate"] {
	return simpleEvaluator({
		variableName: "resource",
		getValue: (value) => {
			if (value.type === "value") {
				return value.value;
			}
			if (value.value === "_this" || value.value === "_this.name") {
				return schema.name;
			}
			if (value.value === "_this.type") {
				return schema.type;
			}
			throw new ValidationError(
				`resource: invalid schema field: ${value.value}`,
			);
		},
	});
}

function permissionEvaluator(
	permission: string,
): EvaluateClauseArgs["evaluate"] {
	return simpleEvaluator({
		variableName: "action",
		getValue: (value) => {
			if (value.type === "value" && typeof value.value === "string") {
				return value.value.toUpperCase();
			}
			if (value.type === "value") {
				return value.value;
			}
			if (value.value === "_this" || value.value === "_this.name") {
				return permission.toUpperCase();
			}
			throw new ValidationError(
				`action: invalid permission field: ${value.value}`,
			);
		},
	});
}

export function convertPermission(
	result: Map<string, unknown>,
	entities: SQLEntities,
): ConvertPermissionResult {
	const resource = result.get("resource");
	const action = result.get("action");
	const actor = result.get("actor");

	const actorClause = valueToClause(actor);
	const actionClause = valueToClause(action);
	const resourceClause = valueToClause(resource);

	const actorOrs = factorOrClauses(actorClause);
	const actionOrs = factorOrClauses(actionClause);
	const resourceOrs = factorOrClauses(resourceClause);

	const errors: string[] = [];
	const permissions: Permission[] = [];

	for (const [actorOr, actionOr, resourceOr] of arrayProduct([
		actorOrs,
		actionOrs,
		resourceOrs,
	])) {
		const users: SQLUser[] = [];
		for (const user of entities.users) {
			const result = evaluateClause({
				clause: actorOr,
				evaluate: userEvaluator(user),
			});
			if (result.type === "error") {
				errors.push(...result.errors);
			} else if (result.result) {
				users.push(user);
			}
		}

		if (users.length === 0) {
			continue;
		}

		const schemaPrivileges: SchemaPrivilege[] = [];
		for (const privilege of SchemaPrivileges) {
			const result = evaluateClause({
				clause: actionOr,
				evaluate: permissionEvaluator(privilege),
			});
			if (result.type === "error") {
				errors.push(...result.errors);
			} else if (result.result) {
				schemaPrivileges.push(privilege);
			}
		}

		if (schemaPrivileges.length > 0) {
			const schemas: SQLSchema[] = [];
			for (const schema of entities.schemas) {
				const result = evaluateClause({
					clause: resourceOr,
					evaluate: schemaEvaluator(schema),
				});
				if (result.type === "error") {
					errors.push(...result.errors);
				} else if (result.result) {
					schemas.push(schema);
				}
			}

			for (const [user, privilege, schema] of arrayProduct([
				users,
				schemaPrivileges,
				schemas,
			])) {
				permissions.push({
					type: "schema",
					schema,
					privilege,
					user,
				});
			}
		}

		const tablePrivileges: TablePrivilege[] = [];
		for (const privilege of TablePrivileges) {
			const result = evaluateClause({
				clause: actionOr,
				evaluate: permissionEvaluator(privilege),
			});
			if (result.type === "error") {
				errors.push(...result.errors);
			} else if (result.result) {
				tablePrivileges.push(privilege);
			}
		}

		if (tablePrivileges.length > 0) {
			for (const table of entities.tables) {
				const result = tableEvaluator(table, resourceOr);
				if (result.type === "error") {
					errors.push(...result.errors);
				} else if (result.type === "match") {
					for (const [user, privilege] of arrayProduct([
						users,
						tablePrivileges,
					])) {
						permissions.push({
							type: "table",
							table: { type: "table", schema: table.schema, name: table.name },
							user,
							privilege,
							columnClause: result.columnClause,
							rowClause: result.rowClause,
						});
					}
				}
			}
		}
	}

	if (errors.length > 0) {
		return {
			type: "error",
			errors,
		};
	}

	return {
		type: "success",
		permissions,
	};
}

export interface ParsePermissionsArgs {
	oso: Oso;
	entities: SQLEntities;
	debug?: boolean;
}

export async function parsePermissions({
	oso,
	entities,
	debug,
}: ParsePermissionsArgs): Promise<ConvertPermissionResult> {
	const result = oso.queryRule(
		{
			acceptExpression: true,
		},
		"allow",
		new Variable("actor"),
		new Variable("action"),
		new Variable("resource"),
	);

	const permissions: Permission[] = [];
	const errors: string[] = [];

	for await (const item of result) {
		if (debug) {
			console.log("\nQUERY\n", printQuery(item));
		}

		const result = convertPermission(item, entities);
		if (result.type === "success") {
			permissions.push(...result.permissions);
		} else {
			errors.push(...result.errors);
		}
	}

	if (errors.length > 0) {
		return {
			type: "error",
			errors: Array.from(new Set(errors)),
		};
	}

	return {
		type: "success",
		permissions,
	};
}

export function deduplicatePermissions(
	permissions: Permission[],
): Permission[] {
	const permissionsByKey: Record<string, Permission[]> = {};
	for (const permission of permissions) {
		let key: string;
		if (permission.type === "schema") {
			key = [
				permission.type,
				permission.privilege,
				permission.user.name,
				permission.schema.name,
			].join(",");
		} else {
			key = [
				permission.type,
				permission.privilege,
				permission.user.name,
				formatTableName(permission.table),
			].join(",");
		}
		permissionsByKey[key] ??= [];
		permissionsByKey[key]!.push(permission);
	}

	const outPermissions: Permission[] = [];
	for (const groupedPermissions of Object.values(permissionsByKey)) {
		const first = groupedPermissions[0]!;
		const rest = groupedPermissions.slice(1);
		if (first.type === "schema") {
			outPermissions.push(first);
		} else {
			const typedRest = rest as TablePermission[];
			const rowClause = optimizeClause({
				type: "or",
				clauses: [first.rowClause, ...typedRest.map((perm) => perm.rowClause)],
			});
			const columnClause = optimizeClause({
				type: "or",
				clauses: [
					first.columnClause,
					...typedRest.map((perm) => perm.columnClause),
				],
			});
			outPermissions.push({
				type: "table",
				user: first.user,
				table: first.table,
				privilege: first.privilege,
				rowClause,
				columnClause,
			});
		}
	}

	return outPermissions;
}
