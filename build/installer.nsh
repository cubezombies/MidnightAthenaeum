; electron-builder's default per-user install dir is
; %LOCALAPPDATA%\Programs\${productName}, which lands on C:. On the primary
; dev machine, everything Tomelight writes (data folder, backups) lives under
; D:\Claude\, so default the suggested install location there too when a D:
; drive is actually present — this installer is now distributed via GitHub
; Releases, so it may run on a machine with no D: drive at all, and falling
; back to the normal default there is safer than pointing at a nonexistent
; path. The user can still pick a different folder either way on the "Choose
; Install Location" page (allowToChangeInstallationDirectory: true); this only
; changes what's pre-filled.
!macro customInit
  IfFileExists "D:\*.*" 0 +2
  StrCpy $INSTDIR "D:\Claude\Tomelight-App"
!macroend
