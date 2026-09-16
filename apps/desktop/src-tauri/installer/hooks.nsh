; Before files are replaced: stop an agent left running (it holds its DLLs open, and the
; installer would fail with "can't write"). The app itself is closed by the installer.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM rafiq-agent.exe'
!macroend
