// import { Clause, TrueClause, Value } from "./clause.js";
// import { Permission, Privileges, parseTableName } from "./sql.js";

// export interface HandleActorClauseSuccess {
//   type: 'success';
//   name: string;
// }

// export interface HandleActorClauseError {
//   type: 'error';
//   errors: string[];
// }

// export type HandleActorClauseResult =
//   | HandleActorClauseSuccess
//   | HandleActorClauseError;

// export function handleActorClause(clause: Clause): HandleActorClauseResult {
//   if (clause.type === 'value') {
//     if (typeof clause.value === 'string') {
//       return { type: 'success', name: clause.value };
//     }
//     return {
//       type: 'error',
//       errors: ['User name must be a string']
//     };
//   }
//   if (clause.type === 'expression' && clause.operator === 'Eq') {
//     const name = clause.values[0];
//     const value = clause.values[1];
//     if (name.type !== 'column' || value.type !== 'value') {
//       return {
//         type: 'error',
//         errors: ['Invalid user filter']
//       };
//     }
//     if (name.value !== '_this' && name.value !== '_this.name') {
//       return {
//         type: 'error',
//         errors: [`Invalid user field name: ${name.value}`]
//       };
//     }
//     if (typeof value.value !== 'string') {
//       return {
//         type: 'error',
//         errors: ['User name must be a string']
//       };
//     }
//     return { type: 'success', name: value.value };
//   }
//   return {
//     type: 'error',
//     errors: ['Invalid user specification']
//   };
// }

// export interface HandleActionClauseSuccess {
//   type: 'success';
//   action: Privileges;
// }

// export interface HandleActionClauseError {
//   type: 'error';
//   errors: string[];
// }

// export type HandleActionClauseResult =
//   | HandleActionClauseSuccess
//   | HandleActionClauseError;

// export function handleActionClause(clause: Clause): HandleActionClauseResult {
//   const handleValue = (input: unknown): HandleActionClauseResult => {
//     if (typeof input === 'string') {
//       const action = input.toUpperCase().trim() as Privileges;
//       if (!Privileges.includes(action)) {
//         return {
//           type: 'error',
//           errors: [
//             `Invalid action: ${action}, must be ` +
//             `one of: ${Privileges.join(', ')}`
//           ]
//         }
//       }

//       return { type: 'success', action };
//     }
//     return {
//       type: 'error',
//       errors: ['Action must be a string']
//     };
//   }
  
//   if (clause.type === 'value') {
//     if (typeof clause.value === 'string') {
//       return handleValue(clause.value)
//     }
//     return {
//       type: 'error',
//       errors: ['Action must be a string']
//     };
//   }
//   if (clause.type === 'expression' && clause.operator === 'Eq') {
//     const name = clause.values[0];
//     const value = clause.values[1];
//     if (name.type !== 'column' || value.type !== 'value') {
//       return {
//         type: 'error',
//         errors: ['Invalid action filter']
//       };
//     }
//     if (name.value !== '_this' && name.value !== '_this.name') {
//       return {
//         type: 'error',
//         errors: [`Invalid action field name: ${name.value}`]
//       };
//     }
//     return handleValue(value.value);
//   }
//   return {
//     type: 'error',
//     errors: ['Invalid action specification']
//   };
// }

// export interface HandleResourceClauseSuccess {
//   type: 'success';
//   permission: Permission;
// }

// export interface HandleResourceClauseError {
//   type: 'error';
//   errors: string[];
// }

// export type HandleResourceClauseResult =
//   | HandleResourceClauseSuccess
//   | HandleResourceClauseError;

// export function handleResourceClause(
//   clause: Clause,
//   action: Privileges,
//   actor: string,
// ): HandleResourceClauseResult {
//   const handleValue = (value: unknown): HandleResourceClauseResult => {
//     if (typeof value === 'string') {
//       if (action === 'SELECT') {
//         const table = parseTableName(value);
//         if (table === null) {
//           return {
//             type: 'error',
//             errors: [`Invalid table name: ${value}`]
//           };
//         }

//         return {
//           type: 'success',
//           permission: {
//             type: 'select',
//             table,
//             clause: TrueClause,
//             user: actor
//           }
//         }
//       }

//       return {
//         type: 'success',
//         permission: {
//           type: 'generic',
//           permission: action,
//           object: value,
//           user: actor
//         }
//       };
//     }

//     return {
//       type: 'error',
//       errors: ['Resource name must be a string']
//     };
//   };

//   if (clause.type === 'value') {
//     return handleValue(clause.value);
//   }

//   type TableInfo = { name?: string; schema?: string; }

//   const getTableInfo = () => {

//   };

//   if (clause.type === 'expression' && clause.operator === 'Eq') {
//     const name = clause.values[0];
//     const value = clause.values[1];
//     if (name.type !== 'column' || value.type !== 'value') {
//       return {
//         type: 'error',
//         errors: ['Invalid resource filter']
//       };
//     }
//     const nameParts = name.value.split('.');
//     if (nameParts[0] !== '_this') {
//       return {
//         type: 'error',
//         errors: [`Invalid reference: ${name.value}`]
//       }
//     }

//     if (nameParts.length === 1) {
//       return handleValue(value.value);
//     } else if (nameParts.length > 2) {
//       return {
//         type: 'error',
//         errors: [`Invalid resource value: ${value.value}`]
//       };
//     }

//     let nameValue: string | null = null;
//     let schemaValue: string | null = null;

//     const field = nameParts[1];

//     if (nameParts.length === 0) {
//       const table = parseTableName(nameParts[0]);

//     }
//     // } else if (nameParts.length === 1) {
//     //   const field = nameParts[1];
//     //   if (field === undefined) {
//     //     const table = parseTableName(nameParts[0]);
//     //     if (table === null) {
//     //       return {
//     //         type: 'error',
//     //         errors: [`Invalid table name: ${}`];
//     //       }
//     //     }
//     //   } else if (field === 'name') {
//     //     nameValue = field;
//     //   }
//     // }

//     if (name.value !== '_this' && name.value !== '_this.name') {
//       return {
//         type: 'error',
//         errors: [`Invalid resource field name: ${name.value}`]
//       };
//     }
//     return handleValue(value.value);
//   }

//   if (clause.type === 'and') {

//   }

//   return {
//     type: 'error',
//     errors: ['Invalid resource specification']
//   };
// }
