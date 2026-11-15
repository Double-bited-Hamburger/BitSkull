// BitSkull single-file launcher.
// The whole app (HTML/CSS/JS/assets) is embedded in this .exe as resources named "app/<path>".
// On start it unpacks them to %LOCALAPPDATA%\BitSkull\app (only when the content changed),
// then opens index.html in a chromeless Edge (or Chrome) app window that uses its own
// private profile, so it never shares cookies or sessions with your normal browser.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("BitSkull")]
[assembly: AssemblyProduct("BitSkull")]
[assembly: AssemblyDescription("BitSkull dithering studio")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    const string Prefix = "app/";

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BitSkull");
            string appDir = Path.Combine(root, "app");
            string profileDir = Path.Combine(root, "profile");
            Directory.CreateDirectory(appDir);
            Directory.CreateDirectory(profileDir);

            Unpack(appDir);

            string index = Path.Combine(appDir, "index.html");
            string url = new Uri(index).AbsoluteUri;

            string browser = FindBrowser();
            if (browser == null)
            {
                // No Chromium browser found: open in the default browser instead.
                Process.Start(new ProcessStartInfo(index) { UseShellExecute = true });
                return 0;
            }

            var argList = new List<string> {
                "--app=\"" + url + "\"",
                "--user-data-dir=\"" + profileDir + "\"",
                "--window-size=1500,950",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-sync",
                "--disable-features=Translate,msEdgeSidebarV2,msUndersideButton"
            };
            Process.Start(new ProcessStartInfo(browser, string.Join(" ", argList)) { UseShellExecute = false });
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show("BitSkull could not start:\n\n" + ex.Message, "BitSkull", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Writes the embedded files to disk, but only if they differ from what's already there.
    static void Unpack(string appDir)
    {
        var asm = Assembly.GetExecutingAssembly();
        var names = new List<string>();
        foreach (var n in asm.GetManifestResourceNames())
            if (n.StartsWith(Prefix, StringComparison.Ordinal)) names.Add(n);
        names.Sort(StringComparer.Ordinal);

        var files = new Dictionary<string, byte[]>();
        string stamp;
        using (var sha = SHA1.Create())
        {
            foreach (var n in names)
            {
                byte[] data;
                using (var s = asm.GetManifestResourceStream(n))
                using (var ms = new MemoryStream()) { s.CopyTo(ms); data = ms.ToArray(); }
                files[n] = data;
                byte[] nb = Encoding.UTF8.GetBytes(n);
                sha.TransformBlock(nb, 0, nb.Length, null, 0);
                sha.TransformBlock(data, 0, data.Length, null, 0);
            }
            sha.TransformFinalBlock(new byte[0], 0, 0);
            stamp = BitConverter.ToString(sha.Hash).Replace("-", "");
        }

        string stampFile = Path.Combine(appDir, ".version");
        if (File.Exists(stampFile) && File.ReadAllText(stampFile).Trim() == stamp
            && File.Exists(Path.Combine(appDir, "index.html")))
            return;

        foreach (var kv in files)
        {
            string rel = kv.Key.Substring(Prefix.Length).Replace('/', Path.DirectorySeparatorChar);
            string dest = Path.GetFullPath(Path.Combine(appDir, rel));
            if (!dest.StartsWith(Path.GetFullPath(appDir), StringComparison.OrdinalIgnoreCase)) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest));
            File.WriteAllBytes(dest, kv.Value);
        }
        File.WriteAllText(stampFile, stamp);
    }

    static string FindBrowser()
    {
        var candidates = new List<string>();
        foreach (var exe in new[] { "msedge.exe", "chrome.exe" })
        {
            foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                {
                    var v = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(v)) candidates.Add(v.Trim('"'));
                }
            }
        }
        string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        candidates.Add(Path.Combine(pf86, @"Microsoft\Edge\Application\msedge.exe"));
        candidates.Add(Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe"));
        candidates.Add(Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"));
        candidates.Add(Path.Combine(pf86, @"Google\Chrome\Application\chrome.exe"));
        candidates.Add(Path.Combine(local, @"Google\Chrome\Application\chrome.exe"));
        foreach (var c in candidates)
            if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
        return null;
    }
}
