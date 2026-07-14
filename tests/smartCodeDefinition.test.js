import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSmartCodeDefinition,
  SMART_CODEGEN_LANGUAGES,
} from '../src/lib/services/smartCodeDefinition.js';
import { CODEGEN_LANGUAGES, supportsReverse } from '../src/lib/services/codegen.ts';

const samples = [
  ['protobuf', 'syntax = "proto3"; message User { string name = 1; }'],
  ['thrift', 'namespace js demo\nstruct User { 1: string name }'],
  ['objectivec', '@interface User : NSObject\n@property NSString *name;\n@end'],
  ['scala', 'case class User(name: String)'],
  ['kotlin', 'data class User(val name: String)'],
  ['rust', '#[derive(Debug)]\npub struct User { pub name: String }'],
  ['go', 'type User struct { Name string }'],
  ['swift', 'struct User { let name: String }'],
  ['csharp', 'namespace Demo { public class User { public string Name { get; set; } } }'],
  ['dart', 'class User { final String name; User(this.name); }'],
  ['php', '<?php class User { public string $name; }'],
  ['ruby', 'class User\n attr_accessor :name\nend'],
  ['cpp', '#include <string>\nstruct User { std::string name; };'],
  ['python', 'class User:\n name: str\n def __init__(self): self.name = ""'],
  ['typescript', 'interface User { name: string; }'],
  ['javascript', 'class User { constructor(name) { this.name = name; } }'],
  ['java', 'public class User { private String name; }'],
];

test('detects every language supported by Codegen reverse conversion', () => {
  const reverseLanguages = CODEGEN_LANGUAGES
    .map(({ id }) => id)
    .filter((language) => supportsReverse(language));
  assert.deepEqual([...SMART_CODEGEN_LANGUAGES].sort(), [...reverseLanguages].sort());
  assert.equal(samples.length, SMART_CODEGEN_LANGUAGES.length);
  for (const [language, source] of samples) {
    assert.equal(detectSmartCodeDefinition(source)?.language, language, source);
  }
});

test('returns the Codegen preset and preserves the structure name', () => {
  assert.deepEqual(
    detectSmartCodeDefinition('public class User { private String name; }'),
    { language: 'java', kind: 'Java Structure', label: 'User' },
  );
  assert.deepEqual(
    detectSmartCodeDefinition('interface User { name: string; age: number; }'),
    { language: 'typescript', kind: 'TypeScript Structure', label: 'User' },
  );
  assert.deepEqual(
    detectSmartCodeDefinition('const User = { name: "Alice", age: 30 };'),
    { language: 'javascript', kind: 'JavaScript Structure', label: 'User' },
  );
  assert.deepEqual(
    detectSmartCodeDefinition('export type User = { name: string; age: number; };'),
    { language: 'typescript', kind: 'TypeScript Structure', label: 'User' },
  );
  assert.deepEqual(
    detectSmartCodeDefinition('export const User = { name: "Alice", age: 30 };'),
    { language: 'javascript', kind: 'JavaScript Structure', label: 'User' },
  );
  assert.equal(detectSmartCodeDefinition('INFO payload={"id":1}'), null);
});
