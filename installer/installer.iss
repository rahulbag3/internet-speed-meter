; Builds the Windows installer for Internet Speed Meter.
; Prerequisite: dotnet publish -c Release -r win-x64 --self-contained true `
;   -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish/portable-win-x64
; Then: ISCC.exe installer\installer.iss

#define AppName "Internet Speed Meter"
#define AppExe "InternetSpeedMeter.exe"

[Setup]
AppId={{8E4C2A71-6C1D-4A3E-9B0F-5D2C7A4E91BF}
AppName={#AppName}
AppVersion=1.0.0
AppPublisher=rahulbag3
AppSupportURL=https://github.com/rahulbag3/internet-speed-meter
DefaultDirName={localappdata}\Programs\Internet Speed Meter
DefaultGroupName=Internet Speed Meter
DisableProgramGroupPage=yes
DisableWelcomePage=no
OutputDir=..\dist
OutputBaseFilename=InternetSpeedMeter-Setup-x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\publish\portable-win-x64\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\publish\portable-win-x64\Assets\*"; DestDir: "{app}\Assets"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\InternetSpeedMeter"
