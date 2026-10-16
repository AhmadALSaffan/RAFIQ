; Before files are replaced: stop an agent left running (it holds its DLLs open, and the
; installer would fail with "can't write"). The app itself is closed by the installer.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM rafiq-agent.exe'
!macroend

; The language picked on the installer's first screen, for the app's first launch: it opens
; in that language instead of Arabic (a language chosen later inside the app wins).
; $LANGUAGE is the Windows language id: 1025 Arabic, 1033 English, 1049 Russian.
!macro NSIS_HOOK_POSTINSTALL
  FileOpen $0 "$INSTDIR\installer-language" w
  FileWrite $0 "$LANGUAGE"
  FileClose $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\installer-language"
!macroend
