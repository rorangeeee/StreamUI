using System.Text.Json;
using Microsoft.Win32;

namespace StreamUI;

public record AudioSettings(bool Enabled = true, string DeviceId = "default", int Channel = -1, double Gain = 1);
public record LaplaceSettings(bool Enabled = true, string Url = "ws://localhost:9696", string Token = "", bool StartLocalBridge = true);
public record CanvasSettings(int Width = 3840, int Height = 2160);
public record ObsSettings(string Url = "ws://127.0.0.1:4455", string Password = "", string Scene21 = "", string Scene16 = "")
{
    public bool Enabled => !string.IsNullOrWhiteSpace(Scene21) || !string.IsNullOrWhiteSpace(Scene16);
    public string? ModeForScene(string scene) => !string.IsNullOrWhiteSpace(Scene21) && scene == Scene21.Trim() ? "21:9"
        : !string.IsNullOrWhiteSpace(Scene16) && scene == Scene16.Trim() ? "16:9" : null;
}
public record TitleSettings
{
    public string[] English { get; init; } = ["TITLE"];
    public string[] Chinese { get; init; } = ["标题"];
}
public record PanelRect(double X, double Y, double Width, double Height, double Angle, bool Inverted);
public record SavedLayout(string[] Order, Dictionary<string, PanelRect> Windows);
public record HostSettings(AudioSettings Audio, LaplaceSettings Laplace, CanvasSettings Canvas, SavedLayout? Layout)
{
    public TitleSettings Titles { get; init; } = new();
    public string LayoutMode { get; init; } = "21:9";
    public Dictionary<string, SavedLayout?> LayoutProfiles { get; init; } = new();
    public ObsSettings Obs { get; init; } = new();
    public const int CurrentLayoutVersion = 3;
    public int LayoutVersion { get; init; } = CurrentLayoutVersion;
    public static HostSettings Default => new(new(), new(), new(), null);
    public object Public() => new { Audio, Laplace = Laplace with { Token = "" }, Canvas, Layout, Titles, LayoutVersion, LayoutMode, LayoutProfiles, Obs = Obs with { Password = "" } };
    public static bool IsLayoutMode(string? mode) => mode is "21:9" or "16:9";
    public HostSettings SwitchLayout(string mode)
    {
        if (!IsLayoutMode(mode)) throw new ArgumentException("布局应为 21:9 或 16:9。");
        if (mode == LayoutMode) return this;
        var profiles = new Dictionary<string, SavedLayout?>(LayoutProfiles) { [LayoutMode] = Layout };
        return this with { LayoutMode = mode, Layout = profiles.GetValueOrDefault(mode), LayoutProfiles = profiles };
    }
    public HostSettings UpdateLayout(string mode, SavedLayout? layout)
    {
        if (!IsLayoutMode(mode)) throw new ArgumentException("布局应为 21:9 或 16:9。");
        ValidateLayout(layout);
        var profiles = new Dictionary<string, SavedLayout?>(LayoutProfiles) { [mode] = layout };
        return this with { LayoutProfiles = profiles, Layout = mode == LayoutMode ? layout : Layout };
    }
    public void Validate()
    {
        if (Audio is null || Laplace is null || Canvas is null) throw new ArgumentException("配置不完整。");
        if (Audio.DeviceId is null || Audio.DeviceId.Length > 2048 || Audio.Channel is < -1 or > 31 || !double.IsFinite(Audio.Gain) || Audio.Gain is < 0 or > 4)
            throw new ArgumentException("音频设备、声道或增益无效。");
        if (Canvas.Width is < 640 or > 7680 || Canvas.Height is < 360 or > 4320) throw new ArgumentException("画布尺寸应为 640–7680 × 360–4320。");
        if (Titles is null || new[] { Titles.English, Titles.Chinese }.Any(lines => lines is null || lines.Length is < 1 or > 12 || lines.Any(text => string.IsNullOrWhiteSpace(text) || text.Length > 100 || text.Any(char.IsControl))))
            throw new ArgumentException("中英文标题分别支持 1–12 段文案，每段最多 100 个字符。");
        if (LayoutVersion != CurrentLayoutVersion) throw new ArgumentException("布局版本不匹配，请刷新配置页。");
        if (!IsLayoutMode(LayoutMode) || LayoutProfiles is null || LayoutProfiles.Keys.Any(key => !IsLayoutMode(key)))
            throw new ArgumentException("布局类型无效。");
        foreach (var profile in LayoutProfiles.Values) ValidateLayout(profile);
        if (Obs is null || Obs.Password is null || Obs.Password.Length > 2048 || Obs.Scene21 is null || Obs.Scene16 is null
            || Obs.Scene21.Length > 256 || Obs.Scene16.Length > 256 || Obs.Scene21.Any(char.IsControl) || Obs.Scene16.Any(char.IsControl)
            || !Uri.TryCreate(Obs.Url, UriKind.Absolute, out var obsUrl) || obsUrl.Scheme is not ("ws" or "wss") || !string.IsNullOrEmpty(obsUrl.UserInfo) || obsUrl.Fragment != "")
            throw new ArgumentException("OBS WebSocket 地址、密码或场景名称无效。");
        if (!string.IsNullOrWhiteSpace(Obs.Scene21) && Obs.Scene21.Trim() == Obs.Scene16.Trim())
            throw new ArgumentException("两个布局应使用不同的 OBS 场景名称。");
        if (!Uri.TryCreate(Laplace.Url, UriKind.Absolute, out var url) || url.Scheme is not ("ws" or "wss") || !string.IsNullOrEmpty(url.UserInfo) || url.Fragment != "")
            throw new ArgumentException("LAPLACE 地址必须是有效的 ws:// 或 wss:// 地址。");
        if (Laplace.Token is null || Laplace.Token.Length > 4096 || Laplace.Token.Any(char.IsControl)) throw new ArgumentException("LAPLACE Token 无效。");
        if (Laplace.StartLocalBridge && (!url.IsLoopback || url.Port != 9696 || url.AbsolutePath != "/"))
            throw new ArgumentException("自动启动本地桥接时，地址应为 ws://localhost:9696。连接其他服务请关闭自动启动。");
        ValidateLayout(Layout);
    }
    public static readonly string[] PanelIds = ["stream-window", "spectrogram-window", "waveform-window", "chat-window", "wordmark-window", "wordmark-blur-window"];
    public static void ValidateLayout(SavedLayout? layout)
    {
        if (layout is null) return;
        if (layout.Order is null || layout.Windows is null || !layout.Order.Order().SequenceEqual(PanelIds.Order()) || layout.Windows.Count != PanelIds.Length)
            throw new ArgumentException("布局必须包含全部六个组件，且不能重复。");
        foreach (var id in PanelIds)
        {
            if (!layout.Windows.TryGetValue(id, out var r) || r is null || !new[] { r.X, r.Y, r.Width, r.Height, r.Angle }.All(double.IsFinite)
                || r.X is < -2 or > 2 || r.Y is < -2 or > 2 || r.Width is <= 0 or > 2 || r.Height is <= 0 or > 2 || Math.Abs(r.Angle) > 360)
                throw new ArgumentException("布局坐标无效。");
        }
    }
}

public sealed class SettingsStore
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    public string DirectoryPath { get; }
    public HostSettings Current { get; private set; }
    public SettingsStore(string directory)
    {
        DirectoryPath = Path.GetFullPath(directory);
        Directory.CreateDirectory(DirectoryPath);
        var file = Path.Combine(DirectoryPath, "settings.json");
        try
        {
            var contents = File.Exists(file) ? File.ReadAllText(file) : null;
            Current = contents is not null ? JsonSerializer.Deserialize<HostSettings>(contents, Json) ?? HostSettings.Default : HostSettings.Default;
            bool migrate = false;
            int previousVersion = 0;
            if (contents is not null)
            {
                using var document = JsonDocument.Parse(contents);
                if (document.RootElement.TryGetProperty("layoutVersion", out var version)) previousVersion = version.GetInt32();
                migrate = previousVersion < HostSettings.CurrentLayoutVersion;
            }
            if (migrate) Current = Current with { Canvas = previousVersion < 2 ? new() : Current.Canvas, Layout = null, LayoutVersion = HostSettings.CurrentLayoutVersion };
            Current.Validate();
            if (migrate)
            {
                File.Copy(file, file + ".before-layout-v3-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"), true);
                Save(Current).GetAwaiter().GetResult();
            }
        }
        catch (Exception error) when (error is JsonException or ArgumentException)
        {
            File.Copy(file, file + ".invalid-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"), true);
            Current = HostSettings.Default;
        }
    }
    public async Task Save(HostSettings settings)
    {
        settings.Validate();
        var temporary = Path.Combine(DirectoryPath, "settings.tmp");
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(settings, Json));
        File.Move(temporary, Path.Combine(DirectoryPath, "settings.json"), true);
        Current = settings;
    }
}

public static class WindowsStartup
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "StreamUI Host";
    public static string Arguments { get; set; } = "--no-open";
    public static bool Enabled { get { using var key = Registry.CurrentUser.OpenSubKey(Key); return key?.GetValue(Name) is string; } }
    public static void Set(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(Key);
        if (enabled) key.SetValue(Name, $"\"{Environment.ProcessPath}\" {Arguments}");
        else key.DeleteValue(Name, false);
    }
}
