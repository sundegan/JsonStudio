import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface SchemaError {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidateResult {
  valid: boolean;
  errors: SchemaError[];
}

function inferType(value: unknown): Record<string, unknown> {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) return inferArray(value);
  switch (typeof value) {
    case 'string': return inferString(value);
    case 'number': return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'object': return inferObject(value as Record<string, unknown>);
    default: return {};
  }
}

function inferString(value: string): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: 'string' };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    schema.format = 'date-time';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    schema.format = 'date';
  } else if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) {
    schema.format = 'email';
  } else if (/^https?:\/\//.test(value)) {
    schema.format = 'uri';
  } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    schema.format = 'uuid';
  } else if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
    schema.format = 'ipv4';
  }
  return schema;
}

function inferObject(obj: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(obj)) {
    properties[key] = inferType(val);
    if (val !== null && val !== undefined) {
      required.push(key);
    }
  }

  const schema: Record<string, unknown> = {
    type: 'object',
    properties,
  };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function inferArray(arr: unknown[]): Record<string, unknown> {
  if (arr.length === 0) {
    return { type: 'array', items: {} };
  }

  const itemSchemas = arr.map(inferType);
  const merged = mergeSchemas(itemSchemas);

  return { type: 'array', items: merged };
}

function mergeSchemas(schemas: Record<string, unknown>[]): Record<string, unknown> {
  if (schemas.length === 0) return {};
  if (schemas.length === 1) return schemas[0];

  const types = new Set(schemas.map(s => s.type as string));

  if (types.size > 1) {
    return {};
  }

  const type = schemas[0].type as string;

  if (type === 'object') {
    return mergeObjectSchemas(schemas);
  }

  if (type === 'string') {
    const formats = new Set(schemas.map(s => s.format).filter(Boolean));
    if (formats.size === 1) {
      return { type: 'string', format: [...formats][0] };
    }
    return { type: 'string' };
  }

  return schemas[0];
}

function mergeObjectSchemas(schemas: Record<string, unknown>[]): Record<string, unknown> {
  const allProperties: Record<string, Record<string, unknown>[]> = {};
  const allKeys = new Set<string>();
  const requiredCounts: Record<string, number> = {};

  for (const schema of schemas) {
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const req = new Set((schema.required || []) as string[]);

    for (const key of Object.keys(props)) {
      allKeys.add(key);
      if (!allProperties[key]) allProperties[key] = [];
      allProperties[key].push(props[key]);
      if (req.has(key)) {
        requiredCounts[key] = (requiredCounts[key] || 0) + 1;
      }
    }
  }

  const mergedProps: Record<string, unknown> = {};
  for (const key of allKeys) {
    mergedProps[key] = mergeSchemas(allProperties[key] || []);
  }

  const required = Object.entries(requiredCounts)
    .filter(([, count]) => count === schemas.length)
    .map(([key]) => key);

  const result: Record<string, unknown> = {
    type: 'object',
    properties: mergedProps,
  };
  if (required.length > 0) {
    result.required = required.sort();
  }
  return result;
}

export function generateSchema(jsonContent: string): string {
  const data = JSON.parse(jsonContent);
  const schema: Record<string, unknown> = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...inferType(data),
  };
  return JSON.stringify(schema, null, 2);
}

export function validateWithSchema(jsonContent: string, schemaContent: string): ValidateResult {
  const data = JSON.parse(jsonContent);
  const schema = JSON.parse(schemaContent);

  delete schema.$schema;

  const instance = new Ajv({ allErrors: true, verbose: true });
  addFormats(instance);

  const validate = instance.compile(schema);
  const valid = validate(data) as boolean;

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: SchemaError[] = (validate.errors || []).map(err => ({
    path: err.instancePath || '/',
    message: err.message || 'Validation error',
    keyword: err.keyword,
  }));

  return { valid, errors };
}
