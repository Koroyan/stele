//! The `stele-content-v1` model, its canonical serialization and the content hash
//! (PROTOCOL_SPEC.md §4.1, §4.3–§4.5).

use serde_json::{Map, Value};
use stele_core::constants::CONTENT_FORMAT;
use stele_core::encoding::push_u64;
use stele_core::hash::sha256;
use stele_core::version::push_json_string;

use crate::error::CanonError;
use crate::normalize::{is_canonical_inline, is_canonical_text, normalize_inline, normalize_text};

pub const MAX_BLOCKS: usize = 5_000;
pub const MAX_HEADING_BYTES: usize = 500;
pub const MAX_PARAGRAPH_BYTES: usize = 20_000;
pub const MAX_LIST_ITEMS: usize = 500;
pub const MAX_LIST_ITEM_BYTES: usize = 5_000;
pub const MAX_CHANGE_SUMMARY_BYTES: usize = 2_000;
pub const MAX_ATTACHMENTS: usize = 20;
pub const MAX_ATTACHMENT_NAME_BYTES: usize = 128;
pub const MAX_ATTACHMENT_SIZE: u64 = 26_214_400;
pub const MAX_CANONICAL_BYTES: usize = 2_097_152;
pub const ALLOWED_MEDIA_TYPES: [&str; 4] =
    ["application/pdf", "image/png", "image/jpeg", "text/plain"];

/// A content block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Block {
    Heading { level: u8, text: String },
    Paragraph { text: String },
    List { ordered: bool, items: Vec<String> },
}

/// A hash-referenced attachment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub media_type: String,
    pub name: String,
    /// Lowercase hex SHA-256 of the attachment bytes.
    pub sha256: String,
    pub size: u64,
}

/// A `stele-content-v1` document body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Content {
    pub attachments: Vec<Attachment>,
    pub blocks: Vec<Block>,
    pub change_summary: Option<String>,
}

fn check_len(s: &str, max: usize, what: &'static str) -> Result<(), CanonError> {
    if s.len() > max {
        Err(CanonError::LimitExceeded(what))
    } else {
        Ok(())
    }
}

fn validate_attachment(a: &Attachment) -> Result<(), CanonError> {
    if !ALLOWED_MEDIA_TYPES.contains(&a.media_type.as_str()) {
        return Err(CanonError::InvalidStructure(format!(
            "media type {} is not allowed",
            a.media_type
        )));
    }
    let name = a.name.as_bytes();
    if name.is_empty()
        || name.len() > MAX_ATTACHMENT_NAME_BYTES
        || !name[0].is_ascii_alphanumeric()
        || !name
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return Err(CanonError::InvalidStructure(format!(
            "invalid attachment name {:?}",
            a.name
        )));
    }
    if a.sha256.len() != 64
        || !a
            .sha256
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(CanonError::InvalidStructure(
            "attachment sha256 must be 64 lowercase hex".into(),
        ));
    }
    if a.size == 0 || a.size > MAX_ATTACHMENT_SIZE {
        return Err(CanonError::LimitExceeded("attachment size"));
    }
    Ok(())
}

impl Content {
    /// Normalizes every text field and validates every limit, producing canonical content.
    pub fn canonicalize(&self) -> Result<Content, CanonError> {
        if self.blocks.is_empty() {
            return Err(CanonError::InvalidStructure(
                "at least one block is required".into(),
            ));
        }
        if self.blocks.len() > MAX_BLOCKS {
            return Err(CanonError::LimitExceeded("blocks"));
        }
        let mut blocks = Vec::with_capacity(self.blocks.len());
        for block in &self.blocks {
            blocks.push(match block {
                Block::Heading { level, text } => {
                    if !(1..=3).contains(level) {
                        return Err(CanonError::InvalidStructure(
                            "heading level must be 1, 2 or 3".into(),
                        ));
                    }
                    let text = normalize_inline(text)?;
                    check_len(&text, MAX_HEADING_BYTES, "heading text")?;
                    Block::Heading {
                        level: *level,
                        text,
                    }
                }
                Block::Paragraph { text } => {
                    let text = normalize_text(text)?;
                    check_len(&text, MAX_PARAGRAPH_BYTES, "paragraph text")?;
                    Block::Paragraph { text }
                }
                Block::List { ordered, items } => {
                    if items.is_empty() {
                        return Err(CanonError::InvalidStructure(
                            "list must have at least one item".into(),
                        ));
                    }
                    if items.len() > MAX_LIST_ITEMS {
                        return Err(CanonError::LimitExceeded("list items"));
                    }
                    let mut out = Vec::with_capacity(items.len());
                    for item in items {
                        let item = normalize_inline(item)?;
                        check_len(&item, MAX_LIST_ITEM_BYTES, "list item")?;
                        out.push(item);
                    }
                    Block::List {
                        ordered: *ordered,
                        items: out,
                    }
                }
            });
        }
        let change_summary = match &self.change_summary {
            None => None,
            Some(s) => {
                let s = normalize_text(s)?;
                check_len(&s, MAX_CHANGE_SUMMARY_BYTES, "change summary")?;
                Some(s)
            }
        };
        if self.attachments.len() > MAX_ATTACHMENTS {
            return Err(CanonError::LimitExceeded("attachments"));
        }
        for (i, a) in self.attachments.iter().enumerate() {
            validate_attachment(a)?;
            if self.attachments[..i].iter().any(|b| b.name == a.name) {
                return Err(CanonError::InvalidStructure(format!(
                    "duplicate attachment name {:?}",
                    a.name
                )));
            }
        }
        let content = Content {
            attachments: self.attachments.clone(),
            blocks,
            change_summary,
        };
        if content.to_canonical_bytes().len() > MAX_CANONICAL_BYTES {
            return Err(CanonError::LimitExceeded("canonical size"));
        }
        Ok(content)
    }

    /// RFC 8785 serialization of (already canonical) content.
    pub fn to_canonical_bytes(&self) -> Vec<u8> {
        let mut s = String::with_capacity(4096);
        s.push_str("{\"attachments\":[");
        for (i, a) in self.attachments.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str("{\"mediaType\":");
            push_json_string(&mut s, &a.media_type);
            s.push_str(",\"name\":");
            push_json_string(&mut s, &a.name);
            s.push_str(",\"sha256\":");
            push_json_string(&mut s, &a.sha256);
            s.push_str(",\"size\":");
            push_u64(&mut s, a.size);
            s.push('}');
        }
        s.push_str("],\"blocks\":[");
        for (i, b) in self.blocks.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            match b {
                Block::Heading { level, text } => {
                    s.push_str("{\"level\":");
                    push_u64(&mut s, u64::from(*level));
                    s.push_str(",\"text\":");
                    push_json_string(&mut s, text);
                    s.push_str(",\"type\":\"heading\"}");
                }
                Block::Paragraph { text } => {
                    s.push_str("{\"text\":");
                    push_json_string(&mut s, text);
                    s.push_str(",\"type\":\"paragraph\"}");
                }
                Block::List { ordered, items } => {
                    s.push_str("{\"items\":[");
                    for (j, item) in items.iter().enumerate() {
                        if j > 0 {
                            s.push(',');
                        }
                        push_json_string(&mut s, item);
                    }
                    s.push_str("],\"ordered\":");
                    s.push_str(if *ordered { "true" } else { "false" });
                    s.push_str(",\"type\":\"list\"}");
                }
            }
        }
        s.push_str("],\"changeSummary\":");
        match &self.change_summary {
            None => s.push_str("null"),
            Some(cs) => push_json_string(&mut s, cs),
        }
        s.push_str(",\"format\":\"");
        s.push_str(CONTENT_FORMAT);
        s.push_str("\"}");
        s.into_bytes()
    }
}

/// `content_hash = SHA-256(canonical content bytes)`.
pub fn content_hash(canonical_bytes: &[u8]) -> [u8; 32] {
    sha256(canonical_bytes)
}

// ---- Parsing stored bytes ----------------------------------------------------------------------

fn bad(why: &str) -> CanonError {
    CanonError::InvalidStructure(why.to_string())
}

fn exact_keys<'a>(
    v: &'a Value,
    keys: &[&str],
    what: &str,
) -> Result<&'a Map<String, Value>, CanonError> {
    let obj = v
        .as_object()
        .ok_or_else(|| bad(&format!("{what} must be an object")))?;
    if obj.len() != keys.len() || !keys.iter().all(|k| obj.contains_key(*k)) {
        return Err(bad(&format!("{what} must have exactly the keys {keys:?}")));
    }
    Ok(obj)
}

fn get_str<'a>(obj: &'a Map<String, Value>, key: &str) -> Result<&'a str, CanonError> {
    obj.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| bad(&format!("{key} must be a string")))
}

fn canonical_text(s: &str, inline: bool) -> Result<String, CanonError> {
    let ok = if inline {
        is_canonical_inline(s)
    } else {
        is_canonical_text(s)
    };
    if ok {
        Ok(s.to_string())
    } else {
        Err(CanonError::NonCanonicalText)
    }
}

/// Parses stored bytes and proves they are canonical `stele-content-v1` (§4.5): valid JSON, exact
/// model, canonical text, and byte-identical re-serialization.
pub fn parse_canonical(bytes: &[u8]) -> Result<Content, CanonError> {
    if bytes.len() > MAX_CANONICAL_BYTES {
        return Err(CanonError::LimitExceeded("canonical size"));
    }
    let root: Value =
        serde_json::from_slice(bytes).map_err(|e| CanonError::InvalidJson(e.to_string()))?;
    let obj = exact_keys(
        &root,
        &["attachments", "blocks", "changeSummary", "format"],
        "content",
    )?;
    if get_str(obj, "format")? != CONTENT_FORMAT {
        return Err(bad("format must be stele-content-v1"));
    }

    let mut attachments = Vec::new();
    for a in obj["attachments"]
        .as_array()
        .ok_or_else(|| bad("attachments must be an array"))?
    {
        let ao = exact_keys(a, &["mediaType", "name", "sha256", "size"], "attachment")?;
        attachments.push(Attachment {
            media_type: get_str(ao, "mediaType")?.to_string(),
            name: get_str(ao, "name")?.to_string(),
            sha256: get_str(ao, "sha256")?.to_string(),
            size: ao["size"]
                .as_u64()
                .ok_or_else(|| bad("size must be an integer"))?,
        });
    }

    let mut blocks = Vec::new();
    for b in obj["blocks"]
        .as_array()
        .ok_or_else(|| bad("blocks must be an array"))?
    {
        let kind = b
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("block type missing"))?;
        blocks.push(match kind {
            "heading" => {
                let bo = exact_keys(b, &["level", "text", "type"], "heading")?;
                let level = bo["level"]
                    .as_u64()
                    .ok_or_else(|| bad("level must be an integer"))?;
                if !(1..=3).contains(&level) {
                    return Err(bad("heading level must be 1, 2 or 3"));
                }
                Block::Heading {
                    level: level as u8,
                    text: canonical_text(get_str(bo, "text")?, true)?,
                }
            }
            "paragraph" => {
                let bo = exact_keys(b, &["text", "type"], "paragraph")?;
                Block::Paragraph {
                    text: canonical_text(get_str(bo, "text")?, false)?,
                }
            }
            "list" => {
                let bo = exact_keys(b, &["items", "ordered", "type"], "list")?;
                let ordered = bo["ordered"]
                    .as_bool()
                    .ok_or_else(|| bad("ordered must be a boolean"))?;
                let mut items = Vec::new();
                for item in bo["items"]
                    .as_array()
                    .ok_or_else(|| bad("items must be an array"))?
                {
                    let s = item
                        .as_str()
                        .ok_or_else(|| bad("list items must be strings"))?;
                    items.push(canonical_text(s, true)?);
                }
                Block::List { ordered, items }
            }
            other => return Err(bad(&format!("unknown block type {other:?}"))),
        });
    }

    let change_summary = match &obj["changeSummary"] {
        Value::Null => None,
        Value::String(s) => Some(canonical_text(s, false)?),
        _ => return Err(bad("changeSummary must be a string or null")),
    };

    let parsed = Content {
        attachments,
        blocks,
        change_summary,
    };
    // Limits and model rules are re-checked by canonicalize(); it must be a no-op on canonical input.
    let recanonical = parsed.canonicalize()?;
    if recanonical != parsed || recanonical.to_canonical_bytes() != bytes {
        return Err(CanonError::NonCanonicalBytes);
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Content {
        Content {
            attachments: vec![],
            blocks: vec![
                Block::Heading {
                    level: 1,
                    text: " Terms of  Service ".into(),
                },
                Block::Paragraph {
                    text: "Line one\r\nLine \"two\"\r\n\r\n".into(),
                },
                Block::List {
                    ordered: true,
                    items: vec!["First".into(), "Second\nitem".into()],
                },
            ],
            change_summary: None,
        }
    }

    #[test]
    fn canonical_round_trip() {
        let c = sample().canonicalize().unwrap();
        let bytes = c.to_canonical_bytes();
        let text = String::from_utf8(bytes.clone()).unwrap();
        assert_eq!(
            text,
            "{\"attachments\":[],\"blocks\":[{\"level\":1,\"text\":\"Terms of Service\",\"type\":\"heading\"},\
             {\"text\":\"Line one\\nLine \\\"two\\\"\",\"type\":\"paragraph\"},\
             {\"items\":[\"First\",\"Second item\"],\"ordered\":true,\"type\":\"list\"}],\
             \"changeSummary\":null,\"format\":\"stele-content-v1\"}"
        );
        assert_eq!(parse_canonical(&bytes).unwrap(), c);
        assert_eq!(content_hash(&bytes), sha256(&bytes));
    }

    #[test]
    fn rejects_non_canonical_bytes() {
        let bytes = sample().canonicalize().unwrap().to_canonical_bytes();
        let mut spaced = String::from_utf8(bytes.clone()).unwrap();
        spaced = spaced.replacen("{", "{ ", 1);
        assert!(parse_canonical(spaced.as_bytes()).is_err());
        let reordered = String::from_utf8(bytes).unwrap().replace(
            "\"changeSummary\":null,\"format\":\"stele-content-v1\"",
            "\"format\":\"stele-content-v1\",\"changeSummary\":null",
        );
        assert_eq!(
            parse_canonical(reordered.as_bytes()),
            Err(CanonError::NonCanonicalBytes)
        );
        let extra = "{\"attachments\":[],\"blocks\":[{\"text\":\"a\",\"type\":\"paragraph\"}],\"changeSummary\":null,\"extra\":1,\"format\":\"stele-content-v1\"}";
        assert!(matches!(
            parse_canonical(extra.as_bytes()),
            Err(CanonError::InvalidStructure(_))
        ));
        let not_nfc = "{\"attachments\":[],\"blocks\":[{\"text\":\"Cafe\u{0301}\",\"type\":\"paragraph\"}],\"changeSummary\":null,\"format\":\"stele-content-v1\"}";
        assert_eq!(
            parse_canonical(not_nfc.as_bytes()),
            Err(CanonError::NonCanonicalText)
        );
        let dup = "{\"attachments\":[],\"blocks\":[{\"text\":\"a\",\"type\":\"paragraph\"}],\"changeSummary\":null,\"format\":\"stele-content-v1\",\"format\":\"stele-content-v1\"}";
        assert!(parse_canonical(dup.as_bytes()).is_err());
    }

    #[test]
    fn attachments_validated() {
        let mut c = sample();
        c.attachments.push(Attachment {
            media_type: "application/pdf".into(),
            name: "annex-a.pdf".into(),
            sha256: "a".repeat(64),
            size: 1024,
        });
        assert!(c.canonicalize().is_ok());
        c.attachments[0].media_type = "text/html".into();
        assert!(c.canonicalize().is_err());
        c.attachments[0].media_type = "application/pdf".into();
        c.attachments[0].name = "../etc/passwd".into();
        assert!(c.canonicalize().is_err());
    }
}
