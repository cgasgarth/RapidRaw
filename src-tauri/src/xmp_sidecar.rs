use quick_xml::{
    Reader, XmlVersion,
    events::{BytesStart, Event},
};
use regex::Regex;
use std::fs;
use std::path::{Path, PathBuf};

use crate::tagging::{COLOR_TAG_PREFIX, USER_TAG_PREFIX};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct XmpSidecarFields {
    pub rating: Option<u8>,
    pub label: Option<String>,
    pub tags: Vec<String>,
}

fn local_name(name: &[u8]) -> &[u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn attr_value(event: &BytesStart<'_>, reader: &Reader<&[u8]>, key: &[u8]) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find(|attribute| local_name(attribute.key.as_ref()) == key)
        .and_then(|attribute| {
            attribute
                .decoded_and_normalized_value(XmlVersion::default(), reader.decoder())
                .ok()
                .map(|value| value.into_owned())
        })
}

fn parse_rating(value: &str) -> Option<u8> {
    value.trim().parse().ok()
}

fn predefined_entity(reference: &str) -> Option<&'static str> {
    match reference {
        "amp" => Some("&"),
        "apos" => Some("'"),
        "gt" => Some(">"),
        "lt" => Some("<"),
        "quot" => Some("\""),
        _ => None,
    }
}

pub fn parse_xmp_sidecar_fields(content: &str) -> XmpSidecarFields {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(false);
    let mut fields = XmpSidecarFields::default();
    let mut active_element: Option<Vec<u8>> = None;
    let mut active_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref()).to_vec();
                match name.as_slice() {
                    b"Description" => {
                        if fields.rating.is_none()
                            && let Some(rating) = attr_value(&event, &reader, b"Rating")
                                .and_then(|value| parse_rating(&value))
                        {
                            fields.rating = Some(rating);
                        }
                        if fields.label.is_none() {
                            fields.label = attr_value(&event, &reader, b"Label");
                        }
                    }
                    b"Rating" | b"Label" | b"li" => {
                        active_element = Some(name);
                        active_text.clear();
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(text)) => {
                if active_element.is_none() {
                    continue;
                }
                let Ok(value) = text.xml_content(XmlVersion::default()) else {
                    continue;
                };
                active_text.push_str(&value);
            }
            Ok(Event::GeneralRef(reference)) => {
                if active_element.is_none() {
                    continue;
                }
                let Ok(value) = reference.xml_content(XmlVersion::default()) else {
                    continue;
                };
                active_text.push_str(predefined_entity(&value).unwrap_or(&value));
            }
            Ok(Event::End(event)) => {
                let ended_name = local_name(event.name().as_ref()).to_vec();
                let Some(active_name) = active_element.as_deref() else {
                    continue;
                };
                if active_name != ended_name.as_slice() {
                    continue;
                }
                let value = active_text.trim();
                if value.is_empty() {
                    active_element = None;
                    active_text.clear();
                    continue;
                }
                match active_name {
                    b"Rating" if fields.rating.is_none() => {
                        fields.rating = parse_rating(value);
                    }
                    b"Label" if fields.label.is_none() => {
                        fields.label = Some(value.to_string());
                    }
                    b"li" => fields.tags.push(value.to_string()),
                    _ => {}
                }
                active_element = None;
                active_text.clear();
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    fields
}

pub fn extract_xmp_rating(content: &str) -> Option<u8> {
    parse_xmp_sidecar_fields(content).rating
}

pub fn extract_xmp_label(content: &str) -> Option<String> {
    parse_xmp_sidecar_fields(content).label
}

pub fn extract_xmp_tags(content: &str) -> Vec<String> {
    parse_xmp_sidecar_fields(content).tags
}

fn xmp_path_for_source(source_path: &Path) -> (PathBuf, Option<PathBuf>) {
    let xmp_path = source_path.with_extension("xmp");
    let xmp_path_upper = source_path.with_extension("XMP");
    let actual_xmp = if xmp_path.exists() {
        Some(xmp_path.clone())
    } else if xmp_path_upper.exists() {
        Some(xmp_path_upper)
    } else {
        None
    };

    (xmp_path, actual_xmp)
}

fn xmp_skeleton() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="RapidRAW">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#
}

fn normalized_xmp_label_and_keywords(tags: Option<&[String]>) -> (Option<String>, Vec<String>) {
    let mut label = None;
    let mut normal_tags = Vec::new();

    for tag in tags.unwrap_or_default() {
        if let Some(color) = tag.strip_prefix(COLOR_TAG_PREFIX) {
            let mut chars = color.chars();
            let cap_color = match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            };
            label = Some(cap_color);
        } else if let Some(user_tag) = tag.strip_prefix(USER_TAG_PREFIX) {
            normal_tags.push(user_tag.to_string());
        } else {
            normal_tags.push(tag.clone());
        }
    }

    (label, normal_tags)
}

pub fn sync_metadata_to_xmp_sidecar(
    source_path: &Path,
    rating: u8,
    tags: Option<&[String]>,
    create_if_missing: bool,
) -> Result<(), String> {
    let (xmp_path, mut actual_xmp) = xmp_path_for_source(source_path);

    if actual_xmp.is_none() {
        if !create_if_missing {
            return Ok(());
        }
        crate::exif_processing::write_text_file_atomic(&xmp_path, xmp_skeleton())
            .map_err(|e| format!("Failed to create skeleton XMP: {}", e))?;
        actual_xmp = Some(xmp_path);
    }

    let Some(xmp_file) = actual_xmp else {
        return Ok(());
    };

    let mut content = fs::read_to_string(&xmp_file).map_err(|e| e.to_string())?;
    let rating_str = rating.to_string();
    let re_rating_attr = Regex::new(r#"xmp:Rating\s*=\s*"[^"]*""#).unwrap();
    let re_rating_tag = Regex::new(r#"<xmp:Rating\s*>[^<]*</xmp:Rating>"#).unwrap();

    if re_rating_attr.is_match(&content) {
        content = re_rating_attr
            .replace(&content, format!("xmp:Rating=\"{}\"", rating_str))
            .to_string();
    } else if re_rating_tag.is_match(&content) {
        content = re_rating_tag
            .replace(&content, format!("<xmp:Rating>{}</xmp:Rating>", rating_str))
            .to_string();
    } else if let Some(last_index) = content.rfind("</rdf:Description>") {
        let (start, end) = content.split_at(last_index);
        content = format!("{} <xmp:Rating>{}</xmp:Rating>\n{}", start, rating_str, end);
    }

    let (label, normal_tags) = normalized_xmp_label_and_keywords(tags);

    if let Some(lbl) = label {
        let re_label_attr = Regex::new(r#"xmp:Label\s*=\s*"[^"]*""#).unwrap();
        let re_label_tag = Regex::new(r#"<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();

        if re_label_attr.is_match(&content) {
            content = re_label_attr
                .replace(&content, format!("xmp:Label=\"{}\"", lbl))
                .to_string();
        } else if re_label_tag.is_match(&content) {
            content = re_label_tag
                .replace(&content, format!("<xmp:Label>{}</xmp:Label>", lbl))
                .to_string();
        } else if let Some(last_index) = content.rfind("</rdf:Description>") {
            let (start, end) = content.split_at(last_index);
            content = format!("{} <xmp:Label>{}</xmp:Label>\n{}", start, lbl, end);
        }
    } else {
        let re_label_attr = Regex::new(r#"\s*xmp:Label\s*=\s*"[^"]*""#).unwrap();
        let re_label_tag = Regex::new(r#"\s*<xmp:Label\s*>[^<]*</xmp:Label>"#).unwrap();
        content = re_label_attr.replace_all(&content, "").to_string();
        content = re_label_tag.replace_all(&content, "").to_string();
    }

    let re_subject =
        Regex::new(r#"(?s)<dc:subject>\s*<rdf:Bag>.*?</rdf:Bag>\s*</dc:subject>"#).unwrap();
    if normal_tags.is_empty() {
        content = re_subject.replace_all(&content, "").to_string();
    } else {
        let mut bag = String::from("<dc:subject>\n    <rdf:Bag>\n");
        for tag in normal_tags {
            bag.push_str(&format!("     <rdf:li>{}</rdf:li>\n", tag));
        }
        bag.push_str("    </rdf:Bag>\n   </dc:subject>");

        if re_subject.is_match(&content) {
            content = re_subject.replace(&content, bag).to_string();
        } else if let Some(last_index) = content.rfind("</rdf:Description>") {
            let (start, end) = content.split_at(last_index);
            content = format!("{} {}\n  {}", start, bag, end);
        }
    }

    crate::exif_processing::write_text_file_atomic(&xmp_file, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_source_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        std::env::temp_dir().join(format!("rapidraw-xmp-sidecar-{unique}-{name}.raf"))
    }

    #[test]
    fn parses_xmp_fields_from_elements_and_attributes() {
        let content = r#"<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmp:Rating="4" xmp:Label="Blue">
   <dc:subject><rdf:Bag><rdf:li>alaska</rdf:li><rdf:li>ice &amp; snow</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>"#;

        let fields = parse_xmp_sidecar_fields(content);

        assert_eq!(fields.rating, Some(4));
        assert_eq!(fields.label.as_deref(), Some("Blue"));
        assert_eq!(fields.tags, vec!["alaska", "ice & snow"]);
    }

    #[test]
    fn sync_metadata_to_xmp_sidecar_creates_missing_skeleton() {
        let source_path = temp_source_path("create");
        let xmp_path = source_path.with_extension("xmp");

        sync_metadata_to_xmp_sidecar(&source_path, 3, None, true).expect("sync");

        let content = fs::read_to_string(&xmp_path).expect("xmp");
        let fields = parse_xmp_sidecar_fields(&content);
        assert_eq!(fields.rating, Some(3));

        let _ = fs::remove_file(xmp_path);
    }

    #[test]
    fn sync_metadata_to_xmp_sidecar_round_trips_label_and_keywords() {
        let source_path = temp_source_path("roundtrip");
        let xmp_path = source_path.with_extension("xmp");
        fs::write(&xmp_path, xmp_skeleton()).expect("xmp");
        let tags = vec![
            format!("{COLOR_TAG_PREFIX}green"),
            format!("{USER_TAG_PREFIX}ice"),
            "travel".to_string(),
        ];

        sync_metadata_to_xmp_sidecar(&source_path, 5, Some(&tags), false).expect("sync");

        let content = fs::read_to_string(&xmp_path).expect("xmp");
        let fields = parse_xmp_sidecar_fields(&content);
        assert_eq!(fields.rating, Some(5));
        assert_eq!(fields.label.as_deref(), Some("Green"));
        assert_eq!(fields.tags, vec!["ice", "travel"]);

        let _ = fs::remove_file(xmp_path);
    }
}
