// JSON processing service - communicates with Rust backend
import { invoke } from '@tauri-apps/api/core';

// Validation result type
export interface ValidationResult {
  valid: boolean;
  error_message: string | null;
  error_line: number | null;
  error_column: number | null;
}

// JSON statistics type
export interface JsonStats {
  valid: boolean;
  key_count: number;
  depth: number;
  byte_size: number;
  error_info: ValidationResult | null;
}

/**
 * Format JSON string
 */
export async function formatJson(content: string, indent: number = 2): Promise<string> {
  return await invoke<string>('json_format', { content, indent });
}

/**
 * Minify JSON string
 */
export async function minifyJson(content: string): Promise<string> {
  return await invoke<string>('json_minify', { content });
}

/**
 * Validate JSON and return detailed error location
 */
export async function validateJson(content: string): Promise<ValidationResult> {
  return await invoke<ValidationResult>('json_validate', { content });
}

/**
 * Get JSON statistics
 */
export async function getJsonStats(content: string): Promise<JsonStats> {
  return await invoke<JsonStats>('json_stats', { content });
}

/**
 * Escape string (convert string to JSON string format)
 */
export async function escapeString(content: string): Promise<string> {
  return await invoke<string>('json_escape', { content });
}

/**
 * Unescape string (convert JSON string format to plain string)
 */
export async function unescapeString(content: string): Promise<string> {
  return await invoke<string>('json_unescape', { content });
}
