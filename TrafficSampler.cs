using System.Diagnostics;

namespace InternetSpeedMeter;

/// <summary>
/// Reads the same per-adapter counters the reference server used
/// (\Network Interface(*)\Bytes Received|Sent/sec) and sums them, so the card shows real
/// traffic rather than a synthetic measurement. These counters are already rates, so no
/// sampling window or delta bookkeeping is needed.
/// </summary>
public sealed class TrafficSampler : IDisposable
{
    private const string Category = "Network Interface";
    private const string RxCounter = "Bytes Received/sec";
    private const string TxCounter = "Bytes Sent/sec";

    private readonly PerformanceCounter[] _rx;
    private readonly PerformanceCounter[] _tx;
    private readonly Timer _timer;

    /// <summary>Bytes per second in each direction, delivered on a thread-pool thread.</summary>
    public event Action<double, double>? Sampled;

    public TrafficSampler()
    {
        string[] instances = new PerformanceCounterCategory(Category).GetInstanceNames();
        _rx = instances.Select(i => new PerformanceCounter(Category, RxCounter, i, readOnly: true)).ToArray();
        _tx = instances.Select(i => new PerformanceCounter(Category, TxCounter, i, readOnly: true)).ToArray();
        _timer = new Timer(_ => Publish(), null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }

    private void Publish()
    {
        double rx = 0, tx = 0;
        foreach (PerformanceCounter c in _rx) rx += c.NextValue();
        foreach (PerformanceCounter c in _tx) tx += c.NextValue();
        Sampled?.Invoke(rx, tx);
    }

    public void Dispose() => _timer.Dispose();
}
