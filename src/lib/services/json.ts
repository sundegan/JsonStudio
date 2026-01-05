// JSON 处理服务 - 与 Rust 后端通信
import { invoke } from '@tauri-apps/api/core';

// 校验结果类型
export interface ValidationResult {
  valid: boolean;
  error_message: string | null;
  error_line: number | null;
  error_column: number | null;
}

// JSON 统计信息类型
export interface JsonStats {
  valid: boolean;
  key_count: number;
  depth: number;
  byte_size: number;
  error_info: ValidationResult | null;
}

/**
 * 格式化 JSON 字符串
 */
export async function formatJson(content: string, indent: number = 2): Promise<string> {
  return await invoke<string>('json_format', { content, indent });
}

/**
 * 压缩 JSON 字符串
 */
export async function minifyJson(content: string): Promise<string> {
  return await invoke<string>('json_minify', { content });
}

/**
 * 校验 JSON 并返回详细错误位置
 */
export async function validateJson(content: string): Promise<ValidationResult> {
  return await invoke<ValidationResult>('json_validate', { content });
}

/**
 * 获取 JSON 统计信息
 */
export async function getJsonStats(content: string): Promise<JsonStats> {
  return await invoke<JsonStats>('json_stats', { content });
}

/**
 * 转义字符串（将字符串转换为 JSON 字符串格式）
 */
export async function escapeString(content: string): Promise<string> {
  return await invoke<string>('json_escape', { content });
}

/**
 * 反转义字符串（将 JSON 字符串格式转换为普通字符串）
 */
export async function unescapeString(content: string): Promise<string> {
  return await invoke<string>('json_unescape', { content });
}
