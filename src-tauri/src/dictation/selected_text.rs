const MAX_SELECTED_TEXT_CHARS: usize = 12_000;

#[cfg(target_os = "macos")]
pub fn capture(pid: i32) -> Option<String> {
    capture_macos(pid).ok().flatten()
}

#[cfg(target_os = "macos")]
fn capture_macos(pid: i32) -> Result<Option<String>, String> {
    use accessibility::{AXAttribute, AXUIElement};
    use core_foundation::{base::CFType, string::CFString};

    if !handy_keys::check_accessibility() {
        return Ok(None);
    }

    let application = AXUIElement::application(pid);
    application
        .set_messaging_timeout(0.25)
        .map_err(|error| error.to_string())?;

    let focused_attribute = AXAttribute::new(&CFString::from_static_string("AXFocusedUIElement"));
    let focused_value: CFType = application
        .attribute(&focused_attribute)
        .map_err(|error| error.to_string())?;
    let focused = focused_value
        .downcast::<AXUIElement>()
        .ok_or_else(|| "Focused accessibility element was not an AXUIElement.".to_string())?;

    if let Some(selected) =
        string_attribute(&focused, "AXSelectedText").and_then(|text| normalize(&text))
    {
        return Ok(Some(selected));
    }

    let range_attribute = AXAttribute::new(&CFString::from_static_string("AXSelectedTextRange"));
    let range_value: CFType = match focused.attribute(&range_attribute) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };
    let Some((location, length)) = ax_range(&range_value) else {
        return Ok(None);
    };
    if length == 0 {
        return Ok(None);
    }

    if let Some(selected) =
        string_for_range(&focused, &range_value).and_then(|text| normalize(&text))
    {
        return Ok(Some(selected));
    }

    let selected = string_attribute(&focused, "AXValue")
        .and_then(|value| slice_utf16_range(&value, location, length));

    Ok(selected)
}

#[cfg(target_os = "macos")]
fn string_attribute(element: &accessibility::AXUIElement, name: &str) -> Option<String> {
    use accessibility::AXAttribute;
    use core_foundation::{base::CFType, string::CFString};

    let attribute = AXAttribute::new(&CFString::new(name));
    let value: CFType = element.attribute(&attribute).ok()?;
    value.downcast::<CFString>().map(|value| value.to_string())
}

#[cfg(target_os = "macos")]
fn ax_range(value: &core_foundation::base::CFType) -> Option<(usize, usize)> {
    use accessibility_sys::{
        kAXValueTypeCFRange, AXValueGetType, AXValueGetTypeID, AXValueGetValue, AXValueRef,
    };
    use core_foundation::base::{CFRange, TCFType};

    if value.type_of() != unsafe { AXValueGetTypeID() } {
        return None;
    }

    let value_ref = value.as_CFTypeRef() as AXValueRef;
    if unsafe { AXValueGetType(value_ref) } != kAXValueTypeCFRange {
        return None;
    }

    let mut range = CFRange::init(0, 0);
    if !unsafe {
        AXValueGetValue(
            value_ref,
            kAXValueTypeCFRange,
            &mut range as *mut CFRange as *mut std::ffi::c_void,
        )
    } || range.location < 0
        || range.length < 0
    {
        return None;
    }

    Some((range.location as usize, range.length as usize))
}

#[cfg(target_os = "macos")]
fn string_for_range(
    element: &accessibility::AXUIElement,
    range_value: &core_foundation::base::CFType,
) -> Option<String> {
    use accessibility_sys::{kAXErrorSuccess, AXUIElementCopyParameterizedAttributeValue};
    use core_foundation::{
        base::{CFType, CFTypeRef, TCFType},
        string::CFString,
    };

    let attribute = CFString::from_static_string("AXStringForRange");
    let mut result: CFTypeRef = std::ptr::null();
    let error = unsafe {
        AXUIElementCopyParameterizedAttributeValue(
            element.as_concrete_TypeRef(),
            attribute.as_concrete_TypeRef(),
            range_value.as_CFTypeRef(),
            &mut result,
        )
    };
    if error != kAXErrorSuccess || result.is_null() {
        return None;
    }

    let result = unsafe { CFType::wrap_under_create_rule(result) };
    result.downcast::<CFString>().map(|value| value.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn capture(_pid: i32) -> Option<String> {
    None
}

fn normalize(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_SELECTED_TEXT_CHARS).collect())
}

fn slice_utf16_range(text: &str, location: usize, length: usize) -> Option<String> {
    if length == 0 {
        return None;
    }

    let end = location.checked_add(length)?;
    let utf16: Vec<u16> = text.encode_utf16().collect();
    let selected = utf16.get(location..end)?;
    String::from_utf16(selected)
        .ok()
        .and_then(|value| normalize(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_empty_selection() {
        assert_eq!(normalize(" \n\t "), None);
    }

    #[test]
    fn trims_and_limits_selection() {
        assert_eq!(
            normalize("  selected text \n"),
            Some("selected text".to_string())
        );
        let oversized = "a".repeat(MAX_SELECTED_TEXT_CHARS + 20);
        assert_eq!(
            normalize(&oversized).map(|value| value.chars().count()),
            Some(MAX_SELECTED_TEXT_CHARS)
        );
    }

    #[test]
    fn ignores_zero_length_range() {
        assert_eq!(slice_utf16_range("selected text", 4, 0), None);
    }

    #[test]
    fn extracts_ascii_range() {
        assert_eq!(
            slice_utf16_range("translate this text", 10, 4),
            Some("this".to_string())
        );
    }

    #[test]
    fn extracts_cjk_and_emoji_using_utf16_offsets() {
        assert_eq!(
            slice_utf16_range("A\u{1F600}\u{4E2D}\u{6587}B", 1, 4),
            Some("\u{1F600}\u{4E2D}\u{6587}".to_string())
        );
        assert_eq!(slice_utf16_range("A\u{1F600}B", 2, 1), None);
    }

    #[test]
    fn rejects_out_of_bounds_range() {
        assert_eq!(slice_utf16_range("short", 4, 10), None);
        assert_eq!(slice_utf16_range("short", usize::MAX, 2), None);
    }
}
