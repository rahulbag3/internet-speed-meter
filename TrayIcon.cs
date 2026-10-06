using System.IO;
using WF = System.Windows.Forms;

namespace InternetSpeedMeter;

/// <summary>
/// The card has no title bar and, now that it stays out of the task bar, no button either,
/// so the tray icon is the only handle on it once it is hidden. "Keep on top" deliberately
/// routes through the page instead of setting the window style here: the pin button in the
/// card owns that state, persists it and lights its own LED from it, so mirroring the button
/// is what keeps the two controls from disagreeing.
/// </summary>
public sealed class TrayIcon : IDisposable
{
    private readonly MainWindow _window;
    private readonly WF.NotifyIcon _icon;
    private readonly WF.ToolStripMenuItem _showItem;
    private readonly WF.ToolStripMenuItem _topmostItem;

    public TrayIcon(MainWindow window)
    {
        _window = window;

        string iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "app.ico");
        // SmallIconSize is DPI-aware, so the 150% tray picks the 24px frame instead of shrinking 16.
        System.Drawing.Size tray = WF.SystemInformation.SmallIconSize;
        var icon = new System.Drawing.Icon(iconPath, tray.Width, tray.Height);

        _showItem = new WF.ToolStripMenuItem();
        _showItem.Click += (_, _) => _window.ToggleCardVisibility();

        _topmostItem = new WF.ToolStripMenuItem("Keep on top");
        _topmostItem.Click += (_, _) => _window.RequestTopmostFromTray();

        var exitItem = new WF.ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) => _window.Close();

        var menu = new WF.ContextMenuStrip();
        menu.Items.Add(_showItem);
        menu.Items.Add(_topmostItem);
        menu.Items.Add(new WF.ToolStripSeparator());
        menu.Items.Add(exitItem);

        _icon = new WF.NotifyIcon
        {
            Icon = icon,
            Text = "Internet Speed Meter",
            ContextMenuStrip = menu,
            Visible = true,
        };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == WF.MouseButtons.Left) _window.ToggleCardVisibility();
        };

        SetTopmost(window.Topmost);
        SetCardVisible(true);
    }

    public void SetTopmost(bool on) => _topmostItem.Checked = on;

    /// <summary>The menu item names the action it performs, like a media tray icon does.</summary>
    public void SetCardVisible(bool visible) => _showItem.Text = visible ? "Hide card" : "Show card";

    public void Dispose()
    {
        _icon.Visible = false;
        _icon.Dispose();
    }
}
