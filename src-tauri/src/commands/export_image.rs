use ab_glyph::{Font, FontRef, GlyphId, PxScale, ScaleFont, point};
use base64::Engine;
use image::Rgba;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

const FONT_REGULAR: &[u8] = include_bytes!("../../fonts/JetBrainsMono-Regular.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../../fonts/JetBrainsMono-Bold.ttf");
const ICON_PNG: &[u8] = include_bytes!("../../icons/128x128@2x.png");

struct WatermarkAssets {
    icon_rgba: Vec<u8>,
    icon_size: u32,
    glyph_cache: GlyphCache,
    font_size: f32,
}

static WATERMARK_LIGHT: OnceLock<WatermarkAssets> = OnceLock::new();
static WATERMARK_DARK: OnceLock<WatermarkAssets> = OnceLock::new();

fn get_watermark(is_dark: bool) -> &'static WatermarkAssets {
    let lock = if is_dark { &WATERMARK_DARK } else { &WATERMARK_LIGHT };
    lock.get_or_init(|| build_watermark())
}

fn build_watermark() -> WatermarkAssets {
    let font_regular = FontRef::try_from_slice(FONT_REGULAR).unwrap();
    let font_bold = FontRef::try_from_slice(FONT_BOLD).unwrap();
    let wm_font_size = 16.0f32;
    let wm_scale = PxScale::from(wm_font_size);
    let glyph_cache = GlyphCache::new(&font_regular, &font_bold, wm_scale);
    let icon_size = (wm_font_size * 1.5).round() as u32;
    let icon = image::load_from_memory(ICON_PNG).unwrap();
    let resized = image::imageops::resize(&icon.to_rgba8(), icon_size, icon_size, image::imageops::FilterType::Triangle);
    let icon_rgba = resized.into_raw();

    WatermarkAssets { icon_rgba, icon_size, glyph_cache, font_size: wm_font_size }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportColors {
    pub background: String,
    pub foreground: String,
    pub key_color: String,
    pub string_color: String,
    pub number_color: String,
    pub boolean_color: String,
    pub null_color: String,
    pub delimiter_color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub content: String,
    pub colors: ExportColors,
    pub bracket_colors: Vec<String>,
    pub is_dark: bool,
    pub font_size: Option<f32>,
    pub line_height: Option<f32>,
}

fn parse_color(s: &str) -> Rgba<u8> {
    let s = s.trim();
    if let Some(hex) = s.strip_prefix('#') {
        let hex = hex.trim();
        return match hex.len() {
            6 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
                Rgba([r, g, b, 255])
            }
            8 => {
                let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(0);
                let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(0);
                let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(0);
                let a = u8::from_str_radix(&hex[6..8], 16).unwrap_or(255);
                Rgba([r, g, b, a])
            }
            _ => Rgba([128, 128, 128, 255]),
        };
    }
    if s.starts_with("rgb") {
        let inner = s
            .trim_start_matches("rgba(")
            .trim_start_matches("rgb(")
            .trim_end_matches(')');
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() >= 3 {
            let r = parts[0].trim().parse::<f32>().unwrap_or(0.0) as u8;
            let g = parts[1].trim().parse::<f32>().unwrap_or(0.0) as u8;
            let b = parts[2].trim().parse::<f32>().unwrap_or(0.0) as u8;
            let a = if parts.len() >= 4 {
                (parts[3].trim().parse::<f32>().unwrap_or(1.0) * 255.0) as u8
            } else { 255 };
            return Rgba([r, g, b, a]);
        }
    }
    Rgba([128, 128, 128, 255])
}

struct GlyphBitmap {
    width: u32,
    height: u32,
    offset_x: i32,
    offset_y: i32,
    coverage: Vec<u8>,
}

struct GlyphCache {
    glyphs: HashMap<(GlyphId, bool), GlyphBitmap>,
    advance: f32,
    advance_bold: f32,
    ascent: f32,
}

impl GlyphCache {
    fn new(font_regular: &FontRef, font_bold: &FontRef, scale: PxScale) -> Self {
        let scaled_r = font_regular.as_scaled(scale);
        let scaled_b = font_bold.as_scaled(scale);
        let advance = scaled_r.h_advance(font_regular.glyph_id('M'));
        let advance_bold = scaled_b.h_advance(font_bold.glyph_id('M'));
        let ascent = scaled_r.ascent();

        let mut cache = GlyphCache {
            glyphs: HashMap::new(),
            advance, advance_bold, ascent,
        };

        for c in (0x20u8..=0x7E).map(|b| b as char) {
            cache.rasterize(c, false, font_regular, scale);
            cache.rasterize(c, true, font_bold, scale);
        }
        cache
    }

    fn rasterize(&mut self, ch: char, bold: bool, font: &FontRef, scale: PxScale) {
        let glyph_id = font.glyph_id(ch);
        let glyph = glyph_id.with_scale_and_position(scale, point(0.0, self.ascent));
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            let w = (bounds.max.x - bounds.min.x).ceil() as u32;
            let h = (bounds.max.y - bounds.min.y).ceil() as u32;
            if w == 0 || h == 0 { return; }
            let mut coverage = vec![0u8; (w * h) as usize];
            outlined.draw(|x, y, c| {
                let idx = (y * w + x) as usize;
                if idx < coverage.len() {
                    coverage[idx] = (c * 255.0).min(255.0) as u8;
                }
            });
            self.glyphs.insert((glyph_id, bold), GlyphBitmap {
                width: w, height: h,
                offset_x: bounds.min.x.floor() as i32,
                offset_y: bounds.min.y.floor() as i32,
                coverage,
            });
        }
    }

    fn get(&self, ch: char, bold: bool, font: &FontRef) -> Option<&GlyphBitmap> {
        self.glyphs.get(&(font.glyph_id(ch), bold))
    }
}

#[inline]
fn blit_glyph(buf: &mut [u8], stride: usize, img_w: i32, img_h: i32, bitmap: &GlyphBitmap, x: i32, y: i32, cr: u32, cg: u32, cb: u32, ca: u32) {
    let bx = x + bitmap.offset_x;
    let by = y + bitmap.offset_y;
    if bx >= img_w || by >= img_h { return; }
    let bx_end = bx + bitmap.width as i32;
    let by_end = by + bitmap.height as i32;
    if bx_end <= 0 || by_end <= 0 { return; }

    let y_start = if by < 0 { (-by) as u32 } else { 0 };
    let y_end = if by_end > img_h { (img_h - by) as u32 } else { bitmap.height };
    let x_start = if bx < 0 { (-bx) as u32 } else { 0 };
    let x_end = if bx_end > img_w { (img_w - bx) as u32 } else { bitmap.width };

    let buf_len = buf.len();
    for py in y_start..y_end {
        let iy = (by + py as i32) as usize;
        let glyph_row = (py * bitmap.width) as usize;
        let img_row = iy * stride;
        for px in x_start..x_end {
            let cov = bitmap.coverage[glyph_row + px as usize] as u32;
            if cov == 0 { continue; }
            let alpha = (ca * cov) / 255;
            let inv = 255 - alpha;
            let idx = img_row + (bx + px as i32) as usize * 3;
            if idx + 2 >= buf_len { continue; }
            buf[idx]     = ((cr * alpha + buf[idx] as u32 * inv) / 255) as u8;
            buf[idx + 1] = ((cg * alpha + buf[idx + 1] as u32 * inv) / 255) as u8;
            buf[idx + 2] = ((cb * alpha + buf[idx + 2] as u32 * inv) / 255) as u8;
        }
    }
}

fn draw_cached_text(
    buf: &mut [u8], stride: usize, img_w: i32, img_h: i32,
    cache: &GlyphCache, text: &str, x: f32, y: f32,
    color: Rgba<u8>, bold: bool, font: &FontRef,
) {
    let adv = if bold { cache.advance_bold } else { cache.advance };
    let baseline_y = y + cache.ascent;
    let cr = color[0] as u32;
    let cg = color[1] as u32;
    let cb = color[2] as u32;
    let ca = color[3] as u32;
    let mut cx = x;
    for ch in text.chars() {
        if let Some(bitmap) = cache.get(ch, bold, font) {
            blit_glyph(buf, stride, img_w, img_h, bitmap, cx as i32, baseline_y as i32, cr, cg, cb, ca);
        }
        cx += adv;
    }
}

#[derive(Clone)]
struct Token { text: String, color: Rgba<u8>, bold: bool }

fn tokenize_json(content: &str, colors: &ExportColors, bracket_colors: &[String]) -> Vec<Vec<Token>> {
    let bracket_palette: Vec<Rgba<u8>> = if bracket_colors.is_empty() {
        vec![parse_color(&colors.delimiter_color)]
    } else {
        bracket_colors.iter().map(|c| parse_color(c)).collect()
    };
    let key_color = parse_color(&colors.key_color);
    let string_color = parse_color(&colors.string_color);
    let number_color = parse_color(&colors.number_color);
    let boolean_color = parse_color(&colors.boolean_color);
    let null_color = parse_color(&colors.null_color);
    let delimiter_color = parse_color(&colors.delimiter_color);
    let foreground = parse_color(&colors.foreground);

    let mut depth: usize = 0;
    let mut all_lines = Vec::new();

    for line in content.split('\n') {
        let mut tokens = Vec::new();
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let ch = chars[i];
            if ch == ' ' || ch == '\t' {
                let mut ws = String::new();
                while i < chars.len() && (chars[i] == ' ' || chars[i] == '\t') {
                    ws.push(if chars[i] == '\t' { ' ' } else { chars[i] });
                    if chars[i] == '\t' { ws.push(' '); }
                    i += 1;
                }
                tokens.push(Token { text: ws, color: foreground, bold: false });
                continue;
            }
            if ch == '"' {
                let mut j = i + 1;
                while j < chars.len() && chars[j] != '"' {
                    if chars[j] == '\\' { j += 1; }
                    j += 1;
                }
                j += 1;
                let s: String = chars[i..j.min(chars.len())].iter().collect();
                let rest: String = chars[j.min(chars.len())..].iter().collect();
                let is_key = rest.trim_start().starts_with(':');
                tokens.push(Token { text: s, color: if is_key { key_color } else { string_color }, bold: false });
                i = j.min(chars.len());
                continue;
            }
            if ch == '-' || ch.is_ascii_digit() {
                let mut j = i;
                if chars[j] == '-' { j += 1; }
                while j < chars.len() && (chars[j].is_ascii_digit() || chars[j] == '.' || chars[j] == 'e' || chars[j] == 'E' || chars[j] == '+' || chars[j] == '-') {
                    j += 1;
                }
                tokens.push(Token { text: chars[i..j].iter().collect(), color: number_color, bold: false });
                i = j;
                continue;
            }
            let remaining: String = chars[i..].iter().collect();
            if remaining.starts_with("true") {
                tokens.push(Token { text: "true".into(), color: boolean_color, bold: false });
                i += 4; continue;
            }
            if remaining.starts_with("false") {
                tokens.push(Token { text: "false".into(), color: boolean_color, bold: false });
                i += 5; continue;
            }
            if remaining.starts_with("null") {
                tokens.push(Token { text: "null".into(), color: null_color, bold: false });
                i += 4; continue;
            }
            if ch == '{' || ch == '}' {
                if ch == '}' { depth = depth.saturating_sub(1); }
                tokens.push(Token { text: ch.to_string(), color: bracket_palette[depth % bracket_palette.len()], bold: true });
                if ch == '{' { depth += 1; }
                i += 1; continue;
            }
            if ch == '[' || ch == ']' {
                if ch == ']' { depth = depth.saturating_sub(1); }
                tokens.push(Token { text: ch.to_string(), color: bracket_palette[depth % bracket_palette.len()], bold: true });
                if ch == '[' { depth += 1; }
                i += 1; continue;
            }
            if ch == ':' || ch == ',' {
                tokens.push(Token { text: ch.to_string(), color: delimiter_color, bold: true });
                i += 1; continue;
            }
            tokens.push(Token { text: ch.to_string(), color: foreground, bold: false });
            i += 1;
        }
        all_lines.push(tokens);
    }
    all_lines
}

struct DrawSegment { text: String, color: Rgba<u8>, bold: bool, x: f32 }

fn layout_lines(token_lines: &[Vec<Token>], content_width: f32, char_w: f32) -> Vec<Vec<DrawSegment>> {
    let mut result = Vec::new();
    for tokens in token_lines {
        if tokens.is_empty() { result.push(Vec::new()); continue; }
        let mut current: Vec<DrawSegment> = Vec::new();
        let mut cx = 0.0f32;
        for token in tokens {
            let tw = token.text.chars().count() as f32 * char_w;
            if cx + tw <= content_width || cx < 0.01 {
                current.push(DrawSegment { text: token.text.clone(), color: token.color, bold: token.bold, x: cx });
                cx += tw;
            } else {
                let mut rem = token.text.as_str();
                while !rem.is_empty() {
                    let fit = ((content_width - cx) / char_w).floor().max(1.0) as usize;
                    let fit = fit.min(rem.chars().count());
                    let boundary = rem.char_indices().nth(fit).map(|(i, _)| i).unwrap_or(rem.len());
                    let part = &rem[..boundary];
                    current.push(DrawSegment { text: part.to_string(), color: token.color, bold: token.bold, x: cx });
                    cx += part.chars().count() as f32 * char_w;
                    rem = &rem[boundary..];
                    if !rem.is_empty() {
                        result.push(current);
                        current = Vec::new();
                        cx = 0.0;
                    }
                }
            }
        }
        result.push(current);
    }
    result
}

fn overlay_cached_icon(buf: &mut [u8], stride: usize, img_w: u32, img_h: u32, icon_rgba: &[u8], icon_size: u32, x: u32, y: u32) {
    for py in 0..icon_size {
        let iy = y + py;
        if iy >= img_h { break; }
        for px in 0..icon_size {
            let ix = x + px;
            if ix >= img_w { continue; }
            let src_idx = ((py * icon_size + px) * 4) as usize;
            let fa = icon_rgba[src_idx + 3] as u32;
            if fa == 0 { continue; }
            let inv = 255 - fa;
            let dst = (iy as usize * stride) + (ix as usize * 3);
            buf[dst]     = ((icon_rgba[src_idx] as u32 * fa + buf[dst] as u32 * inv) / 255) as u8;
            buf[dst + 1] = ((icon_rgba[src_idx + 1] as u32 * fa + buf[dst + 1] as u32 * inv) / 255) as u8;
            buf[dst + 2] = ((icon_rgba[src_idx + 2] as u32 * fa + buf[dst + 2] as u32 * inv) / 255) as u8;
        }
    }
}

#[tauri::command]
pub async fn export_json_image(request: ExportRequest) -> Result<String, String> {
    tokio::task::spawn_blocking(move || generate_image(request))
        .await
        .map_err(|e| format!("Task failed: {}", e))?
}

fn generate_image(request: ExportRequest) -> Result<String, String> {
    let font_regular = FontRef::try_from_slice(FONT_REGULAR)
        .map_err(|e| format!("Failed to load font: {}", e))?;
    let font_bold = FontRef::try_from_slice(FONT_BOLD)
        .map_err(|e| format!("Failed to load font: {}", e))?;

    let font_size_px = request.font_size.unwrap_or(14.0).max(12.0);
    let line_height_px = request.line_height.unwrap_or(22.0).max(font_size_px * 1.5);
    let pad = (20u32, 24u32, 40u32, 24u32);

    let token_lines = tokenize_json(&request.content, &request.colors, &request.bracket_colors);

    let scale = PxScale::from(font_size_px);
    let cache = GlyphCache::new(&font_regular, &font_bold, scale);

    const MAX_WIDTH: u32 = 800;
    const MIN_WIDTH: u32 = 400;

    let max_content_w = (MAX_WIDTH - pad.1 - pad.3) as f32;
    let all_draw_lines = layout_lines(&token_lines, max_content_w, cache.advance);

    let max_line_chars: f32 = all_draw_lines.iter().map(|segs| {
        segs.last().map(|s| s.x + s.text.chars().count() as f32 * cache.advance).unwrap_or(0.0)
    }).fold(0.0f32, f32::max);

    let wm = get_watermark(request.is_dark);
    let wm_min_w = wm.icon_size as f32 + wm.font_size * 0.4 + 10.0 * wm.glyph_cache.advance_bold + wm.font_size * 1.5 + pad.3 as f32;

    let fit_width = (max_line_chars + pad.1 as f32 + pad.3 as f32).ceil() as u32;
    let canvas_width = fit_width.max(wm_min_w.ceil() as u32).clamp(MIN_WIDTH, MAX_WIDTH);

    let content_width = (canvas_width - pad.1 - pad.3) as f32;
    let all_draw_lines = if canvas_width < MAX_WIDTH {
        layout_lines(&token_lines, content_width, cache.advance)
    } else {
        all_draw_lines
    };

    const MAX_LINES: usize = 2000;
    let truncated = all_draw_lines.len() > MAX_LINES;
    let visible_lines = if truncated { MAX_LINES } else { all_draw_lines.len() };
    let draw_lines = &all_draw_lines[..visible_lines];
    let truncation_bar_h: u32 = if truncated { (line_height_px * 2.0).round() as u32 } else { 0 };
    let remaining_lines = all_draw_lines.len() - visible_lines;

    let logical_h = pad.0 + (visible_lines as u32 * line_height_px as u32) + truncation_bar_h + pad.2;

    // Adaptive scale factor based on total pixel count
    // <= 2M logical pixels -> 2x; >= 10M -> 1x; linear in between
    let logical_pixels = canvas_width as f64 * logical_h as f64;
    let scale_factor: f64 = if logical_pixels <= 2_000_000.0 {
        2.0
    } else if logical_pixels >= 10_000_000.0 {
        1.0
    } else {
        2.0 - (logical_pixels - 2_000_000.0) / 8_000_000.0
    };

    let render_w = (canvas_width as f64 * scale_factor).round() as u32;
    let render_h = (logical_h as f64 * scale_factor).round() as u32;
    let sf = scale_factor as f32;

    let render_font_size = font_size_px * sf;
    let render_line_height = line_height_px * sf;
    let render_pad = (
        (pad.0 as f32 * sf).round() as u32,
        (pad.1 as f32 * sf).round() as u32,
        (pad.2 as f32 * sf).round() as u32,
        (pad.3 as f32 * sf).round() as u32,
    );

    let render_scale = PxScale::from(render_font_size);
    let render_cache = GlyphCache::new(&font_regular, &font_bold, render_scale);

    let stride = render_w as usize * 3;
    let bg = parse_color(&request.colors.background);
    let buf_len = stride * render_h as usize;
    let mut buf = if bg[0] == bg[1] && bg[1] == bg[2] {
        vec![bg[0]; buf_len]
    } else {
        let mut b = Vec::with_capacity(buf_len);
        let mut row_buf = Vec::with_capacity(stride);
        for _ in 0..render_w as usize { row_buf.extend_from_slice(&[bg[0], bg[1], bg[2]]); }
        for _ in 0..render_h { b.extend_from_slice(&row_buf); }
        b
    };

    let img_w = render_w as i32;
    let img_h = render_h as i32;

    let char_ratio = render_cache.advance / cache.advance;
    let mut y = render_pad.0 as f32;
    for line_segs in draw_lines {
        let text_y = y + (render_line_height - render_font_size) / 2.0;
        for seg in line_segs {
            if seg.text.is_empty() { continue; }
            let font = if seg.bold { &font_bold } else { &font_regular };
            let rx = render_pad.1 as f32 + seg.x * char_ratio;
            draw_cached_text(&mut buf, stride, img_w, img_h, &render_cache, &seg.text, rx, text_y, seg.color, seg.bold, font);
        }
        y += render_line_height;
    }

    if truncated {
        let bar_y = render_pad.0 as f32 + visible_lines as f32 * render_line_height;
        let render_trunc_h = truncation_bar_h as f32 * sf;
        let hint_text = format!("... {} more lines not shown ...", remaining_lines);
        let hint_color = if request.is_dark { Rgba([180, 180, 180, 200]) } else { Rgba([100, 100, 100, 200]) };
        let hint_w = hint_text.chars().count() as f32 * render_cache.advance;
        let hint_x = ((render_w as f32 - hint_w) / 2.0).round();
        let hint_y = bar_y + (render_trunc_h - render_font_size) / 2.0;
        draw_cached_text(&mut buf, stride, img_w, img_h, &render_cache, &hint_text, hint_x, hint_y, hint_color, false, &font_regular);
    }

    let wm_gap = (wm.font_size * 0.4).round();
    let wm_pad_right = (wm.font_size * 0.5 * sf).round();
    let wm_pad_bottom = (wm.font_size * 1.0 * sf).round();

    let json_color = if request.is_dark {
        Rgba([255, 200, 60, 210])
    } else {
        Rgba([200, 140, 0, 190])
    };
    let studio_color = if request.is_dark {
        Rgba([220, 160, 80, 180])
    } else {
        Rgba([180, 110, 30, 160])
    };

    let wm_sf = sf.max(1.0);
    let wm_render_size = wm.font_size * wm_sf;
    let wm_render_scale = PxScale::from(wm_render_size);
    let wm_render_cache = GlyphCache::new(&font_regular, &font_bold, wm_render_scale);
    let wm_icon_size = (wm.icon_size as f32 * wm_sf).round() as u32;
    let wm_icon_rgba = if wm_sf > 1.01 {
        let icon = image::load_from_memory(ICON_PNG).unwrap();
        let resized = image::imageops::resize(&icon.to_rgba8(), wm_icon_size, wm_icon_size, image::imageops::FilterType::Triangle);
        resized.into_raw()
    } else {
        wm.icon_rgba.clone()
    };

    let wm_adv_bold = wm_render_cache.advance_bold;
    let json_w = 4.0 * wm_adv_bold;
    let studio_w = 6.0 * wm_adv_bold;

    let x_right = render_w as f32 - wm_pad_right;
    let text_x = (x_right - json_w - studio_w).round();
    let icon_x = (text_x - wm_gap * wm_sf - wm_icon_size as f32).round().max(0.0) as u32;

    let ascent = wm_render_cache.ascent;
    let icon_h = wm_icon_size as f32;

    let j_glyph = wm_render_cache.get('J', false, &font_regular);
    let (glyph_oy, glyph_h) = j_glyph
        .map(|g| (g.offset_y, g.height))
        .unwrap_or((-(ascent * 0.8) as i32, (ascent * 0.8) as u32));

    let bottom_y = render_h as f32 - wm_pad_bottom;
    let text_y = (bottom_y - wm_render_size).round();
    let baseline_y = text_y + ascent;
    let glyph_top = baseline_y + glyph_oy as f32;
    let glyph_bottom = glyph_top + glyph_h as f32;
    let glyph_center = (glyph_top + glyph_bottom) / 2.0;
    let icon_y = (glyph_center - icon_h / 2.0).round().max(0.0) as u32;

    overlay_cached_icon(&mut buf, stride, render_w, render_h, &wm_icon_rgba, wm_icon_size, icon_x, icon_y);
    draw_cached_text(&mut buf, stride, img_w, img_h, &wm_render_cache, "Json", text_x, text_y, json_color, true, &font_bold);
    draw_cached_text(&mut buf, stride, img_w, img_h, &wm_render_cache, "Studio", text_x + json_w, text_y, studio_color, true, &font_bold);

    let compression = if buf_len < 6_000_000 {
        png::Compression::High
    } else {
        png::Compression::Balanced
    };

    let mut png_buf = Vec::with_capacity(buf_len / 4);
    {
        let mut encoder = png::Encoder::new(&mut png_buf, render_w, render_h);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_compression(compression);
        encoder.set_filter(png::Filter::Up);
        let mut writer = encoder.write_header()
            .map_err(|e| format!("PNG header failed: {}", e))?;
        writer.write_image_data(&buf)
            .map_err(|e| format!("PNG write failed: {}", e))?;
    }

    Ok(base64::engine::general_purpose::STANDARD.encode(&png_buf))
}
