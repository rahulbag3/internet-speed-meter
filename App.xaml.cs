using System.Globalization;
using System.Windows;

namespace InternetSpeedMeter;

public partial class App : Application
{
    // The card is designed at 580x442 CSS px, which is a lot of desktop to give over
    // permanently, so the widget ships scaled down. Override with --scale=0.4 .. 1.0.
    private const double DefaultScale = 0.6;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Mirrors "Internet Speed Meter (Stacked).bat" (?v=stack).
        bool startsStacked = e.Args.Any(a =>
            a.Equals("--stack", StringComparison.OrdinalIgnoreCase) ||
            a.Equals("/stack", StringComparison.OrdinalIgnoreCase) ||
            a.Equals("stack", StringComparison.OrdinalIgnoreCase));

        // --no-live leaves the card showing only on-demand benchmark results.
        bool live = !e.Args.Any(a => a.Equals("--no-live", StringComparison.OrdinalIgnoreCase));

        double scale = DefaultScale;
        foreach (string arg in e.Args)
        {
            foreach (string prefix in new[] { "--scale=", "/scale:" })
            {
                if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                    && double.TryParse(arg[prefix.Length..], NumberStyles.Float,
                        CultureInfo.InvariantCulture, out double parsed))
                    scale = parsed;
            }
        }

        var window = new MainWindow(startsStacked, scale, live);
        window.Show();
    }
}
