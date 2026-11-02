use super::{connection_error, Api};
use crate::Result;
use base64::{engine::general_purpose::STANDARD, Engine};
use url::Url;

const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

fn image_url(base: &str, source: &str) -> Result<Url> {
    let base = Url::parse(&format!("{}/", super::base_url(base)?)).map_err(|_| "禅道地址无效")?;
    let mut url = base.join(source).map_err(|_| "图片地址无效")?;
    if !matches!(url.scheme(), "http" | "https") || url.origin() != base.origin() || !url.username().is_empty() || url.password().is_some() {
        return Err("图片地址不属于当前禅道服务".into());
    }
    url.set_fragment(None);
    Ok(url)
}

fn file_id(url: &Url) -> Option<u64> {
    if let Some(name) = url.path_segments()?.next_back()?.strip_prefix("file-read-") {
        let digits: String = name.chars().take_while(char::is_ascii_digit).collect();
        return digits.parse().ok().filter(|id| *id > 0);
    }
    let query: std::collections::HashMap<_, _> = url.query_pairs().collect();
    if query.get("m").is_some_and(|s| s == "file") && query.get("f").is_some_and(|s| s == "read") {
        return query.get("fileID").or_else(|| query.get("fileId"))?.parse().ok().filter(|id| *id > 0);
    }
    None
}

fn data_url(bytes: &[u8]) -> Result<String> {
    if bytes.len() > MAX_IMAGE_BYTES { return Err("图片超过 10 MB，无法预览".into()); }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if bytes.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") { "image/gif" }
        else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") { "image/webp" }
        else { return Err("服务器未返回可显示的图片，可能需要重新登录禅道".into()); };
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

impl Api {
    async fn image_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let mut response = self.client.get(url).header(&self.header, &self.secret).send().await.map_err(connection_error)?;
        if !response.status().is_success() { return Err(format!("图片请求失败 HTTP {}", response.status())); }
        if response.content_length().is_some_and(|n| n > MAX_IMAGE_BYTES as u64) { return Err("图片超过 10 MB，无法预览".into()); }
        let mut bytes = vec![];
        while let Some(chunk) = response.chunk().await.map_err(connection_error)? {
            if bytes.len() + chunk.len() > MAX_IMAGE_BYTES { return Err("图片超过 10 MB，无法预览".into()); }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    pub async fn image(&self, base: &str, source: &str) -> Result<String> {
        if source.starts_with("data:") {
            crate::input_images::validate(&serde_json::json!([source]))?;
            return data_url(&STANDARD.decode(source.split_once(',').unwrap().1).map_err(|_| "图片编码无效")?);
        }
        let url = image_url(base, source)?;
        match self.image_bytes(url.as_str()).await.and_then(|bytes| data_url(&bytes)) {
            Ok(image) => Ok(image),
            Err(error) => {
                // Web routes may require a browser session; the file API accepts the saved API token.
                if let Some(id) = file_id(&url) {
                    return self.image_bytes(&format!("{}/files/{id}", self.base)).await.and_then(|bytes| data_url(&bytes));
                }
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_zentao_subpaths_and_rejects_external_credentials_and_non_images() {
        let base = "https://zentao.test/zentao";
        assert_eq!(image_url(base, "file-read-123.png").unwrap().as_str(), "https://zentao.test/zentao/file-read-123.png");
        assert_eq!(file_id(&image_url(base, "/file-read-123.png").unwrap()), Some(123));
        assert_eq!(file_id(&image_url(base, "index.php?m=file&f=read&fileID=456").unwrap()), Some(456));
        for source in ["https://elsewhere.test/file.png", "//elsewhere.test/file.png", "http://zentao.test/image.png", "https://user:pass@zentao.test/a.png", "file:///secret", "javascript:alert(1)"] {
            assert!(image_url(base, source).is_err());
        }
        for bytes in [b"<html>login</html>".as_slice(), b"<svg/>".as_slice(), b"{}".as_slice()] { assert!(data_url(bytes).is_err()); }
        assert!(data_url(b"\x89PNG\r\n\x1a\nfixture").unwrap().starts_with("data:image/png;base64,"));
        assert!(data_url(&vec![0;MAX_IMAGE_BYTES+1]).is_err());
    }
}
