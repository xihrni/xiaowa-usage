Unicode true
!define APP_NAME "WorkBuddy 小哇助手"
!define APP_EXE "WorkBuddyPet.exe"
!define APP_VERSION "0.1.0"
!define APP_VERSION4 "0.1.0.0"
!define APP_PUBLISHER "WorkBuddyPet Contributors"
!define APP_COPYRIGHT "Copyright © 2026 WorkBuddyPet Contributors"
!define APP_HOMEPAGE "https://xiaowa.xihrni.com"
!define APP_ID "WorkBuddyPet"

Name "${APP_NAME}"
OutFile "${PROJECT_ROOT}\release-builder\WorkBuddyPet-Setup-${APP_VERSION}.exe"
Icon "${PROJECT_ROOT}\assets\icon.ico"
UninstallIcon "${PROJECT_ROOT}\assets\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\WorkBuddyPet"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${APP_VERSION4}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "FileDescription" "WorkBuddy 本地用量统计桌面宠物"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "${APP_COPYRIGHT}"
VIAddVersionKey "Comments" "${APP_HOMEPAGE}"

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${PROJECT_ROOT}\release\WorkBuddyPet\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\WorkBuddyPet"
  CreateShortcut "$SMPROGRAMS\WorkBuddyPet\WorkBuddy 小哇助手.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\WorkBuddyPet\卸载小哇助手.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\WorkBuddy 小哇助手.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "URLInfoAbout" "${APP_HOMEPAGE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\WorkBuddy 小哇助手.lnk"
  Delete "$SMPROGRAMS\WorkBuddyPet\WorkBuddy 小哇助手.lnk"
  Delete "$SMPROGRAMS\WorkBuddyPet\卸载小哇助手.lnk"
  RMDir "$SMPROGRAMS\WorkBuddyPet"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
  DeleteRegKey HKCU "Software\${APP_ID}"
  RMDir /r "$INSTDIR"
SectionEnd
