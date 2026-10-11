!macro customWelcomePage
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Form Entry Desktop Setup"
  !define MUI_WELCOMEPAGE_TEXT "Form Entry Desktop reads rows from a Google Sheets tab and submits them to a Google Form.$\r$\n$\r$\nGoogle Chrome must be installed to use this app.$\r$\n$\r$\nClick Next to choose where to install."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInit
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FormEntryDesktop" "UninstallString"
  ${If} $0 != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Please uninstall the previous Squirrel version of Form Entry Desktop from Windows Settings, then run this installer again. Your app settings and history will be kept." /SD IDOK
    Abort
  ${EndIf}
!macroend
