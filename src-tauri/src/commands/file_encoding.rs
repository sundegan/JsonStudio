pub(super) fn decode_text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little_endian = bytes[0] == 0xff;
        let body = &bytes[2..];
        if body.len() % 2 != 0 {
            return Err("Invalid UTF-16 file: incomplete code unit".into());
        }
        let units: Vec<u16> = body
            .chunks_exact(2)
            .map(|chunk| {
                let pair = [chunk[0], chunk[1]];
                if little_endian {
                    u16::from_le_bytes(pair)
                } else {
                    u16::from_be_bytes(pair)
                }
            })
            .collect();
        return String::from_utf16(&units)
            .map_err(|error| format!("Invalid UTF-16 file: {error}"));
    }

    let mut text = String::from_utf8(bytes)
        .map_err(|error| format!("File is not UTF-8 or BOM-marked UTF-16: {error}"))?;
    if text.starts_with('\u{feff}') {
        text.replace_range(..'\u{feff}'.len_utf8(), "");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::decode_text;

    #[test]
    fn preserves_utf8_text_and_crlf() {
        let text = "{\r\n  \"name\": \"\u{4e2d}\u{6587}\"\r\n}";
        assert_eq!(decode_text(text.as_bytes().to_vec()).unwrap(), text);
    }

    #[test]
    fn removes_only_the_utf8_encoding_marker() {
        let text = "{\"value\":\"\u{feff}\"}";
        let bytes = [b"\xef\xbb\xbf".as_slice(), text.as_bytes()].concat();
        assert_eq!(decode_text(bytes).unwrap(), text);
        assert_eq!(decode_text(b"\xef\xbb\xbf".to_vec()).unwrap(), "");
    }

    #[test]
    fn decodes_bom_marked_utf16_in_both_byte_orders() {
        let text = "{\r\n  \"name\": \"\u{4e2d}\u{6587}\u{1f600}\"\r\n}";
        for little_endian in [true, false] {
            let mut bytes = if little_endian {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for unit in text.encode_utf16() {
                let pair = if little_endian { unit.to_le_bytes() } else { unit.to_be_bytes() };
                bytes.extend_from_slice(&pair);
            }
            assert_eq!(decode_text(bytes).unwrap(), text);
        }
    }

    #[test]
    fn rejects_invalid_encoding_without_replacement_characters() {
        assert!(decode_text(vec![0xff]).is_err());
        assert!(decode_text(vec![0xff, 0xfe, 0x00]).is_err());
        assert!(decode_text(vec![0xff, 0xfe, 0x00, 0xd8]).is_err());
    }
}
