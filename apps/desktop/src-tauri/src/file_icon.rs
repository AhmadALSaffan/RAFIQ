//! The icon Windows itself shows for a file type, so the @-mention list looks like Explorer.

#[cfg(windows)]
pub fn data_url(file_name: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::ffi::OsStr;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_NORMAL;
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_USEFILEATTRIBUTES,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO};

    unsafe {
        let wide: Vec<u16> = OsStr::new(file_name).encode_wide().chain(std::iter::once(0)).collect();
        let mut info = SHFILEINFOW::default();
        let found = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON | SHGFI_USEFILEATTRIBUTES,
        );
        if found == 0 || info.hIcon.is_invalid() {
            return None;
        }

        let mut icon_info = ICONINFO::default();
        if GetIconInfo(info.hIcon, &mut icon_info).is_err() {
            let _ = DestroyIcon(info.hIcon);
            return None;
        }

        let mut bitmap = BITMAP::default();
        let read = GetObjectW(
            icon_info.hbmColor.into(),
            size_of::<BITMAP>() as i32,
            Some(&mut bitmap as *mut _ as *mut _),
        );
        let (width, height) = (bitmap.bmWidth, bitmap.bmHeight);
        if read == 0 || width <= 0 || height <= 0 {
            let _ = DeleteObject(icon_info.hbmColor.into());
            let _ = DeleteObject(icon_info.hbmMask.into());
            let _ = DestroyIcon(info.hIcon);
            return None;
        }

        let mut header = BITMAPINFO::default();
        header.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height, // negative: top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let dc = CreateCompatibleDC(None);
        let copied = GetDIBits(
            dc,
            icon_info.hbmColor,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut header,
            DIB_RGB_COLORS,
        );
        let _ = DeleteDC(dc);
        let _ = DeleteObject(icon_info.hbmColor.into());
        let _ = DeleteObject(icon_info.hbmMask.into());
        let _ = DestroyIcon(info.hIcon);

        if copied == 0 {
            return None;
        }

        // GDI hands back BGRA; PNG wants RGBA.
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
        }
        if pixels.chunks_exact(4).all(|p| p[3] == 0) {
            for chunk in pixels.chunks_exact_mut(4) {
                chunk[3] = 255;
            }
        }

        let image = image::RgbaImage::from_raw(width as u32, height as u32, pixels)?;
        let mut png = std::io::Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).ok()?;
        Some(format!("data:image/png;base64,{}", STANDARD.encode(png.into_inner())))
    }
}

#[cfg(not(windows))]
pub fn data_url(_file_name: &str) -> Option<String> {
    None
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn returns_a_decodable_png_for_a_known_extension() {
        let url = super::data_url("rafiq.txt").expect("Windows should have a .txt icon");
        let b64 = url.strip_prefix("data:image/png;base64,").expect("data URL prefix");
        let bytes = {
            use base64::{engine::general_purpose::STANDARD, Engine};
            STANDARD.decode(b64).expect("valid base64")
        };
        let image = image::load_from_memory(&bytes).expect("valid PNG");
        assert!(image.width() >= 16 && image.height() >= 16, "icon looks empty: {image:?}");
    }
}
