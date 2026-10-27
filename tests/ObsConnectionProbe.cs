global using System;
global using System.Collections.Generic;
global using System.IO;
global using System.Linq;
global using System.Threading;
global using System.Threading.Tasks;
using System.Text.Json;
using StreamUI;

// A WebSocket client only. This does not start Host, HTTP listeners or a tray icon.
internal static class ObsConnectionProbe
{
    public static async Task Main()
    {
        var options = Environment.GetEnvironmentVariable("STREAMUI_OBS_PROBE_DEFAULTS") == "1" ? new ObsConnectionOptions() : new()
        {
            HandshakeTimeout = TimeSpan.FromMilliseconds(650), ResponseTimeout = TimeSpan.FromMilliseconds(400),
            HealthInterval = TimeSpan.FromMilliseconds(550), RetryDelay = TimeSpan.FromMilliseconds(100),
        };
        await using var obs = new ObsSceneService(options);
        obs.Changed += () => Console.WriteLine(JsonSerializer.Serialize(new { type = "status", data = obs.Status }, SettingsStore.Json).ReplaceLineEndings(""));
        obs.SceneChanged += scene => { Console.WriteLine(JsonSerializer.Serialize(new { type = "scene", scene })); return Task.CompletedTask; };
        while (await Console.In.ReadLineAsync() is { } line)
        {
            var settings = JsonSerializer.Deserialize<ObsSettings>(line, SettingsStore.Json)!;
            obs.Configure(settings);
        }
    }
}
