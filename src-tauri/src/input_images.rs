use crate::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};

pub fn validate(value: &Value) -> Result<Vec<Value>> {
    if value.is_null() { return Ok(vec![]); }
    let images = value.as_array().filter(|xs| xs.len() <= 4).ok_or("每次最多附加 4 张图片")?;
    for image in images {
        let url = image.as_str().ok_or("图片格式无效")?;
        if url.len() > 7_000_000 { return Err("每张图片不能超过 5 MB".into()); }
        let (header, data) = url.split_once(',').ok_or("图片格式无效")?;
        if !matches!(header, "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64" | "data:image/gif;base64") {
            return Err("仅支持 PNG、JPEG、WebP 和 GIF 图片".into());
        }
        let bytes = STANDARD.decode(data).map_err(|_| "图片编码无效")?;
        if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 { return Err("图片为空或超过 5 MB".into()); }
    }
    Ok(images.clone())
}

pub fn input(prompt: &str, images: &[Value]) -> Vec<Value> {
    let mut input = vec![json!({"type":"text","text":prompt,"text_elements":[]})];
    input.extend(images.iter().map(|url| json!({"type":"image","url":url})));
    input
}

// Older snapshots contain strings; newer entries retain images alongside their text.
pub fn combine(saved: &Value, text: &str, images: Vec<Value>) -> Value {
    let mut texts = vec![];
    let mut combined_images = vec![];
    for entry in saved.as_array().into_iter().flatten() {
        texts.push(entry.as_str().unwrap_or_else(|| crate::text(entry, "text")).to_owned());
        if let Some(images) = entry["images"].as_array() { combined_images.extend(images.clone()); }
    }
    texts.push(text.to_owned());
    combined_images.extend(images);
    json!({"text":texts.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n"),"images":combined_images})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_images_and_preserves_queued_images_with_legacy_text() {
        let image = json!("data:image/png;base64,aW1hZ2U=");
        let images = validate(&json!([image])).unwrap();
        let batch = combine(&json!(["old", {"text":"queued","images":images}]), "new", images.clone());
        assert_eq!(batch["text"], "old\nqueued\nnew");
        let inputs = input("prompt", batch["images"].as_array().unwrap());
        assert_eq!(inputs[0]["text"], "prompt");
        assert_eq!(inputs[1], json!({"type":"image","url":image}));
        assert_eq!(inputs[2], inputs[1]);
        for invalid in [json!(["https://example.test/image.png"]), json!(["data:image/svg+xml;base64,PHN2Zz4="]), json!(["data:image/png;base64,!"]), json!(["data:image/png;base64,"]), json!(vec![image;5])] {
            assert!(validate(&invalid).is_err());
        }
        assert!(validate(&json!([format!("data:image/png;base64,{}", "a".repeat(7_000_000))])).is_err());
        assert!(validate(&Value::Null).unwrap().is_empty());
    }
}
