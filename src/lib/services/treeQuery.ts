export type QueryMode = 'jmespath' | 'jsonpath';

export type QueryTreeNode = {
  path: string;
  value: unknown;
  children?: QueryTreeNode[];
};

export type TreeQueryState = {
  matches: Set<string>;
  expanded: Set<string>;
  error: string;
  matchedRoot: boolean;
};

type TreeQueryArgs = {
  mode: QueryMode;
  query: string;
  data: unknown;
  nodes: QueryTreeNode[];
};

export async function runTreeQuery({
  mode,
  query,
  data,
  nodes,
}: TreeQueryArgs): Promise<TreeQueryState> {
  if (!query || data == null || nodes.length === 0) {
    return emptyTreeQueryState();
  }

  try {
    if (mode === 'jsonpath') {
      return await runJsonPathQuery(query, data);
    }

    return await runJmesPathQuery(query, data, nodes);
  } catch (error) {
    return {
      ...emptyTreeQueryState(),
      error: error instanceof Error ? error.message : 'Query error',
    };
  }
}

function emptyTreeQueryState(): TreeQueryState {
  return {
    matches: new Set<string>(),
    expanded: new Set<string>(),
    error: '',
    matchedRoot: false,
  };
}

async function runJmesPathQuery(
  query: string,
  data: unknown,
  nodes: QueryTreeNode[]
): Promise<TreeQueryState> {
  const jmespath = await import('jmespath');
  const search = jmespath.search ?? jmespath.default?.search ?? jmespath.default;
  if (typeof search !== 'function') {
    throw new Error('JMESPath search not available');
  }

  const result = search(data, query);
  const resultItems = Array.isArray(result) ? result : [result];
  const needsDeepEqual = resultItems.some((item) => item && typeof item === 'object');
  let deepEqual: ((a: unknown, b: unknown) => boolean) | null = null;

  if (needsDeepEqual) {
    const deepEqualModule = await import('fast-deep-equal');
    deepEqual = deepEqualModule.default ?? deepEqualModule;
  }

  const allNodes: QueryTreeNode[] = [];
  collectNodes(nodes, allNodes);

  const matches = new Set<string>();
  const expanded = new Set<string>();

  allNodes.forEach((node) => {
    for (const item of resultItems) {
      if (item && typeof item === 'object') {
        if (deepEqual && deepEqual(node.value, item)) {
          matches.add(node.path);
          addAncestorPaths(node.path, expanded);
          break;
        }
      } else if (Object.is(node.value, item)) {
        matches.add(node.path);
        addAncestorPaths(node.path, expanded);
        break;
      }
    }
  });

  return {
    matches,
    expanded,
    error: '',
    matchedRoot: false,
  };
}

async function runJsonPathQuery(query: string, data: unknown): Promise<TreeQueryState> {
  const { JSONPath } = await import('jsonpath-plus');
  const result = JSONPath({
    path: query,
    json: data as null | boolean | number | string | object | any[],
    resultType: 'pointer',
    wrap: true,
  });

  const pointers = Array.isArray(result)
    ? result
    : typeof result === 'string'
      ? [result]
      : [];

  const matches = new Set<string>();
  const expanded = new Set<string>();
  let matchedRoot = false;

  pointers.forEach((pointer) => {
    const normalizedPointer = normalizePointer(pointer);
    if (normalizedPointer === '/') {
      matchedRoot = true;
      return;
    }

    if (!normalizedPointer) {
      return;
    }

    matches.add(normalizedPointer);
    addAncestorPaths(normalizedPointer, expanded);
  });

  return {
    matches,
    expanded,
    error: '',
    matchedRoot,
  };
}

function collectNodes(nodes: QueryTreeNode[], list: QueryTreeNode[]) {
  nodes.forEach((node) => {
    list.push(node);
    if (node.children) {
      collectNodes(node.children, list);
    }
  });
}

function normalizePointer(pointer: string): string {
  if (!pointer) return '/';
  return pointer.startsWith('#') ? pointer.slice(1) : pointer;
}

function addAncestorPaths(path: string, expanded: Set<string>) {
  if (!path || path === '/') return;

  const segments = path.split('/').slice(1);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    expanded.add(current);
  }
}
