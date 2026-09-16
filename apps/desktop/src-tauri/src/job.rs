//! Ties the agent's life to the app's.
//!
//! The agent runs as a child process (and starts its own: the browser, MCP servers). If the
//! app is killed — the installer closing it, Task Manager, a crash — a plain child would
//! keep running and hold files open. Putting it in a Job Object with "kill on close" makes
//! Windows end the whole tree the moment the app's handle to the job goes away.

#[cfg(windows)]
pub struct Job(windows::Win32::Foundation::HANDLE);

// The handle is only used to assign processes and is never closed until the app exits.
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    pub fn kill_on_close() -> Option<Job> {
        use windows::core::PCWSTR;
        use windows::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(Job(handle))
        }
    }

    pub fn adopt(&self, child: &std::process::Child) -> bool {
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;
        unsafe { AssignProcessToJobObject(self.0, HANDLE(child.as_raw_handle() as _)).is_ok() }
    }
}

#[cfg(not(windows))]
pub struct Job;

#[cfg(not(windows))]
impl Job {
    pub fn kill_on_close() -> Option<Job> {
        None
    }
    pub fn adopt(&self, _child: &std::process::Child) -> bool {
        false
    }
}
