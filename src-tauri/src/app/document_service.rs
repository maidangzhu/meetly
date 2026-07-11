use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

const MAX_PDF_BYTES: usize = 25 * 1024 * 1024;

#[tauri::command]
pub async fn extract_pdf_text(file_name: String, data_base64: String) -> Result<String, String> {
    let stripped = data_base64
        .split_once(',')
        .map(|(_, data)| data)
        .unwrap_or(&data_base64);

    let bytes = BASE64.decode(stripped).map_err(|error| {
        format!("Failed to decode PDF data for {file_name}: {error}")
    })?;

    if bytes.len() > MAX_PDF_BYTES {
        return Err(format!(
            "{file_name} is too large. Current limit is {} MB.",
            MAX_PDF_BYTES / 1024 / 1024
        ));
    }

    let text = tokio::task::spawn_blocking(move || pdf_extract::extract_text_from_mem(&bytes))
        .await
        .map_err(|error| format!("Failed to join PDF extraction task: {error}"))?
        .map_err(|error| format!("Failed to extract text from {file_name}: {error}"))?;

    let normalized = text.replace('\u{0}', "").trim().to_string();
    if normalized.is_empty() {
        return Err(format!(
            "{file_name} has no extractable text. Scanned PDFs need OCR before importing."
        ));
    }

    Ok(normalized)
}
