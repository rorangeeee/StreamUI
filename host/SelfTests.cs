using System.Runtime.InteropServices;

namespace StreamUI;

internal static class SelfTests
{
    public static int Run(string[] args)
    {
        var checks = new List<string>();
        void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks.Add(name); }
        try
        {
            LayoutSelfTests.Run(Check);
            var analysis = new AudioAnalysis();
            for (int i = 0; i < AudioAnalysis.Size; i++) analysis.Push((float)Math.Sin(2 * Math.PI * 128 * i / AudioAnalysis.Size));
            var frame = analysis.Frame(48000);
            Check(BitConverter.ToUInt32(frame) == AudioAnalysis.Magic && frame.Length == 49168, "binary frame header and length");
            var floats = MemoryMarshal.Cast<byte, float>(frame.AsSpan(16));
            int peak = 0;
            for (int i = 1; i < 4096; i++) if (floats[i] > floats[peak]) peak = i;
            Check(peak == 128, "FFT locates a known sine frequency");
            Check(Math.Abs(floats[4096 + 16] - 1) < .001, "waveform contains the original PCM");
            for (int i = 0; i < AudioAnalysis.Size; i++) analysis.Push(0);
            for (int i = 0; i < 80; i++) frame = analysis.Frame(48000);
            Check(MemoryMarshal.Cast<byte, float>(frame.AsSpan(16))[128] < -100, "silence clears the smoothed spectrum");
            var lowFrequencies = new AudioAnalysis();
            for (int i = 0; i < AudioAnalysis.Size; i++) lowFrequencies.Push((float)(.45 * Math.Sin(2 * Math.PI * 17 * i / AudioAnalysis.Size) + .45 * Math.Sin(2 * Math.PI * 20 * i / AudioAnalysis.Size)));
            var lowBins = MemoryMarshal.Cast<byte, float>(lowFrequencies.Frame(48000).AsSpan(16));
            Check(lowBins[17] > lowBins[16] && lowBins[17] > lowBins[18] && lowBins[20] > lowBins[19] && lowBins[20] > lowBins[21], "48 kHz FFT resolves adjacent low-frequency tones near 100 Hz and 117 Hz");
            bool invalid = false;
            try { (HostSettings.Default with { Audio = new(Gain: double.NaN) }).Validate(); } catch (ArgumentException) { invalid = true; }
            Check(invalid, "non-finite gain is rejected");
            invalid = false;
            try { HostSettings.ValidateLayout(new(["wordmark-window"], new())); } catch (ArgumentException) { invalid = true; }
            Check(invalid, "incomplete layouts are rejected");
            invalid = false;
            try { (HostSettings.Default with { Titles = new() { English = [] } }).Validate(); } catch (ArgumentException) { invalid = true; }
            Check(invalid, "empty title lists cannot break the text animation");
            Check(NowPlayingService.TryParse("{\"title\":\"夜行\\nLATENITE\",\"artist\":\"歌手\",\"playing\":true}", out var playing)
                && playing.Title == "夜行 LATENITE" && playing.Artist == "歌手" && playing.Playing && playing.State == "playing", "automatic track metadata preserves Unicode and normalizes control characters");
            Check(NowPlayingService.TryParse("{\"title\":\"old song\",\"playing\":false,\"state\":\"paused\"}", out var paused)
                && !paused.Playing && paused.Title == "" && paused.State == "paused", "paused tracks cannot leave a stale NOW PLAYING label");
            Check(!NowPlayingService.TryParse("[]", out _) && !NowPlayingService.TryParse("{\"playing\":\"yes\"}", out _), "invalid media metadata is rejected");
            var deviceList = Task.Run(Wasapi.Devices).GetAwaiter().GetResult();
            Check(deviceList.All(d => d.Id.Length > 0 && d.Channels > 0), "WASAPI device enumeration");
            var audio = deviceList.Length > 0 ? VerifyAudioPipeline(deviceList.FirstOrDefault(d => d.IsDefault) ?? deviceList[0], Check).GetAwaiter().GetResult() : null;
            VerifyRuntime(args, Check).GetAwaiter().GetResult();
            var report = new { passed = checks, devices = deviceList, audio };
            var index = Array.IndexOf(args, "--report");
            if (index >= 0 && index + 1 < args.Length) File.WriteAllText(args[index + 1], System.Text.Json.JsonSerializer.Serialize(report, SettingsStore.Json));
            return 0;
        }
        catch (Exception error)
        {
            var index = Array.IndexOf(args, "--report");
            if (index >= 0 && index + 1 < args.Length) File.WriteAllText(args[index + 1], error.ToString());
            return 1;
        }
    }

    private record AudioMetrics(int SampleRate, int DeviceSampleRate, double FramesPerSecond, double IntervalP95Ms);
    private static async Task<AudioMetrics> VerifyAudioPipeline(AudioDevice device, Action<bool, string> check)
    {
        var timestamps = new List<long>();
        var received = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        byte[]? latest = null;
        int warmup = 10;
        var audio = new AudioService();
        audio.Frame += packet =>
        {
            if (warmup-- > 0 || timestamps.Count >= 121) return;
            latest = packet; timestamps.Add(System.Diagnostics.Stopwatch.GetTimestamp());
            if (timestamps.Count == 121) received.TrySetResult();
        };
        AudioStatus final;
        try
        {
            audio.Configure(new(DeviceId: device.Id));
            try { await received.Task.WaitAsync(TimeSpan.FromSeconds(8)); }
            catch (TimeoutException error) { throw new Exception("Audio pipeline timed out: " + audio.Status.Error, error); }
            final = audio.Status;
        }
        finally { audio.Dispose(); }
        var frequency = System.Diagnostics.Stopwatch.Frequency;
        var fps = (timestamps.Count - 1) * (double)frequency / (timestamps[^1] - timestamps[0]);
        var intervals = timestamps.Skip(1).Select((time, i) => (time - timestamps[i]) * 1000.0 / frequency).Order().ToArray();
        var p95 = intervals[(int)(intervals.Length * .95)];
        check(latest is not null && BitConverter.ToInt32(latest, 4) == 48000 && final.SampleRate == 48000, "WASAPI delivers a fixed 48 kHz visualization stream");
        check(final.DeviceSampleRate == device.SampleRate, "visualization resampling preserves the native device rate");
        check(fps is >= 50 and <= 65 && p95 < 30, "audio frames sustain 60 fps without the coarse Windows polling timeout");
        return new(final.SampleRate, final.DeviceSampleRate, Math.Round(fps, 2), Math.Round(p95, 2));
    }

    private static async Task VerifyRuntime(string[] args, Action<bool, string> check)
    {
        var report = Array.IndexOf(args, "--report");
        var baseDirectory = report >= 0 && report + 1 < args.Length ? Path.GetDirectoryName(Path.GetFullPath(args[report + 1]))! : Path.GetTempPath();
        var directory = Path.Combine(baseDirectory, "streamui-runtime-" + Guid.NewGuid().ToString("N"));
        var legacy = Path.Combine(directory, "legacy");
        Directory.CreateDirectory(legacy);
        var oldAudio = new AudioSettings(Enabled: false, Gain: 1.7);
        var oldLaplace = new LaplaceSettings(Enabled: false, Token: "migration-test", StartLocalBridge: false);
        File.WriteAllText(Path.Combine(legacy, "settings.json"), System.Text.Json.JsonSerializer.Serialize(new { audio = oldAudio, laplace = oldLaplace, canvas = new { width = 1920, height = 1080 }, layout = (object?)null }, SettingsStore.Json));
        var migrated = new SettingsStore(legacy);
        check(migrated.Current.Canvas == new CanvasSettings(3840, 2160) && migrated.Current.LayoutVersion == 3 && migrated.Current.Audio == oldAudio && migrated.Current.Laplace == oldLaplace
            && Directory.EnumerateFiles(legacy, "settings.json.before-layout-v3-*").Any(), "layout upgrade backs up old settings and preserves audio / LAPLACE preferences");
        var v2 = Path.Combine(directory, "v2");
        Directory.CreateDirectory(v2);
        var oldTitles = new TitleSettings { English = ["MY STREAM"], Chinese = ["直播测试"] };
        File.WriteAllText(Path.Combine(v2, "settings.json"), System.Text.Json.JsonSerializer.Serialize(HostSettings.Default with { Audio = oldAudio, Laplace = oldLaplace, Canvas = new(2560, 1440), Titles = oldTitles, LayoutVersion = 2 }, SettingsStore.Json));
        var upgraded = new SettingsStore(v2);
        check(upgraded.Current.LayoutVersion == 3 && upgraded.Current.Layout is null && upgraded.Current.Canvas == new CanvasSettings(2560, 1440)
            && upgraded.Current.Audio == oldAudio && upgraded.Current.Laplace == oldLaplace && upgraded.Current.Titles.English.SequenceEqual(oldTitles.English)
            && upgraded.Current.Titles.Chinese.SequenceEqual(oldTitles.Chinese), "v2 migration preserves custom canvas, bilingual titles and connection settings");
        var restarted = new SettingsStore(v2);
        check(restarted.Current.LayoutVersion == 3 && Directory.EnumerateFiles(v2, "settings.json.before-layout-v3-*").Count() == 1, "v3 restarts do not repeat layout migration");
        var store = new SettingsStore(directory);
        await store.Save(HostSettings.Default with { Audio = new(Enabled: false), Laplace = new(Enabled: false) });
        var root = WebAssets.Resolve(directory, null);
        check(File.Exists(Path.Combine(root, "index.html")) && File.Exists(Path.Combine(root, "config.html")), "EXE contains both web pages without an external wwwroot");
        var first = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        var second = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        first.Start(); second.Start();
        var obsPort = ((System.Net.IPEndPoint)first.LocalEndpoint).Port;
        var configPort = ((System.Net.IPEndPoint)second.LocalEndpoint).Port;
        first.Stop(); second.Stop();
        await using var runtime = new HostRuntime(store, root, obsPort, configPort);
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
        await runtime.Start();
        check(runtime.State == ServiceState.Running && (await http.GetStringAsync(runtime.ConfigUrl)).Contains("settings-form"), "tray service starts its HTTP pages");
        using (var state = System.Text.Json.JsonDocument.Parse(await http.GetStringAsync(runtime.ObsUrl + "api/state")))
            check(state.RootElement.TryGetProperty("nowPlaying", out var track) && track.TryGetProperty("playing", out _), "automatic media state is exposed to OBS without manual track settings");
        using var socket = new System.Net.WebSockets.ClientWebSocket();
        await socket.ConnectAsync(new Uri(runtime.ObsUrl.Replace("http:", "ws:") + "ws/audio"), CancellationToken.None);
        var elapsed = System.Diagnostics.Stopwatch.StartNew();
        await runtime.Stop();
        check(runtime.State == ServiceState.Stopped && elapsed.Elapsed < TimeSpan.FromSeconds(3), "tray service stops and closes active browser sockets");
        bool refused = false;
        try { await http.GetStringAsync(runtime.ConfigUrl); } catch (HttpRequestException) { refused = true; }
        check(refused, "stopping releases the HTTP ports");
        await runtime.Start();
        check((await http.GetStringAsync(runtime.ObsUrl)).Contains("workspace"), "tray can start the stopped service again");
        await runtime.Restart();
        check(runtime.State == ServiceState.Running && (await http.GetStringAsync(runtime.ConfigUrl)).Contains("settings-form"), "tray can restart the service");
    }
}
