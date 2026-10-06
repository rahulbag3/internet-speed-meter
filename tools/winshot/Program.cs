using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

// winshot --title "Internet Speed Meter" --out verify/app [--pid 1234] [--stack]
// Reports the true physical geometry + DPI awareness of a top-level window and writes
// full.png (whole window) and client.png (client area only).

static class P
{
    const uint GW_OWNER = 4;
    const int SW_RESTORE = 9;
    static readonly IntPtr HWND_TOPMOST = new(-1);
    static readonly IntPtr HWND_NOTOPMOST = new(-2);
    const uint SWP_NOMOVE = 0x2, SWP_NOSIZE = 0x1, SWP_NOACTIVATE = 0x10;
    const uint PW_RENDERFULLCONTENT = 0x2;
    const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    const int PROCESS_DPI_UNAWARE = 0;
    const int PROCESS_SYSTEM_DPI_AWARE = 1;
    const int PROCESS_PER_MONITOR_DPI_AWARE = 2;
    const int PROCESS_PER_MONITOR_DPI_AWARE_V2 = 4;

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    const uint GA_ROOT = 2;
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
    [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);
    static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE = new(-1);
    static readonly IntPtr DPI_AWARENESS_CONTEXT_SYSTEM_AWARE = new(-2);
    static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE = new(-3);
    static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);
    static readonly IntPtr DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED = new(-5);

    static string WindowAwareness(IntPtr h)
    {
        IntPtr ctx = GetWindowDpiAwarenessContext(h);
        if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_UNAWARE)) return "unaware";
        if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_SYSTEM_AWARE)) return "system-aware";
        if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE)) return "per-monitor-aware";
        if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return "per-monitor-v2";
        if (AreDpiAwarenessContextsEqual(ctx, DPI_AWARENESS_CONTEXT_UNAWARE_GDISCALED)) return "unaware-gdiscaled";
        return "unknown";
    }

    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("shcore.dll")] static extern int GetProcessDpiAwareness(IntPtr token, out int a);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT val, int size);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("gdi32.dll")] static extern int GetPixel(IntPtr dc, int x, int y);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dc, int x, int y, int w, int h, IntPtr src, int sx, int sy, int op);

    const int SRCCOPY = 0x00CC0020;

    static IntPtr Find(string title, uint wantPid)
    {
        IntPtr best = IntPtr.Zero;
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString() != title) return true;
            GetWindowThreadProcessId(h, out uint pid);
            if (wantPid != 0 && pid != wantPid) return true;
            best = h;
            return false;
        }, IntPtr.Zero);
        return best;
    }

    static void ListAll(string title)
    {
        EnumWindows((h, _) =>
        {
            if (!IsWindowVisible(h) || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString() != title) return true;
            GetWindowThreadProcessId(h, out uint p);
            GetWindowRect(h, out RECT r);
            string proc;
            try { proc = System.Diagnostics.Process.GetProcessById((int)p).ProcessName; }
            catch { proc = "?"; }
            Console.WriteLine($"hwnd={h.ToInt64():x} pid={p} proc={proc} rect={r.Right - r.Left}x{r.Bottom - r.Top}");
            return true;
        }, IntPtr.Zero);
    }

    static string AwarenessName(IntPtr token)
    {
        if (GetProcessDpiAwareness(token, out int a) != 0) return "unknown";
        return a switch
        {
            PROCESS_DPI_UNAWARE => "unaware",
            PROCESS_SYSTEM_DPI_AWARE => "system-aware",
            PROCESS_PER_MONITOR_DPI_AWARE => "per-monitor-aware",
            PROCESS_PER_MONITOR_DPI_AWARE_V2 => "per-monitor-v2",
            _ => a.ToString(),
        };
    }

    /// <summary>Per-pixel comparison of two PNGs; writes a heatmap of the differences.</summary>
    static int Diff(string a, string b, string? heat)
    {
        using var ba = new Bitmap(a);
        using var bb = new Bitmap(b);
        Console.WriteLine($"{Path.GetFileName(a)} {ba.Width}x{ba.Height}  vs  {Path.GetFileName(b)} {bb.Width}x{bb.Height}");
        if (ba.Width != bb.Width || ba.Height != bb.Height)
        {
            Console.WriteLine("RESULT: size mismatch");
            return 1;
        }

        var rect = new Rectangle(0, 0, ba.Width, ba.Height);
        using var ca = ba.Clone(rect, PixelFormat.Format32bppArgb);
        using var cb = bb.Clone(rect, PixelFormat.Format32bppArgb);
        var d = new Bitmap(ba.Width, ba.Height, PixelFormat.Format32bppArgb);

        BitmapData da = ca.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData db = cb.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData dd = d.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        int bytes = da.Stride * da.Height;
        var bufA = new byte[bytes]; var bufB = new byte[bytes];
        Marshal.Copy(da.Scan0, bufA, 0, bytes);
        Marshal.Copy(db.Scan0, bufB, 0, bytes);

        long sum = 0; int diffPix = 0, maxDelta = 0;
        int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
        var outBuf = new byte[dd.Stride * dd.Height];

        for (int y = 0; y < ca.Height; y++)
        {
            for (int x = 0, row = y * da.Stride, orow = y * dd.Stride; x < ca.Width; x++, row += 4, orow += 4)
            {
                int dr = Math.Abs(bufA[row + 2] - bufB[row + 2]);
                int dg = Math.Abs(bufA[row + 1] - bufB[row + 1]);
                int db2 = Math.Abs(bufA[row + 0] - bufB[row + 0]);
                int m = Math.Max(dr, Math.Max(dg, db2));
                if (m > 0)
                {
                    diffPix++; sum += m; if (m > maxDelta) maxDelta = m;
                    if (x < minX) minX = x; if (y < minY) minY = y;
                    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
                    outBuf[orow] = 0; outBuf[orow + 1] = 0; outBuf[orow + 2] = 255; outBuf[orow + 3] = 255;
                }
                else
                {
                    int g = bufA[row + 1] / 2;
                    outBuf[orow] = (byte)g; outBuf[orow + 1] = (byte)g; outBuf[orow + 2] = (byte)g; outBuf[orow + 3] = 255;
                }
            }
        }
        Marshal.Copy(outBuf, 0, dd.Scan0, outBuf.Length);
        ca.UnlockBits(da); cb.UnlockBits(db); d.UnlockBits(dd);
        if (heat != null) d.Save(heat, ImageFormat.Png);

        long total = (long)ca.Width * ca.Height;
        Console.WriteLine($"differing pixels: {diffPix}/{total} ({100.0 * diffPix / total:0.####}%)");
        Console.WriteLine($"max channel delta: {maxDelta}/255   mean delta over diffs: {(diffPix == 0 ? 0 : (double)sum / diffPix):0.###}");
        if (diffPix > 0) Console.WriteLine($"diff bounding box: {maxX - minX + 1}x{maxY - minY + 1} at ({minX},{minY})");
        Console.WriteLine(diffPix == 0 ? "RESULT: pixel-identical" : "RESULT: differences found");
        return 0;
    }

    /// <summary>Print ARGB of the corners — alpha 0 there means the window really is transparent.</summary>
    static void Probe(string file)
    {
        using var bmp = new Bitmap(file);
        var pts = new (string, Point)[]
        {
            ("top-left", new Point(0, 0)),
            ("top-right", new Point(bmp.Width - 1, 0)),
            ("bottom-left", new Point(0, bmp.Height - 1)),
            ("bottom-right", new Point(bmp.Width - 1, bmp.Height - 1)),
            ("mid-left", new Point(0, bmp.Height / 2)),
            ("card-centre", new Point(bmp.Width / 2, bmp.Height / 2)),
        };
        Console.WriteLine($"{Path.GetFileName(file)} {bmp.Width}x{bmp.Height} pixelFormat={bmp.PixelFormat}");
        foreach (var (name, p) in pts)
        {
            Color c = bmp.GetPixel(p.X, p.Y);
            Console.WriteLine($"  {name,-12} ({p.X},{p.Y}) A={c.A,3} R={c.R,3} G={c.G,3} B={c.B,3}");
        }
    }

    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] p, int cbSize);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    const uint INPUT_MOUSE = 0;
    const uint MOUSEEVENTF_MOVE = 0x1, MOUSEEVENTF_LEFTDOWN = 0x2, MOUSEEVENTF_LEFTUP = 0x4,
               MOUSEEVENTF_ABSOLUTE = 0x8000, MOUSEEVENTF_VIRTUALDESK = 0x4000;

    /// <summary>Absolute (0..65535 virtual-desktop) coordinate input, so drags are not DPI-virtualised.</summary>
    static void SendMouse(uint flags, int sx, int sy)
    {
        var vw = SystemInformation.VirtualScreen;
        int ax = (int)((sx - vw.Left) / (double)(vw.Width - 1) * 65535);
        int ay = (int)((sy - vw.Top) / (double)(vw.Height - 1) * 65535);
        var input = new INPUT { type = INPUT_MOUSE, mi = new MOUSEINPUT { dx = ax, dy = ay, dwFlags = flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK } };
        SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());
    }

    /// <summary>Press-and-drag from a screen point, to prove a frameless window can be moved.</summary>
    static void Drag(int sx, int sy, int dx, int dy)
    {
        SetCursorPos(sx, sy);
        Thread.Sleep(200);
        SendMouse(MOUSEEVENTF_MOVE, sx, sy);
        SendMouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_LEFTDOWN, sx, sy);
        Thread.Sleep(150);
        const int steps = 20;
        for (int i = 1; i <= steps; i++)
        {
            SendMouse(MOUSEEVENTF_MOVE, sx + dx * i / steps, sy + dy * i / steps);
            Thread.Sleep(16);
        }
        Thread.Sleep(150);
        SendMouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_LEFTUP, sx + dx, sy + dy);
        Console.WriteLine($"dragged ({sx},{sy}) by ({dx},{dy})");
    }

    static void Hit(int x, int y)
    {
        IntPtr h = WindowFromPoint(new POINT { X = x, Y = y });
        if (h == IntPtr.Zero) { Console.WriteLine($"({x},{y}) -> none"); return; }
        IntPtr root = GetAncestor(h, GA_ROOT);
        if (root != IntPtr.Zero) h = root;
        GetWindowThreadProcessId(h, out uint p);
        var sb = new StringBuilder(256);
        GetWindowText(h, sb, sb.Capacity);
        string proc;
        try { proc = System.Diagnostics.Process.GetProcessById((int)p).ProcessName; } catch { proc = "?"; }
        Console.WriteLine($"({x},{y}) -> hwnd={h.ToInt64():x} pid={p} proc={proc} title=\"{sb}\"");
    }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool SwitchToThisWindow(IntPtr h, bool alternate);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);

    /// <summary>
    /// Windows refuses SetForegroundWindow from a background process, so press Alt first to
    /// satisfy the input-simulation allowance; without this the probe drives the wrong window.
    /// </summary>
    static bool Raise(IntPtr hwnd)
    {
        ShowWindow(hwnd, SW_RESTORE);
        keybd_event(0x12, 0, 0, IntPtr.Zero);
        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);
        SwitchToThisWindow(hwnd, true);
        keybd_event(0x12, 0, 0x0002, IntPtr.Zero);
        Thread.Sleep(600);
        return GetForegroundWindow() == hwnd;
    }

    /// <summary>Raise the window, hit-test padding vs card, then drag it and report the move.</summary>
    static void Interact(IntPtr hwnd, int dx, int dy)
    {
        // The IDE this probe is launched from sits above the target in Z-order, so the test
        // has to lift it or SendInput/WindowFromPoint would drive the wrong window.
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        bool raised = Raise(hwnd);
        GetWindowRect(hwnd, out RECT before);
        Console.WriteLine($"raised={raised} foreground={(GetForegroundWindow() == hwnd ? "self" : "other")}");
        Console.WriteLine($"before: ({before.Left},{before.Top}) {before.Right - before.Left}x{before.Bottom - before.Top}");

        Hit(before.Left + 8, before.Top + 8);                       // transparent padding
        Hit(before.Left + 540, before.Top + 419);                   // middle of the card
        Drag(before.Left + 540, before.Top + 419, dx, dy);

        Thread.Sleep(600);
        GetWindowRect(hwnd, out RECT after);
        Console.WriteLine($"after : ({after.Left},{after.Top})  moved ({after.Left - before.Left},{after.Top - before.Top}) expected ({dx},{dy})");
        SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    static void Main(string[] args)
    {
        int insetIdx = Array.IndexOf(args, "--insetcrop");
        if (insetIdx >= 0)
        {
            using var src = new Bitmap(args[insetIdx + 1]);
            int n = int.Parse(args[insetIdx + 2]);
            var area = new Rectangle(n, n, src.Width - 2 * n, src.Height - 2 * n);
            using var cut = src.Clone(area, PixelFormat.Format32bppArgb);
            string dest = Path.Combine(Path.GetDirectoryName(args[insetIdx + 1]) ?? ".",
                Path.GetFileNameWithoutExtension(args[insetIdx + 1]) + $".inset{n}.png");
            cut.Save(dest, ImageFormat.Png);
            Console.WriteLine($"{Path.GetFileName(args[insetIdx + 1])} inset{n} -> {Path.GetFileName(dest)} {cut.Width}x{cut.Height}");
            return;
        }

        int hitIdx = Array.IndexOf(args, "--hit");
        if (hitIdx >= 0) { var n = args[hitIdx + 1].Split(',').Select(int.Parse).ToArray(); Hit(n[0], n[1]); return; }
        int dragIdx = Array.IndexOf(args, "--drag");
        if (dragIdx >= 0)
        {
            var n = args[dragIdx + 1].Split(',').Select(int.Parse).ToArray();
            Drag(n[0], n[1], n[2], n[3]);
            Thread.Sleep(400);
            return;
        }

        int interactIdx = Array.IndexOf(args, "--interact");
        if (interactIdx >= 0)
        {
            string t = "Internet Speed Meter";
            uint onlyPid = 0;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--title") t = args[++i];
                else if (args[i] == "--pid") onlyPid = uint.Parse(args[++i]);
            }
            IntPtr h = Find(t, onlyPid);
            if (h == IntPtr.Zero) { Console.WriteLine("NOT_FOUND " + t); Environment.ExitCode = 2; return; }
            var d = args[interactIdx + 1].Split(',').Select(int.Parse).ToArray();
            Interact(h, d[0], d[1]);
            return;
        }

        int clickIdx = Array.IndexOf(args, "--clickat");
        if (clickIdx >= 0)
        {
            string t = "Internet Speed Meter";
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--title") t = args[++i];
            IntPtr h = Find(t, 0);
            if (h == IntPtr.Zero) { Console.WriteLine("NOT_FOUND " + t); Environment.ExitCode = 2; return; }
            var n = args[clickIdx + 1].Split(',').Select(int.Parse).ToArray();
            SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            Raise(h);
            GetWindowRect(h, out RECT clickRect);
            int px = clickRect.Left + n[0], py = clickRect.Top + n[1];
            Console.WriteLine($"clicking ({px},{py}) = window origin + ({n[0]},{n[1]})");
            // Read the composited pixel first: if this is the target's own colour then the
            // window really is on top, and a WindowFromPoint mismatch means hit-testing is dead.
            IntPtr sdc = GetDC(IntPtr.Zero);
            Console.WriteLine($"  pixel there = 0x{(GetPixel(sdc, px, py) & 0xFFFFFF):x6}");
            ReleaseDC(IntPtr.Zero, sdc);
            Hit(px, py);
            Drag(px, py, 0, 0);
            Thread.Sleep(300);
            SetWindowPos(h, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            return;
        }

        int probeIdx = Array.IndexOf(args, "--probe");
        if (probeIdx >= 0 && probeIdx + 1 < args.Length) { Probe(args[probeIdx + 1]); return; }

        for (int i = 0; i < args.Length - 2; i++)
            if (args[i] == "--diff")
            {
                Environment.ExitCode = Diff(args[i + 1], args[i + 2],
                    Path.Combine(Path.GetDirectoryName(args[i + 2]) ?? ".",
                        Path.GetFileNameWithoutExtension(args[i + 2]) + ".diff.png"));
                return;
            }

        string title = "Internet Speed Meter";
        string outDir = ".";
        uint pid = 0;
        Rectangle crop = Rectangle.Empty;
        bool list = args.Contains("--list");
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--title") title = args[++i];
            else if (args[i] == "--out") outDir = args[++i];
            else if (args[i] == "--pid") pid = uint.Parse(args[++i]);
            else if (args[i] == "--crop")
            {
                var n = args[++i].Split(',').Select(int.Parse).ToArray();
                crop = new Rectangle(n[0], n[1], n[2], n[3]);
            }
        }

        if (list) { ListAll(title); return; }

        // Grab a raw screen rectangle: lets a caller capture the same pixels with and
        // without the window present, which is the only honest transparency test.
        var rectArg = Array.IndexOf(args, "--rect");
        if (rectArg >= 0 && rectArg + 1 < args.Length)
        {
            var n = args[rectArg + 1].Split(',').Select(int.Parse).ToArray();
            Directory.CreateDirectory(outDir);
            IntPtr sdc0 = GetDC(IntPtr.Zero);
            IntPtr dc0 = CreateCompatibleDC(sdc0);
            IntPtr b0 = CreateCompatibleBitmap(sdc0, n[2], n[3]);
            IntPtr o0 = SelectObject(dc0, b0);
            BitBlt(dc0, 0, 0, n[2], n[3], sdc0, n[0], n[1], SRCCOPY);
            using (var img = Image.FromHbitmap(b0))
                img.Save(Path.Combine(outDir, "region.png"), ImageFormat.Png);
            SelectObject(dc0, o0); DeleteObject(b0); DeleteDC(dc0); ReleaseDC(IntPtr.Zero, sdc0);
            Console.WriteLine($"region={n[2]}x{n[3]} at ({n[0]},{n[1]}) -> {Path.Combine(outDir, "region.png")}");
            return;
        }

        IntPtr hwnd = Find(title, pid);
        if (hwnd == IntPtr.Zero) { Console.WriteLine("NOT_FOUND " + title); Environment.ExitCode = 2; return; }

        ShowWindow(hwnd, SW_RESTORE);
        SetForegroundWindow(hwnd);
        Thread.Sleep(450);

        GetWindowRect(hwnd, out RECT wr);
        GetClientRect(hwnd, out RECT cr);
        var clientOrigin = new POINT();
        ClientToScreen(hwnd, ref clientOrigin);
        uint dpi = GetDpiForWindow(hwnd);
        DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out RECT frame, Marshal.SizeOf<RECT>());

        int winW = wr.Right - wr.Left, winH = wr.Bottom - wr.Top;
        int clientW = cr.Right - cr.Left, clientH = cr.Bottom - cr.Top;
        double scale = dpi / 96.0;

        Console.WriteLine($"hwnd={hwnd:x} pid={GetWindowThreadProcessId(hwnd, out uint targetPid) } targetPid={targetPid}");
        Console.WriteLine($"probeAwareness={AwarenessName(GetCurrentProcess())}");
        Console.WriteLine($"targetWindowAwareness={WindowAwareness(hwnd)}");
        Console.WriteLine($"dpi={dpi} scale={scale:0.###}");
        Console.WriteLine($"windowRect={winW}x{winH} at ({wr.Left},{wr.Top})");
        Console.WriteLine($"extendedFrame={frame.Right - frame.Left}x{frame.Bottom - frame.Top}");
        Console.WriteLine($"clientRect={clientW}x{clientH} atScreen=({clientOrigin.X},{clientOrigin.Y})");
        Console.WriteLine($"clientCssPx={(scale > 0 ? (clientW / scale).ToString("0.##") : "?")}x{(scale > 0 ? (clientH / scale).ToString("0.##") : "?")}");

        Directory.CreateDirectory(outDir);

        // PrintWindow: works even when the window is partially occluded.
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = CreateCompatibleDC(screenDc);
        IntPtr bmp = CreateCompatibleBitmap(screenDc, winW, winH);
        IntPtr old = SelectObject(memDc, bmp);
        bool ok = PrintWindow(hwnd, memDc, PW_RENDERFULLCONTENT);
        using (var img = Image.FromHbitmap(bmp))
            img.Save(Path.Combine(outDir, "full.png"), ImageFormat.Png);
        SelectObject(memDc, old);
        DeleteObject(bmp);
        DeleteDC(memDc);

        // Crop the client area (or a sub-region of it) out of the full-window bitmap.
        if (ok)
        {
            using var full = new Bitmap(Path.Combine(outDir, "full.png"));
            int ox = Math.Clamp(clientOrigin.X - wr.Left, 0, Math.Max(0, full.Width - 1));
            int oy = Math.Clamp(clientOrigin.Y - wr.Top, 0, Math.Max(0, full.Height - 1));
            var area = new Rectangle(ox + crop.X, oy + crop.Y,
                crop.Width > 0 ? crop.Width : clientW - crop.X,
                crop.Height > 0 ? crop.Height : clientH - crop.Y);
            area.Intersect(new Rectangle(0, 0, full.Width, full.Height));
            using var region = full.Clone(area, PixelFormat.Format32bppArgb);
            region.Save(Path.Combine(outDir, "client.png"), ImageFormat.Png);
            Console.WriteLine($"printWindow=ok saved={region.Width}x{region.Height} client={clientW}x{clientH}");
        }
        else
        {
            // Fallback: grab the client region straight off the screen.
            IntPtr sdc = GetDC(IntPtr.Zero);
            IntPtr dc2 = CreateCompatibleDC(sdc);
            IntPtr b2 = CreateCompatibleBitmap(sdc, clientW, clientH);
            IntPtr o2 = SelectObject(dc2, b2);
            BitBlt(dc2, 0, 0, clientW, clientH, sdc, clientOrigin.X, clientOrigin.Y, SRCCOPY);
            using var img = Image.FromHbitmap(b2);
            img.Save(Path.Combine(outDir, "client.png"), ImageFormat.Png);
            SelectObject(dc2, o2); DeleteObject(b2); DeleteDC(dc2); ReleaseDC(IntPtr.Zero, sdc);
            Console.WriteLine("printWindow=failed usedScreenGrab");
        }

        ReleaseDC(IntPtr.Zero, screenDc);

        // What the desktop actually composites at that rectangle — the only honest test of
        // window transparency (PrintWindow renders the window in isolation).
        if (args.Contains("--screen"))
        {
            IntPtr sdc = GetDC(IntPtr.Zero);
            int fw = frame.Right - frame.Left, fh = frame.Bottom - frame.Top;
            IntPtr dc3 = CreateCompatibleDC(sdc);
            IntPtr b3 = CreateCompatibleBitmap(sdc, fw, fh);
            IntPtr o3 = SelectObject(dc3, b3);
            BitBlt(dc3, 0, 0, fw, fh, sdc, frame.Left, frame.Top, SRCCOPY);
            using (var img = Image.FromHbitmap(b3))
                img.Save(Path.Combine(outDir, "screen.png"), ImageFormat.Png);
            SelectObject(dc3, o3); DeleteObject(b3); DeleteDC(dc3);
            ReleaseDC(IntPtr.Zero, sdc);
            Console.WriteLine($"screenGrab={fw}x{fh}");
        }

        Console.WriteLine($"saved -> {Path.GetFullPath(outDir)}");
    }
}
