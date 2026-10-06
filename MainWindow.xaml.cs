using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;

namespace InternetSpeedMeter;

public partial class MainWindow : Window
{
    // CSS-pixel viewports of the two HTML launchers:
    //   "Internet Speed Meter.bat"          --window-size=720,560
    //   "Internet Speed Meter (Stacked).bat" --window-size=560,420  (?v=stack)
    private const double SideClientWidth = 720, SideClientHeight = 560;
    private const double StackClientWidth = 560, StackClientHeight = 420;

    // Card box (CSS px) each launcher can show. The expanded card is always the larger of the
    // two modes, so sizing the input plate to it covers compact mode and the transition too.
    private const double SideCardWidth = 580, SideCardHeight = 442;
    private const double StackCardWidth = 210, StackCardHeight = 175;
    private const double CardCornerRadiusCss = 28;

    private readonly double _clientWidth;
    private readonly double _clientHeight;
    private readonly double _cardWidth;
    private readonly double _cardHeight;
    private readonly double _scale;
    private readonly bool _live;
    private readonly string _query;
    private TrafficSampler? _sampler;
    private TrayIcon? _tray;

    public MainWindow(bool startsStacked, double scale, bool live)
    {
        _clientWidth = startsStacked ? StackClientWidth : SideClientWidth;
        _clientHeight = startsStacked ? StackClientHeight : SideClientHeight;
        _cardWidth = startsStacked ? StackCardWidth : SideCardWidth;
        _cardHeight = startsStacked ? StackCardHeight : SideCardHeight;
        _query = startsStacked ? "?v=stack" : string.Empty;
        _scale = Math.Clamp(scale, 0.35, 1.5);
        _live = live;

        InitializeComponent();

        // Page zoom re-renders the card at this fraction, so the layout, breakpoints and every
        // measured value stay identical to the reference while the window gets smaller.
        InputPlate.Width = _cardWidth * _scale;
        InputPlate.Height = _cardHeight * _scale;
        InputPlate.RadiusX = InputPlate.RadiusY = CardCornerRadiusCss * _scale;   // match .card
        Width = _clientWidth * _scale;
        Height = _clientHeight * _scale;
        // Alpha 0 lets the desktop show through the page's transparent padding, so the card
        // and its CSS shadow are the only painted pixels. Input is kept alive by the
        // near-invisible plate in MainWindow.xaml.
        Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0, 0, 0, 0);

        SourceInitialized += (_, _) => FitClientAreaToViewport();
        Loaded += OnLoadedAsync;

        // Built here rather than after navigation so that Exit is reachable even if the
        // WebView2 runtime is missing and the page never loads.
        _tray = new TrayIcon(this);
    }

    /// <summary>Left-clicking the tray icon puts the card out of the way or back in it.</summary>
    public void ToggleCardVisibility()
    {
        if (Visibility == Visibility.Visible) Hide();
        else
        {
            Show();
            Activate();
        }
        _tray?.SetCardVisible(Visibility == Visibility.Visible);
    }

    /// <summary>
    /// Ask the page rather than set Window.Topmost: the pin button owns that state, its LED and
    /// the saved preference. Only if the page never loaded is the window the one that can act.
    /// </summary>
    public void RequestTopmostFromTray()
    {
        if (Web.CoreWebView2 is { } core)
            core.PostWebMessageAsJson(JsonSerializer.Serialize(new { cmd = "topmost", on = !Topmost }));
        else
            SetTopmost(!Topmost);
    }

    private void SetTopmost(bool on)
    {
        Topmost = on;
        _tray?.SetTopmost(on);
    }

    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
    {
        base.OnDpiChanged(oldDpi, newDpi);
        FitClientAreaToViewport();
    }

    private async void OnLoadedAsync(object sender, RoutedEventArgs e)
    {
        string userDataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "InternetSpeedMeter", "WebView2");
        Directory.CreateDirectory(userDataFolder);

        var environment = await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
        await Web.EnsureCoreWebView2Async(environment);

        CoreWebView2 core = Web.CoreWebView2;
        Web.ZoomFactor = _scale;
        core.SetVirtualHostNameToFolderMapping(
            "app.local",
            Path.Combine(AppContext.BaseDirectory, "Assets"),
            CoreWebView2HostResourceAccessKind.Allow);

        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        // Shell behaviour lives outside the reference HTML so that file stays verbatim.
        string shellJs = await File.ReadAllTextAsync(
            Path.Combine(AppContext.BaseDirectory, "Assets", "app-shell.js"));
        await core.AddScriptToExecuteOnDocumentCreatedAsync(shellJs);
        core.WebMessageReceived += (_, args) =>
        {
            string message = args.TryGetWebMessageAsString();
            if (message == "drag") BeginDragFromCard();
            else if (message == "topmost:1") SetTopmost(true);
            else if (message == "topmost:0") SetTopmost(false);
            else if (message.StartsWith("card:", StringComparison.Ordinal)) ResizeInputPlate(message[5..]);
        };

        core.Navigate("https://app.local/speed-meter.html" + _query);

        if (_live)
        {
            _sampler = new TrafficSampler();
            _sampler.Sampled += (rx, tx) => Dispatcher.BeginInvoke(() =>
                core.PostWebMessageAsJson(JsonSerializer.Serialize(new { rx, tx })));
        }
    }

    /// <summary>
    /// Shrinks the input plate to the card's current box. The plate is what makes a layered
    /// window hit-testable, so anywhere it is larger than the card is an invisible rectangle
    /// that eats clicks meant for the desktop.
    /// </summary>
    private void ResizeInputPlate(string csv)
    {
        string[] parts = csv.Split(',');
        if (parts.Length != 2) return;
        if (!double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out double w) ||
            !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out double h)) return;
        if (w <= 0 || h <= 0) return;

        InputPlate.Width = w * _scale;
        InputPlate.Height = h * _scale;
    }

    /// <summary>Hand the drag that started on the card back to the window manager.</summary>
    private void BeginDragFromCard()
    {
        ReleaseCapture();
        SendMessage(new WindowInteropHelper(this).Handle, WM_NCLBUTTONDOWN, HTCAPTION, IntPtr.Zero);
    }

    /// <summary>
    /// The HTML layout keys off the viewport (media queries at 700px and 460px), so the
    /// window is sized by client area rather than outer bounds to keep CSS pixels exact.
    /// Page zoom divides out, so the viewport stays the reference size at any scale.
    /// </summary>
    private void FitClientAreaToViewport()
    {
        IntPtr hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;

        uint dpi = GetDpiForWindow(hwnd);
        double scale = dpi == 0 ? 1d : dpi / 96d;
        int wantW = (int)Math.Round(_clientWidth * scale * _scale);
        int wantH = (int)Math.Round(_clientHeight * scale * _scale);

        if (!GetWindowRect(hwnd, out RECT outer) || !GetClientRect(hwnd, out RECT client)) return;

        int newW = (outer.Right - outer.Left) + (wantW - (client.Right - client.Left));
        int newH = (outer.Bottom - outer.Top) + (wantH - (client.Bottom - client.Top));
        if (newW == outer.Right - outer.Left && newH == outer.Bottom - outer.Top) return;

        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, newW, newH,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }

    protected override void OnClosed(EventArgs e)
    {
        _tray?.Dispose();
        _sampler?.Dispose();
        Web.Dispose();
        base.OnClosed(e);
    }

    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOZORDER = 0x0004;
    private const uint SWP_NOACTIVATE = 0x0010;

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(IntPtr hWnd);

    private const int WM_NCLBUTTONDOWN = 0x00A1;
    private static readonly IntPtr HTCAPTION = new(0x2);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
}
