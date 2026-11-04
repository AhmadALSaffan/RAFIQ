"""The Windows launcher for sandboxed commands (core/sandbox.py). Standard library only.

It puts itself in a job object, so the command and everything it starts are one tree that can
be stopped together; in strict mode it also lowers its own integrity level to Low, which every
child inherits: they can then write only to folders labelled Low (the working folder and
Rafiq's sandbox temp), and get no clipboard, no logoff/shutdown, no display or system settings.
Lowering is allowed to any process; raising back is not, so nothing it starts can undo it.

    rafiq-sandbox.exe --job NAME --mode contained|strict (--shell "command line" | -- program args…)

Frozen as its own console executable (rafiq-sandbox.exe, see rafiq-agent.spec) so it starts in
a fraction of a second and hands its pipes straight to the command. In development it runs as
`python sandbox_run.py`.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes as w
import subprocess
import sys

# Job object limits (winnt.h).
JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 0x8
JOB_OBJECT_LIMIT_JOB_MEMORY = 0x200
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000
JobObjectBasicUIRestrictions = 4
JobObjectExtendedLimitInformation = 9
UI_LIMITS = (
    0x2  # read clipboard
    | 0x4  # write clipboard
    | 0x8  # system parameters (SystemParametersInfo)
    | 0x10  # display settings
    | 0x20  # global atoms
    | 0x40  # desktops
    | 0x80  # logoff / shutdown
)
STRICT_MAX_PROCESSES = 512
STRICT_MAX_MEMORY = 8 * 1024**3
LOW_INTEGRITY_SID = "S-1-16-4096"
TokenIntegrityLevel = 25
SE_GROUP_INTEGRITY = 0x20


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [(n, ctypes.c_ulonglong) for n in ("r", "w", "o", "rb", "wb", "ob")]


class BASIC_LIMIT(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", w.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", w.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", w.DWORD),
        ("SchedulingClass", w.DWORD),
    ]


class EXTENDED_LIMIT(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", BASIC_LIMIT),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class SID_AND_ATTRIBUTES(ctypes.Structure):
    _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", w.DWORD)]


def _apis():
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    adv = ctypes.WinDLL("advapi32", use_last_error=True)
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
    k32.CreateJobObjectW.restype = w.HANDLE
    k32.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    k32.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
    k32.GetCurrentProcess.restype = w.HANDLE
    adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, ctypes.POINTER(w.HANDLE)]
    adv.ConvertStringSidToSidW.argtypes = [w.LPCWSTR, ctypes.POINTER(ctypes.c_void_p)]
    adv.GetLengthSid.argtypes = [ctypes.c_void_p]
    adv.SetTokenInformation.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
    return k32, adv


def _fail(what: str) -> None:
    raise OSError(f"sandbox: {what} failed (error {ctypes.get_last_error()})")


def enter_job(name: str, strict: bool) -> None:
    k32, _ = _apis()
    job = k32.CreateJobObjectW(None, name)
    if not job:
        _fail("CreateJobObject")
    if strict:
        limits = EXTENDED_LIMIT()
        limits.BasicLimitInformation.LimitFlags = (
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_JOB_MEMORY
        )
        limits.BasicLimitInformation.ActiveProcessLimit = STRICT_MAX_PROCESSES
        limits.JobMemoryLimit = STRICT_MAX_MEMORY
        if not k32.SetInformationJobObject(job, JobObjectExtendedLimitInformation, ctypes.byref(limits), ctypes.sizeof(limits)):
            _fail("job limits")
        ui = w.DWORD(UI_LIMITS)
        if not k32.SetInformationJobObject(job, JobObjectBasicUIRestrictions, ctypes.byref(ui), ctypes.sizeof(ui)):
            _fail("job UI limits")
    if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
        _fail("AssignProcessToJobObject")
    # The handle stays open for the life of this process: in strict mode closing it (when the
    # command ends) is what takes down anything left running in the background.


def lower_integrity() -> None:
    k32, adv = _apis()
    token = w.HANDLE()
    if not adv.OpenProcessToken(k32.GetCurrentProcess(), 0x80 | 0x8, ctypes.byref(token)):  # ADJUST_DEFAULT | QUERY
        _fail("OpenProcessToken")
    sid = ctypes.c_void_p()
    if not adv.ConvertStringSidToSidW(LOW_INTEGRITY_SID, ctypes.byref(sid)):
        _fail("ConvertStringSidToSid")
    label = SID_AND_ATTRIBUTES(sid, SE_GROUP_INTEGRITY)
    if not adv.SetTokenInformation(token, TokenIntegrityLevel, ctypes.byref(label), ctypes.sizeof(label) + adv.GetLengthSid(sid)):
        _fail("SetTokenInformation")


def parse(argv: list[str]) -> tuple[str, str, str | list[str]]:
    job = mode = ""
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--job":
            job, i = argv[i + 1], i + 2
        elif arg == "--mode":
            mode, i = argv[i + 1], i + 2
        elif arg == "--shell":
            return job, mode, argv[i + 1]
        elif arg == "--":
            return job, mode, argv[i + 1 :]
        else:
            raise SystemExit(f"sandbox: unexpected argument {arg!r}")
    raise SystemExit("sandbox: nothing to run")


def main(argv: list[str]) -> int:
    job, mode, command = parse(argv)
    if mode not in ("contained", "strict") or not job:
        raise SystemExit("sandbox: --job and --mode contained|strict are required")
    strict = mode == "strict"
    try:
        enter_job(job, strict)
        if strict:
            lower_integrity()
    except OSError as e:
        print(str(e), file=sys.stderr)
        return 126  # never run the command unprotected
    # The pipes this launcher was given are its standard handles; the command inherits them.
    return subprocess.call(command, shell=isinstance(command, str))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
