//! The text selected in the program in front, picked up when the quick-ask shortcut is
//! pressed, so the box opens on it.
//!
//! Windows has no "what's selected" call that every program answers, so this does what the
//! user would do: copy, read, and put the clipboard back the way it was. The copy is sent
//! as Ctrl+Insert — the old copy shortcut that Windows programs, browsers and Office all
//! know — and not Ctrl+C, which in a terminal with nothing selected stops whatever is
//! running there. Nothing selected means nothing changes on the clipboard, and nothing is
//! picked up.

/// The selected text, trimmed and capped. None when nothing is selected, the program
/// doesn't answer a copy, or the program in front is Rafiq itself.
#[cfg(windows)]
pub fn selected_text() -> Option<String> {
    imp::selected_text()
}

#[cfg(not(windows))]
pub fn selected_text() -> Option<String> {
    None
}

#[cfg(windows)]
mod imp {
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
        SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
        KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VIRTUAL_KEY, VK_CONTROL, VK_INSERT, VK_LWIN, VK_MENU, VK_RWIN,
        VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    const CF_UNICODETEXT: u32 = 13;
    /// A clipboard bigger than this (a huge image, say) isn't copied aside: the selection
    /// is left on the clipboard instead of risking a half-restored one.
    const MAX_SNAPSHOT: usize = 64 * 1024 * 1024;
    /// More than this isn't "the selected text", it's a document: the box takes the start.
    const MAX_CHARS: usize = 20_000;
    /// An unassigned key, pressed while Alt is down so letting go of Alt doesn't open the
    /// menu bar of the program in front.
    const VK_NONE: VIRTUAL_KEY = VIRTUAL_KEY(0xE8);

    /// Formats whose data is a GDI handle rather than memory: they can't be copied aside
    /// byte for byte, and Windows rebuilds the common ones from the formats that can.
    fn is_handle_format(format: u32) -> bool {
        matches!(format, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E) || (0x200..=0x3FF).contains(&format)
    }

    /// The clipboard, open for as long as this lives. Another program may hold it for a
    /// moment, so opening is tried a few times.
    struct Open;

    impl Open {
        fn new() -> Option<Self> {
            for _ in 0..10 {
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Some(Open);
                }
                thread::sleep(Duration::from_millis(15));
            }
            None
        }
    }

    impl Drop for Open {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    fn bytes_of(handle: HANDLE) -> Option<Vec<u8>> {
        let memory = HGLOBAL(handle.0);
        let size = unsafe { GlobalSize(memory) };
        if size == 0 {
            return None;
        }
        let ptr = unsafe { GlobalLock(memory) };
        if ptr.is_null() {
            return None;
        }
        let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, size) }.to_vec();
        let _ = unsafe { GlobalUnlock(memory) };
        Some(bytes)
    }

    /// Everything on the clipboard, to put back afterwards. None = it couldn't be copied
    /// aside (too big, or held by another program), and nothing will be put back.
    fn snapshot() -> Option<Vec<(u32, Vec<u8>)>> {
        let _open = Open::new()?;
        let mut saved = Vec::new();
        let mut total = 0usize;
        let mut format = 0u32;
        loop {
            format = unsafe { EnumClipboardFormats(format) };
            if format == 0 {
                break;
            }
            if is_handle_format(format) {
                continue;
            }
            let Ok(handle) = (unsafe { GetClipboardData(format) }) else { continue };
            if let Some(bytes) = bytes_of(handle) {
                total += bytes.len();
                if total > MAX_SNAPSHOT {
                    return None;
                }
                saved.push((format, bytes));
            }
        }
        Some(saved)
    }

    fn restore(saved: &[(u32, Vec<u8>)]) {
        let Some(_open) = Open::new() else { return };
        let _ = unsafe { EmptyClipboard() };
        for (format, bytes) in saved {
            let Ok(memory) = (unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }) else { continue };
            let ptr = unsafe { GlobalLock(memory) };
            if ptr.is_null() {
                let _ = unsafe { GlobalFree(Some(memory)) };
                continue;
            }
            unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len()) };
            let _ = unsafe { GlobalUnlock(memory) };
            // Once it's on the clipboard the clipboard owns it; only a refusal leaves it ours.
            if unsafe { SetClipboardData(*format, Some(HANDLE(memory.0))) }.is_err() {
                let _ = unsafe { GlobalFree(Some(memory)) };
            }
        }
    }

    fn text() -> Option<String> {
        let _open = Open::new()?;
        let handle = unsafe { GetClipboardData(CF_UNICODETEXT) }.ok()?;
        let bytes = bytes_of(handle)?;
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .take_while(|&unit| unit != 0)
            .collect();
        Some(String::from_utf16_lossy(&units))
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        let mut flags = KEYBD_EVENT_FLAGS(0);
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        if vk == VK_INSERT {
            flags |= KEYEVENTF_EXTENDEDKEY; // the Insert key, not the keypad's 0
        }
        let scan = unsafe { MapVirtualKeyW(vk.0 as u32, MAPVK_VK_TO_VSC) } as u16;
        INPUT {
            r#type: INPUT_KEYBOARD,
            // The scan code too: some programs read that rather than the virtual key.
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        }
    }

    fn send(keys: &[INPUT]) {
        unsafe { SendInput(keys, std::mem::size_of::<INPUT>() as i32) };
    }

    fn held(vk: VIRTUAL_KEY) -> bool {
        (unsafe { GetAsyncKeyState(vk.0 as i32) } as u16) & 0x8000 != 0
    }

    /// The shortcut's own Shift, Alt or Win would turn the copy into a different shortcut.
    /// Give the user a moment to let go of them; whatever is still down after that is
    /// released for them.
    fn let_go_of_modifiers() {
        let modifiers = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];
        if held(VK_MENU) {
            send(&[key(VK_NONE, false), key(VK_NONE, true)]);
        }
        let start = Instant::now();
        while modifiers.iter().any(|&m| held(m)) && start.elapsed() < Duration::from_millis(600) {
            thread::sleep(Duration::from_millis(10));
        }
        let still: Vec<INPUT> = modifiers.iter().filter(|&&m| held(m)).map(|&m| key(m, true)).collect();
        if !still.is_empty() {
            send(&still);
        }
    }

    pub fn selected_text() -> Option<String> {
        let front = unsafe { GetForegroundWindow() };
        if front.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(front, Some(&mut pid)) };
        if pid == std::process::id() {
            return None;
        }
        let_go_of_modifiers();
        let saved = snapshot();
        let before = unsafe { GetClipboardSequenceNumber() };
        if held(VK_CONTROL) {
            send(&[key(VK_INSERT, false), key(VK_INSERT, true)]);
        } else {
            send(&[key(VK_CONTROL, false), key(VK_INSERT, false), key(VK_INSERT, true), key(VK_CONTROL, true)]);
        }
        let start = Instant::now();
        while unsafe { GetClipboardSequenceNumber() } == before {
            if start.elapsed() > Duration::from_millis(350) {
                return None; // nothing selected: the clipboard was never touched
            }
            thread::sleep(Duration::from_millis(10));
        }
        // The program may still be adding its other formats (HTML, RTF) after the text.
        thread::sleep(Duration::from_millis(40));
        let copied = text();
        if let Some(saved) = saved {
            restore(&saved);
        }
        let copied = copied?;
        let trimmed = copied.trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(trimmed.chars().take(MAX_CHARS).collect())
    }
}
