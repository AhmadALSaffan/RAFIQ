!include LogicLib.nsh

; The app's name on its shortcuts follows the installer's language: Windows search and the
; Start menu show the shortcut's file name, so an English or Russian install shouldn't be
; found under the Arabic name. Tauri names every shortcut after productName (the Arabic
; name), so the hooks rename them: $RafiqLnkFrom is the name to rename away from, and
; $RafiqLnkTo the one the user's language wants.
; $RafiqExe is the program they point at (.onGUIEnd is compiled before Tauri's defines).
Var RafiqLnkFrom
Var RafiqLnkTo
Var RafiqExe

; Renames the shortcut in DIR when it points at this install. A shortcut already sitting
; under the wanted name (an earlier install in that language) is ours too, so it goes first.
!macro RAFIQ_RENAME_SHORTCUT DIR
  !insertmacro IsShortcutTarget "${DIR}\$RafiqLnkFrom.lnk" "$RafiqExe"
  Pop $0
  ${If} $0 = 1
    Delete "${DIR}\$RafiqLnkTo.lnk"
    Rename "${DIR}\$RafiqLnkFrom.lnk" "${DIR}\$RafiqLnkTo.lnk"
  ${EndIf}
!macroend

!macro RAFIQ_NAME_SHORTCUTS
  ${If} $RafiqLnkTo != ""
    !insertmacro RAFIQ_RENAME_SHORTCUT "$SMPROGRAMS"
    !insertmacro RAFIQ_RENAME_SHORTCUT "$DESKTOP"
  ${EndIf}
!macroend

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

  StrCpy $RafiqExe "$INSTDIR\${MAINBINARYNAME}.exe"
  ${If} $LANGUAGE = 1025
    StrCpy $RafiqLnkFrom "Rafiq"
    StrCpy $RafiqLnkTo "${PRODUCTNAME}"
  ${Else}
    StrCpy $RafiqLnkFrom "${PRODUCTNAME}"
    StrCpy $RafiqLnkTo "Rafiq"
  ${EndIf}
  ; Apps & features lists the app under the same name.
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "$RafiqLnkTo"
  ; The Start menu shortcut exists by now (and the desktop one, for silent and passive
  ; installs); a desktop shortcut ticked on the finish page is renamed in .onGUIEnd.
  !insertmacro RAFIQ_NAME_SHORTCUTS
!macroend

Function .onGUIEnd
  !insertmacro RAFIQ_NAME_SHORTCUTS
FunctionEnd

; Uninstalling removes the shortcuts under the Arabic name only, so the Latin ones go here
; (not on an update, which keeps the shortcuts).
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro IsShortcutTarget "$SMPROGRAMS\Rafiq.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\Rafiq.lnk"
      Delete "$SMPROGRAMS\Rafiq.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\Rafiq.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\Rafiq.lnk"
      Delete "$DESKTOP\Rafiq.lnk"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$INSTDIR\installer-language"
!macroend
