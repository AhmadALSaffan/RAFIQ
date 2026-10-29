//! A picture of the screen the mouse is on, for "ask about my screen": taken before any
//! Rafiq window comes up, so it shows exactly what the user was looking at.

/// The screen's picture (PNG) and where that screen sits on the desktop, in physical pixels.
pub struct Shot {
    pub png: Vec<u8>,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[cfg(windows)]
pub fn capture() -> Option<Shot> {
    use std::mem::size_of;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        CAPTUREBLT, DIB_RGB_COLORS, MONITORINFO, MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    unsafe {
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).ok()?;
        let monitor = MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return None;
        }
        let area = info.rcMonitor;
        let (width, height) = (area.right - area.left, area.bottom - area.top);
        if width <= 0 || height <= 0 {
            return None;
        }

        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, width, height, Some(screen), area.left, area.top, SRCCOPY | CAPTUREBLT).is_ok();

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
        let rows = if copied {
            GetDIBits(memory, bitmap, 0, height as u32, Some(pixels.as_mut_ptr() as *mut _), &mut header, DIB_RGB_COLORS)
        } else {
            0
        };
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        if rows == 0 {
            return None;
        }

        // GDI hands back BGRA with no alpha; PNG wants RGBA.
        for chunk in pixels.chunks_exact_mut(4) {
            chunk.swap(0, 2);
            chunk[3] = 255;
        }
        Some(Shot { png: encode(width as u32, height as u32, pixels)?, x: area.left, y: area.top, width: width as u32, height: height as u32 })
    }
}

#[cfg(not(windows))]
pub fn capture() -> Option<Shot> {
    None
}

/// Fast PNG: a 4K screen in a fraction of a second; the page crops it and sends the part.
fn encode(width: u32, height: u32, rgba: Vec<u8>) -> Option<Vec<u8>> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;

    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Sub)
        .write_image(&rgba, width, height, image::ExtendedColorType::Rgba8)
        .ok()?;
    Some(out)
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn encodes_a_png_that_reads_back() {
        let png = super::encode(4, 2, vec![200; 4 * 2 * 4]).expect("encoded");
        let image = image::load_from_memory(&png).expect("valid PNG");
        assert_eq!((image.width(), image.height()), (4, 2));
    }
}
