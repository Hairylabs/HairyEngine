# Compiles a tiny native shim that wraps 7za.exe and always passes -xr!darwin
# on extract commands. This is needed because the winCodeSign archive electron-builder
# downloads contains macOS symlinks that Windows refuses to extract without
# Developer Mode or admin privileges. We renamed the real binary to 7za-real.exe
# and drop this shim in its place so all of electron-builder's 7za calls go through it.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root "node_modules\7zip-bin\win\x64"
$realExe = Join-Path $binDir "7za-real.exe"
$shimExe = Join-Path $binDir "7za.exe"

if (-not (Test-Path $realExe)) {
  if (Test-Path $shimExe) {
    Move-Item $shimExe $realExe
    Write-Host "Renamed 7za.exe -> 7za-real.exe"
  } else {
    throw "Neither 7za.exe nor 7za-real.exe found in $binDir"
  }
}

# If the shim already exists and looks like it points to our 7za-real.exe, leave it.
if (Test-Path $shimExe) {
  Write-Host "7za.exe shim already present, rebuilding to be safe..."
  Remove-Item $shimExe
}

$code = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

class Program {
    static int Main(string[] args) {
        try {
            var dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            var realExe = Path.Combine(dir, "7za-real.exe");
            if (!File.Exists(realExe)) {
                Console.Error.WriteLine("7za shim: cannot find 7za-real.exe in " + dir);
                return 9009;
            }

            var sb = new StringBuilder();
            bool isExtract = args.Length > 0 && (args[0] == "x" || args[0] == "e");
            for (int i = 0; i < args.Length; i++) {
                if (i > 0) sb.Append(" ");
                sb.Append(QuoteArg(args[i]));
            }
            if (isExtract) {
                sb.Append(" -xr!darwin");
            }

            var psi = new ProcessStartInfo();
            psi.FileName = realExe;
            psi.Arguments = sb.ToString();
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = false;
            psi.RedirectStandardError = false;
            psi.CreateNoWindow = false;

            using (var p = Process.Start(psi)) {
                p.WaitForExit();
                return p.ExitCode;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("7za shim error: " + ex.Message);
            return 1;
        }
    }

    static string QuoteArg(string a) {
        if (a.Length == 0) return "\"\"";
        if (a.IndexOf(' ') >= 0 || a.IndexOf('\t') >= 0 || a.IndexOf('"') >= 0) {
            return "\"" + a.Replace("\"", "\\\"") + "\"";
        }
        return a;
    }
}
'@

Add-Type -OutputAssembly $shimExe -OutputType ConsoleApplication -TypeDefinition $code

if (Test-Path $shimExe) {
  Write-Host "Built 7za shim at $shimExe"
} else {
  throw "Shim build did not produce $shimExe"
}
