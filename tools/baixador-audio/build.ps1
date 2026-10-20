# Gera o executável portátil (um único .exe, com o FFmpeg embutido) em tools\baixador-audio\dist\
#   powershell -ExecutionPolicy Bypass -File tools\baixador-audio\build.ps1
# Para atualizar o yt-dlp (quando os sites mudam e o download para de funcionar), é só rodar de novo.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$venv = Join-Path $here ".venv"
if (-not (Test-Path $venv)) { python -m venv $venv }
$py = Join-Path $venv "Scripts\python.exe"
& $py -m pip install --upgrade pip | Out-Null
& $py -m pip install --upgrade yt-dlp imageio-ffmpeg pyinstaller
& $py -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name "Baixador de Audio" `
  --collect-data imageio_ffmpeg --collect-binaries imageio_ffmpeg `
  --distpath (Join-Path $here "dist") --workpath (Join-Path $here "build") --specpath (Join-Path $here "build") `
  (Join-Path $here "baixar_audio.py")
Write-Host "Pronto: $(Join-Path $here 'dist\Baixador de Audio.exe')"
