import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertKey,
  convertJsonKeys,
  convertJsonString,
  getOppositeKeyNaming,
  getOppositeKeyNamingFromString,
  tryConvertJsonString,
  tryConvertJsonStringPreservingFormat,
} from '../src/lib/services/jsonKeyNaming.ts';

// ================================================================
// convertKey — single key conversion
// ================================================================

// --- camelCase / PascalCase -> snake_case ---

test('camelCase to snake_case: basic', () => {
  assert.equal(convertKey('emailTitle', 'snake'), 'email_title');
  assert.equal(convertKey('brokerId', 'snake'), 'broker_id');
  assert.equal(convertKey('isActive', 'snake'), 'is_active');
  assert.equal(convertKey('createdAt', 'snake'), 'created_at');
});

test('camelCase to snake_case: single word', () => {
  assert.equal(convertKey('name', 'snake'), 'name');
  assert.equal(convertKey('age', 'snake'), 'age');
  assert.equal(convertKey('a', 'snake'), 'a');
});

test('camelCase to snake_case: PascalCase', () => {
  assert.equal(convertKey('EmailTitle', 'snake'), 'email_title');
  assert.equal(convertKey('UserModel', 'snake'), 'user_model');
  assert.equal(convertKey('MyModel', 'snake'), 'my_model');
});

test('camelCase to snake_case: consecutive capitals', () => {
  assert.equal(convertKey('HTTPResponse', 'snake'), 'http_response');
  assert.equal(convertKey('parseURL', 'snake'), 'parse_url');
  assert.equal(convertKey('getHTTPHeaders', 'snake'), 'get_http_headers');
  assert.equal(convertKey('simpleURL', 'snake'), 'simple_url');
  assert.equal(convertKey('userID', 'snake'), 'user_id');
});

test('camelCase to snake_case: digit boundary', () => {
  assert.equal(convertKey('field1Name', 'snake'), 'field1_name');
  assert.equal(convertKey('version2Api', 'snake'), 'version2_api');
  assert.equal(convertKey('item3Price', 'snake'), 'item3_price');
});

test('camelCase to snake_case: all lowercase passthrough', () => {
  assert.equal(convertKey('already_snake', 'snake'), 'already_snake');
  assert.equal(convertKey('lowercase', 'snake'), 'lowercase');
  assert.equal(convertKey('with_existing_underscores', 'snake'), 'with_existing_underscores');
});

// --- snake_case -> camelCase ---

test('snake_case to camelCase: basic', () => {
  assert.equal(convertKey('email_title', 'camel'), 'emailTitle');
  assert.equal(convertKey('broker_id', 'camel'), 'brokerId');
  assert.equal(convertKey('is_active', 'camel'), 'isActive');
  assert.equal(convertKey('created_at', 'camel'), 'createdAt');
});

test('snake_case to camelCase: single word', () => {
  assert.equal(convertKey('name', 'camel'), 'name');
  assert.equal(convertKey('age', 'camel'), 'age');
  assert.equal(convertKey('x', 'camel'), 'x');
});

test('snake_case to camelCase: strings without underscores are normalized', () => {
  assert.equal(convertKey('alreadyCamel', 'camel'), 'alreadyCamel');
  assert.equal(convertKey('lowercase', 'camel'), 'lowercase');
  assert.equal(convertKey('PascalCase', 'camel'), 'pascalCase');
});

test('snake_case to camelCase: multi-segment', () => {
  assert.equal(convertKey('user_first_name', 'camel'), 'userFirstName');
  assert.equal(convertKey('http_response_code', 'camel'), 'httpResponseCode');
  assert.equal(convertKey('a_b_c', 'camel'), 'aBC');
});

// --- edge cases ---

test('convertKey: empty string', () => {
  assert.equal(convertKey('', 'snake'), '');
  assert.equal(convertKey('', 'camel'), '');
});

test('convertKey: single underscore', () => {
  assert.equal(convertKey('_', 'snake'), '_');
  assert.equal(convertKey('_', 'camel'), '_');
});

test('convertKey: leading underscores preserved in camel', () => {
  // Leading underscores are preserved; the first word stays lowercase.
  assert.equal(convertKey('__private', 'camel'), '__private');
  assert.equal(convertKey('_internal_field', 'camel'), '_internalField');
  assert.equal(convertKey('__private_field', 'camel'), '__privateField');
});

test('convertKey: trailing underscore in snake -> camel', () => {
  assert.equal(convertKey('field_', 'camel'), 'field_');
  assert.equal(convertKey('field__', 'camel'), 'field__');
});

test('convertKey: trailing underscore in camel -> snake', () => {
  // trailing _ is preserved, no extra transformation
  assert.equal(convertKey('field_', 'snake'), 'field_');
});

test('convertKey: all-caps string', () => {
  assert.equal(convertKey('HTTP', 'snake'), 'http');
  assert.equal(convertKey('URL', 'snake'), 'url');
  assert.equal(convertKey('API', 'snake'), 'api');
  assert.equal(convertKey('API', 'camel'), 'api');
});

test('convertKey: mixed separators (hyphens, dots)', () => {
  assert.equal(convertKey('kebab-case', 'snake'), 'kebab_case');
  assert.equal(convertKey('dotted.name', 'snake'), 'dotted_name');
  assert.equal(convertKey('kebab-case', 'camel'), 'kebabCase');
  assert.equal(convertKey('dotted.name', 'camel'), 'dottedName');
});

test('convertKey: numeric-only segments', () => {
  assert.equal(convertKey('v_2_api', 'camel'), 'v2Api');
  assert.equal(convertKey('field_1', 'camel'), 'field1');
});

test('convertKey: acronym and digit boundaries remain distinguishable', () => {
  assert.equal(convertKey('v2HTTPResponse', 'snake'), 'v2_http_response');
  assert.equal(convertKey('HTTP2Response', 'snake'), 'http2_response');
  assert.equal(convertKey('HTTP_response_code', 'camel'), 'httpResponseCode');
});

test('convertKey: repeated and surrounding underscores in snake -> camel', () => {
  assert.equal(convertKey('user__profile', 'camel'), 'userProfile');
  assert.equal(convertKey('___private_field__', 'camel'), '___privateField__');
  assert.equal(convertKey('__', 'camel'), '__');
  assert.equal(convertKey('__privateField', 'snake'), '__private_field');
});

test('convertKey: non-ASCII characters retain word boundaries', () => {
  assert.equal(convertKey('caféTitle', 'snake'), 'café_title');
  assert.equal(convertKey('über_mensch', 'camel'), 'überMensch');
});

test('convertKey: single character', () => {
  assert.equal(convertKey('a', 'snake'), 'a');
  assert.equal(convertKey('A', 'snake'), 'a');
  assert.equal(convertKey('a', 'camel'), 'a');
  assert.equal(convertKey('A', 'camel'), 'a');
});

test('convertKey: already in target format', () => {
  assert.equal(convertKey('email_title', 'snake'), 'email_title');
  assert.equal(convertKey('emailTitle', 'camel'), 'emailTitle');
  assert.equal(convertKey('name', 'snake'), 'name');
  assert.equal(convertKey('name', 'camel'), 'name');
});

test('getOppositeKeyNaming: detects snake_case and camelCase values', () => {
  assert.equal(getOppositeKeyNaming({ user_id: 1, nested: { created_at: 2 } }), 'camel');
  assert.equal(getOppositeKeyNaming({ userId: 1, nested: { createdAt: 2 } }), 'snake');
});

test('getOppositeKeyNaming: normalizes mixed or keyless values to snake_case', () => {
  assert.equal(getOppositeKeyNaming({ user_id: 1, userId: 2 }), 'snake');
  assert.equal(getOppositeKeyNaming({ name: 'Ada' }), 'snake');
  assert.equal(getOppositeKeyNaming([{ user_id: 1 }]), 'camel');
});

test('getOppositeKeyNamingFromString: supports JSON5 and JSONC syntax', () => {
  assert.equal(getOppositeKeyNamingFromString('{ user_id: 1, }'), 'camel');
  assert.equal(getOppositeKeyNamingFromString('{\n  "userId": 1, // comment\n}'), 'snake');
});

// --- round-trip ---

test('convertKey: snake -> camel -> snake round-trip', () => {
  const keys = [
    'email_title', 'broker_id', 'user_first_name',
    'http_response_code', 'is_active', 'created_at',
    'simple',
  ];
  for (const key of keys) {
    const toCamel = convertKey(key, 'camel');
    const backToSnake = convertKey(toCamel, 'snake');
    assert.equal(backToSnake, key, `round-trip failed for "${key}"`);
  }
});

test('convertKey: camel -> snake -> camel round-trip', () => {
  const keys = [
    'emailTitle', 'brokerId', 'userFirstName',
    'httpResponseCode', 'isActive', 'createdAt',
    'simple', 'field1Name',
  ];
  for (const key of keys) {
    const toSnake = convertKey(key, 'snake');
    const backToCamel = convertKey(toSnake, 'camel');
    assert.equal(backToCamel, key, `round-trip failed for "${key}"`);
  }
});

// ================================================================
// convertJsonKeys — recursive object conversion
// ================================================================

test('convertJsonKeys: flat object to snake', () => {
  const input = { emailTitle: 1, brokerId: 2, isActive: true };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    email_title: 1, broker_id: 2, is_active: true,
  });
});

test('convertJsonKeys: flat object to camel', () => {
  const input = { email_title: 1, broker_id: 2, is_active: true };
  assert.deepEqual(convertJsonKeys(input, 'camel'), {
    emailTitle: 1, brokerId: 2, isActive: true,
  });
});

test('convertJsonKeys: nested object', () => {
  const input = { emailTitle: 1, nested: { brokerId: 2, deep: { createdAt: 3 } } };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    email_title: 1, nested: { broker_id: 2, deep: { created_at: 3 } },
  });
});

test('convertJsonKeys: deeply nested object (5 levels)', () => {
  const input = { levelOne: { levelTwo: { levelThree: { levelFour: { levelFive: 42 } } } } };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    level_one: { level_two: { level_three: { level_four: { level_five: 42 } } } },
  });
});

test('convertJsonKeys: array of primitives', () => {
  assert.deepEqual(convertJsonKeys([1, 2, 3], 'snake'), [1, 2, 3]);
  assert.deepEqual(convertJsonKeys(['a', 'b'], 'camel'), ['a', 'b']);
});

test('convertJsonKeys: array of objects', () => {
  const input = [{ userId: 1 }, { userName: 'Alice' }];
  assert.deepEqual(convertJsonKeys(input, 'snake'), [{ user_id: 1 }, { user_name: 'Alice' }]);
});

test('convertJsonKeys: nested array inside object', () => {
  const input = { userList: [{ userId: 1 }, { userId: 2 }] };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    user_list: [{ user_id: 1 }, { user_id: 2 }],
  });
});

test('convertJsonKeys: object inside array inside object', () => {
  const input = {
    responseData: [
      { itemId: 1, itemTags: ['a', 'b'] },
      { itemId: 2, itemTags: ['c'] },
    ],
  };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    response_data: [
      { item_id: 1, item_tags: ['a', 'b'] },
      { item_id: 2, item_tags: ['c'] },
    ],
  });
});

test('convertJsonKeys: empty object', () => {
  assert.deepEqual(convertJsonKeys({}, 'snake'), {});
  assert.deepEqual(convertJsonKeys({}, 'camel'), {});
});

test('convertJsonKeys: empty array', () => {
  assert.deepEqual(convertJsonKeys([], 'snake'), []);
  assert.deepEqual(convertJsonKeys([], 'camel'), []);
});

test('convertJsonKeys: null value', () => {
  assert.equal(convertJsonKeys(null, 'snake'), null);
  assert.equal(convertJsonKeys(null, 'camel'), null);
});

test('convertJsonKeys: undefined value', () => {
  assert.equal(convertJsonKeys(undefined, 'snake'), undefined);
  assert.equal(convertJsonKeys(undefined, 'camel'), undefined);
});

test('convertJsonKeys: primitive values pass through unchanged', () => {
  assert.equal(convertJsonKeys(42, 'snake'), 42);
  assert.equal(convertJsonKeys('hello', 'snake'), 'hello');
  assert.equal(convertJsonKeys(true, 'camel'), true);
  assert.equal(convertJsonKeys(3.14, 'snake'), 3.14);
});

test('convertJsonKeys: null values inside objects', () => {
  const input = { emailTitle: null, brokerId: null };
  assert.deepEqual(convertJsonKeys(input, 'snake'), { email_title: null, broker_id: null });
});

test('convertJsonKeys: mixed null and non-null values', () => {
  const input = { userId: 1, userName: null, isActive: true, metadata: null };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    user_id: 1, user_name: null, is_active: true, metadata: null,
  });
});

test('convertJsonKeys: does not mutate input', () => {
  const input = { emailTitle: 1, nested: { brokerId: 2 } };
  convertJsonKeys(input, 'snake');
  assert.deepEqual(input, { emailTitle: 1, nested: { brokerId: 2 } });
});

test('convertJsonKeys: does not mutate nested arrays', () => {
  const input = { items: [{ itemId: 1 }] };
  convertJsonKeys(input, 'snake');
  assert.deepEqual(input, { items: [{ itemId: 1 }] });
});

test('convertJsonKeys: creates independent containers at every JSON level', () => {
  const input = {
    profileData: { userId: 1 },
    itemList: [{ itemId: 2 }],
    tags: ['primary'],
  };
  const result = convertJsonKeys(input, 'snake');

  assert.notStrictEqual(result, input);
  assert.notStrictEqual(result.profile_data, input.profileData);
  assert.notStrictEqual(result.item_list, input.itemList);
  assert.notStrictEqual(result.item_list[0], input.itemList[0]);
  assert.notStrictEqual(result.tags, input.tags);
  assert.strictEqual(result.tags[0], input.tags[0]);
});

test('convertJsonKeys: retains prototype-sensitive keys as own JSON properties', () => {
  const input = JSON.parse(
    '{"__proto__":{"nestedKey":1},"constructor":{"prototype":{"valueKey":2}},"prototype":{"ownerId":3}}',
  );
  const result = convertJsonKeys(input, 'snake');

  assert.strictEqual(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(Object.hasOwn(result, 'constructor'), true);
  assert.equal(Object.hasOwn(result, 'prototype'), true);
  assert.deepEqual(
    result,
    JSON.parse(
      '{"__proto__":{"nested_key":1},"constructor":{"prototype":{"value_key":2}},"prototype":{"owner_id":3}}',
    ),
  );
  assert.equal(
    JSON.stringify(result),
    '{"__proto__":{"nested_key":1},"constructor":{"prototype":{"value_key":2}},"prototype":{"owner_id":3}}',
  );
});

test('convertJsonKeys: collisions use the last source property in enumeration order', () => {
  assert.deepEqual(
    convertJsonKeys({ firstName: 'camel', first_name: 'snake' }, 'snake'),
    { first_name: 'snake' },
  );
  assert.deepEqual(
    convertJsonKeys({ first_name: 'snake', firstName: 'camel' }, 'camel'),
    { firstName: 'camel' },
  );
});

test('convertJsonKeys: mixed naming conventions', () => {
  const input = { snake_case_key: 1, camelCaseKey: 2, PascalCaseKey: 3, UPPERCASE: 4 };
  const result = convertJsonKeys(input, 'snake');
  assert.deepEqual(result, {
    snake_case_key: 1, camel_case_key: 2, pascal_case_key: 3, uppercase: 4,
  });
});

test('convertJsonKeys: keys with numbers', () => {
  const input = { field1Name: 'a', version2Api: 'b', item3: 'c' };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    field1_name: 'a', version2_api: 'b', item3: 'c',
  });
});

test('convertJsonKeys: consecutive uppercase in keys', () => {
  const input = { HTTPResponse: 200, parseURL: 'x', userID: 1 };
  assert.deepEqual(convertJsonKeys(input, 'snake'), {
    http_response: 200, parse_url: 'x', user_id: 1,
  });
});

test('convertJsonKeys: round-trip snake -> camel -> snake', () => {
  const original = {
    user_id: 1,
    user_name: 'Alice',
    nested: { created_at: 123, updated_at: 456 },
    items: [{ item_id: 1 }, { item_id: 2 }],
  };
  const toCamel = convertJsonKeys(original, 'camel');
  const backToSnake = convertJsonKeys(toCamel, 'snake');
  assert.deepEqual(backToSnake, original);
});

test('convertJsonKeys: round-trip camel -> snake -> camel', () => {
  const original = {
    userId: 1,
    userName: 'Alice',
    nested: { createdAt: 123, updatedAt: 456 },
    items: [{ itemId: 1 }, { itemId: 2 }],
  };
  const toSnake = convertJsonKeys(original, 'snake');
  const backToCamel = convertJsonKeys(toSnake, 'camel');
  assert.deepEqual(backToCamel, original);
});

// ================================================================
// convertJsonString — JSON string conversion
// ================================================================

test('convertJsonString: flat object to snake', () => {
  const result = convertJsonString('{"emailTitle":1,"brokerId":2}', 'snake');
  assert.equal(result, '{\n  "email_title": 1,\n  "broker_id": 2\n}');
});

test('convertJsonString: flat object to camel', () => {
  const result = convertJsonString('{"email_title":1,"broker_id":2}', 'camel');
  assert.equal(result, '{\n  "emailTitle": 1,\n  "brokerId": 2\n}');
});

test('convertJsonString: nested object to snake', () => {
  const result = convertJsonString('{"userProfile":{"userId":1}}', 'snake');
  assert.equal(result, '{\n  "user_profile": {\n    "user_id": 1\n  }\n}');
});

test('convertJsonString: array of objects to snake', () => {
  const result = convertJsonString('[{"userId":1},{"userId":2}]', 'snake');
  assert.equal(result, '[\n  {\n    "user_id": 1\n  },\n  {\n    "user_id": 2\n  }\n]');
});

test('convertJsonString: custom indent', () => {
  assert.equal(
    convertJsonString('{"aB":1}', 'snake', 4),
    '{\n    "a_b": 1\n}',
  );
  assert.equal(
    convertJsonString('{"a_b":1}', 'camel', 0),
    '{"aB":1}',
  );
});

test('convertJsonString: default indent is 2', () => {
  assert.equal(
    convertJsonString('{"aB":1}', 'snake'),
    '{\n  "a_b": 1\n}',
  );
});

test('convertJsonString: top-level array', () => {
  const result = convertJsonString('[{"userId":1}]', 'snake');
  assert.equal(result, '[\n  {\n    "user_id": 1\n  }\n]');
});

test('convertJsonString: top-level primitive', () => {
  assert.equal(convertJsonString('42', 'snake'), '42');
  assert.equal(convertJsonString('"hello"', 'camel'), '"hello"');
  assert.equal(convertJsonString('true', 'snake'), 'true');
  assert.equal(convertJsonString('null', 'camel'), 'null');
});

test('convertJsonString: empty object', () => {
  assert.equal(convertJsonString('{}', 'snake'), '{}');
  assert.equal(convertJsonString('{}', 'camel'), '{}');
});

test('convertJsonString: empty array', () => {
  assert.equal(convertJsonString('[]', 'snake'), '[]');
});

test('convertJsonString: null values in JSON', () => {
  const result = convertJsonString('{"emailTitle":null}', 'snake');
  assert.equal(result, '{\n  "email_title": null\n}');
});

test('convertJsonString: string values are not converted', () => {
  const result = convertJsonString('{"userName":"emailTitle"}', 'snake');
  assert.equal(result, '{\n  "user_name": "emailTitle"\n}');
});

test('convertJsonString: decodes escaped Unicode keys before naming conversion', () => {
  const result = convertJsonString('{"na\\u006deValue":1,"messageText":"na\\u006deValue"}', 'snake');
  assert.equal(result, '{\n  "name_value": 1,\n  "message_text": "nameValue"\n}');
});

test('convertJsonString: preserves prototype-sensitive keys in serialized output', () => {
  const result = convertJsonString('{"__proto__":{"nestedKey":1},"constructor":{"ownerId":2}}', 'snake');
  assert.equal(
    result,
    '{\n  "__proto__": {\n    "nested_key": 1\n  },\n  "constructor": {\n    "owner_id": 2\n  }\n}',
  );
});

test('convertJsonString: deeply nested JSON string', () => {
  const input = '{"a":{"b":{"c":{"d":{"eValue":42}}}}}';
  const result = convertJsonString(input, 'snake');
  assert.equal(result, '{\n  "a": {\n    "b": {\n      "c": {\n        "d": {\n          "e_value": 42\n        }\n      }\n    }\n  }\n}');
});

test('convertJsonString: mixed naming in JSON string', () => {
  const input = '{"snake_case":1,"camelCase":2,"PascalCase":3}';
  const result = convertJsonString(input, 'snake');
  assert.equal(result, '{\n  "snake_case": 1,\n  "camel_case": 2,\n  "pascal_case": 3\n}');
});

test('convertJsonString: invalid JSON returns original string', () => {
  const input = 'not valid json';
  assert.equal(convertJsonString(input, 'snake'), input);
});

test('tryConvertJsonString: invalid JSON returns null', () => {
  assert.equal(tryConvertJsonString('not valid json', 'snake'), null);
  assert.equal(tryConvertJsonString('{"userId":', 'camel'), null);
});

test('tryConvertJsonString: valid JSON returns converted output', () => {
  assert.equal(
    tryConvertJsonString('{"userId":1}', 'snake'),
    '{\n  "user_id": 1\n}',
  );
});

test('tryConvertJsonString: converts JSON5 and JSONC input', () => {
  assert.equal(
    tryConvertJsonString('{ user_id: 1, nested: { created_at: 2, }, }', 'camel'),
    '{\n  "userId": 1,\n  "nested": {\n    "createdAt": 2\n  }\n}',
  );
});

test('tryConvertJsonStringPreservingFormat: keeps JSON5 syntax and comments', () => {
  const input = `{
  // user identity
  user_id: 'Ada',
  profile_data: {
    created_at: 1,
  },
}`;
  assert.equal(
    tryConvertJsonStringPreservingFormat(input, 'camel'),
    `{
  // user identity
  userId: 'Ada',
  profileData: {
    createdAt: 1,
  },
}`,
  );
});

test('tryConvertJsonStringPreservingFormat: keeps JSONC syntax and spacing', () => {
  const input = '{\n  "user_id": 1, // keep this comment\n}';
  assert.equal(
    tryConvertJsonStringPreservingFormat(input, 'camel'),
    '{\n  "userId": 1, // keep this comment\n}',
  );
});

test('convertJsonString: empty string returns original', () => {
  assert.equal(convertJsonString('', 'snake'), '');
});

test('convertJsonString: truncated JSON returns original', () => {
  const input = '{"emailTitle":';
  assert.equal(convertJsonString(input, 'snake'), input);
});

test('convertJsonString: JSON with nested array values', () => {
  const input = '{"itemTags":["a","b"],"userId":1}';
  const result = convertJsonString(input, 'snake');
  assert.equal(result, '{\n  "item_tags": [\n    "a",\n    "b"\n  ],\n  "user_id": 1\n}');
});

test('convertJsonString: JSON with numeric keys (stringified)', () => {
  // JSON keys are always strings; numeric-looking keys have no casing to convert
  const input = '{"0":1,"1":2,"userId":3}';
  const result = convertJsonString(input, 'snake');
  assert.equal(result, '{\n  "0": 1,\n  "1": 2,\n  "user_id": 3\n}');
});

test('convertJsonString: JSON with special float values', () => {
  const input = '{"priceValue":1.5,"taxRate":0.07}';
  const result = convertJsonString(input, 'snake');
  assert.equal(result, '{\n  "price_value": 1.5,\n  "tax_rate": 0.07\n}');
});

test('convertJsonString: large nested structure round-trip', () => {
  const original = {
    userId: 1,
    userName: 'Alice',
    profile: {
      emailAddress: 'alice@example.com',
      preferences: {
        darkMode: true,
        notifications: { emailAlerts: false, pushEnabled: true },
      },
    },
    posts: [
      { postTitle: 'Hello', postMeta: { viewCount: 10 } },
      { postTitle: 'World', postMeta: { viewCount: 20 } },
    ],
  };
  const jsonStr = JSON.stringify(original);
  const toSnake = convertJsonString(jsonStr, 'snake');
  const backToCamel = convertJsonString(toSnake, 'camel');
  assert.deepEqual(JSON.parse(backToCamel), original);
});

test('convertJsonString: idempotent when already in target format', () => {
  // convertJsonString always re-formats with indent, so compare parsed
  // content rather than raw strings.
  const snakeJson = '{"email_title":1,"broker_id":2}';
  assert.deepEqual(JSON.parse(convertJsonString(snakeJson, 'snake')), { email_title: 1, broker_id: 2 });
  const camelJson = '{"emailTitle":1,"brokerId":2}';
  assert.deepEqual(JSON.parse(convertJsonString(camelJson, 'camel')), { emailTitle: 1, brokerId: 2 });
});
