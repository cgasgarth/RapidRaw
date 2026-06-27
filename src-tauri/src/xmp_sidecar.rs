use quick_xml::{
    Reader, XmlVersion,
    events::{BytesStart, Event},
};

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
