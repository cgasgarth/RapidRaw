import { type Node, type Program, parseSync, visitorKeys } from 'oxc-parser';

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'type') === 'string';

export const parseSource = (filePath: string, contents: string): Program => {
  const result = parseSync(filePath, contents, { preserveParens: true });
  if (result.errors.length > 0) {
    throw new Error(`${filePath}: ${result.errors.map(({ message }) => message).join('; ')}`);
  }
  return result.program;
};

export const visitSource = (node: Node, visit: (node: Node) => void): void => {
  visit(node);
  for (const key of visitorKeys[node.type] ?? []) {
    const value: unknown = Reflect.get(node, key);
    if (isNode(value)) {
      visitSource(value, visit);
      continue;
    }
    if (!Array.isArray(value)) continue;
    for (const child of value) {
      if (isNode(child)) visitSource(child, visit);
    }
  }
};

export const lineAtOffset = (contents: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (contents.charCodeAt(index) === 10) line += 1;
  }
  return line;
};
