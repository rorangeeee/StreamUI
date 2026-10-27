using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.Extensions.FileProviders;

namespace StreamUI;

public sealed class HostServer : IAsyncDisposable
{
    private readonly WebApplication app;
    private readonly SettingsStore store;
    private readonly AudioService audio = new();
    private readonly ObsSceneService obs = new();
    private readonly NowPlayingService nowPlaying = new();
    private readonly LaplaceService laplace;
    private readonly SocketHub events = new(WebSocketMessageType.Text, 128);
    private readonly SocketHub frames = new(WebSocketMessageType.Binary, 2);
    private readonly SemaphoreSlim mutations = new(1);
    private readonly int obsPort, configPort;
    public string ObsUrl => $"http://127.0.0.1:{obsPort}/";
    public string ConfigUrl => $"http://127.0.0.1:{configPort}/";
    public event Action? ShutdownRequested;
    private object State() => new { config = store.Current.Public(), audio = audio.Status, laplace = laplace.Status, nowPlaying = nowPlaying.Status, obs = obs.Status, obsUrl = ObsUrl, configUrl = ConfigUrl, startup = WindowsStartup.Enabled };
    private object StateMessage() => new { type = "state", data = State() };
    private void Broadcast() => events.Publish(StateMessage());

    public HostServer(SettingsStore store, string webRoot, int obsPort, int configPort)
    {
        this.store = store; this.obsPort = obsPort; this.configPort = configPort;
        laplace = new(store.DirectoryPath);
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ContentRootPath = AppContext.BaseDirectory, WebRootPath = webRoot });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, obsPort);
            options.Listen(IPAddress.Loopback, configPort);
            options.Limits.MaxRequestBodySize = 64 * 1024;
        });
        app = builder.Build();
        app.Use(async (context, next) =>
        {
            if (context.Request.Host.Host is not ("127.0.0.1" or "localhost") || context.Connection.RemoteIpAddress is not { } remote || !IPAddress.IsLoopback(remote))
            { context.Response.StatusCode = 403; return; }
            var origin = context.Request.Headers.Origin.ToString();
            var allowed = new[] { ObsUrl.TrimEnd('/'), ConfigUrl.TrimEnd('/'), $"http://localhost:{obsPort}", $"http://localhost:{configPort}", "http://127.0.0.1:5173", "http://localhost:5173" };
            if (origin.Length > 0 && !allowed.Contains(origin)) { context.Response.StatusCode = 403; return; }
            var mutation = context.Request.Method is not ("GET" or "HEAD");
            var admin = context.Request.Path.StartsWithSegments("/api/settings") || context.Request.Path.StartsWithSegments("/api/layout")
                || context.Request.Path.StartsWithSegments("/api/audio") || context.Request.Path.StartsWithSegments("/api/laplace")
                || context.Request.Path.StartsWithSegments("/api/startup") || context.Request.Path.StartsWithSegments("/api/open");
            admin |= context.Request.Path == "/api/shutdown";
            if (admin && context.Connection.LocalPort != configPort) { context.Response.StatusCode = 404; return; }
            if (mutation && context.Request.Headers["X-StreamUI-Request"] != "1") { context.Response.StatusCode = 403; return; }
            context.Response.Headers["X-Content-Type-Options"] = "nosniff";
            context.Response.Headers.CacheControl = "no-store";
            try { await next(context); }
            catch (Exception error) when (error is ArgumentException or JsonException or BadHttpRequestException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 400; await context.Response.WriteAsJsonAsync(new { error = error.Message }); } }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException)
            { if (!context.Response.HasStarted) { context.Response.StatusCode = 500; await context.Response.WriteAsJsonAsync(new { error = "操作失败：" + error.Message }); } }
        });
        app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
        app.MapGet("/api/state", () => Results.Json(State(), SettingsStore.Json));
        app.MapGet("/api/settings", () => Results.Json(store.Current, SettingsStore.Json));
        app.MapPut("/api/settings", async (HttpRequest request) =>
        {
            var settings = await request.ReadFromJsonAsync<HostSettings>(SettingsStore.Json) ?? throw new ArgumentException("配置不能为空。");
            settings.Validate();
            await mutations.WaitAsync();
            try
            {
                // Layout has its own endpoint; stale settings forms cannot overwrite a newer layout.
                settings = settings with { Layout = store.Current.Layout, LayoutMode = store.Current.LayoutMode, LayoutProfiles = store.Current.LayoutProfiles };
                var previous = store.Current;
                await store.Save(settings);
                if (settings.Audio != previous.Audio) audio.Configure(settings.Audio);
                if (settings.Laplace != previous.Laplace) await laplace.Configure(settings.Laplace);
                if (settings.Obs != previous.Obs) obs.Configure(settings.Obs);
                Broadcast();
                return Results.Json(State(), SettingsStore.Json);
            }
            finally { mutations.Release(); }
        });
        app.MapPut("/api/layout", async (HttpRequest request) =>
        {
            using var document = await JsonDocument.ParseAsync(request.Body);
            var tagged = document.RootElement.ValueKind == JsonValueKind.Object && document.RootElement.TryGetProperty("mode", out _);
            if (tagged && (document.RootElement.GetProperty("mode").ValueKind != JsonValueKind.String || !document.RootElement.TryGetProperty("layout", out _)))
                throw new ArgumentException("缺少有效的布局类型或布局数据。");
            var mode = tagged ? document.RootElement.GetProperty("mode").GetString() : null;
            var layout = (tagged ? document.RootElement.GetProperty("layout") : document.RootElement).Deserialize<SavedLayout?>(SettingsStore.Json);
            HostSettings.ValidateLayout(layout);
            await mutations.WaitAsync();
            try { await store.Save(store.Current.UpdateLayout(tagged ? mode! : store.Current.LayoutMode, layout)); Broadcast(); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPut("/api/layout-mode", async (HttpRequest request) =>
        {
            var change = await request.ReadFromJsonAsync<LayoutModeRequest>(SettingsStore.Json) ?? throw new ArgumentException("缺少布局类型。");
            await mutations.WaitAsync();
            try { await store.Save(store.Current.SwitchLayout(change.Mode)); Broadcast(); return Results.Json(State(), SettingsStore.Json); }
            finally { mutations.Release(); }
        });
        app.MapGet("/api/audio/devices", async () =>
        {
            try { return Results.Json(await Task.Run(Wasapi.Devices), SettingsStore.Json); }
            catch (Exception error) { return Results.Json(new { error = "无法枚举 Windows 输出设备：" + error.Message }, statusCode: 503); }
        });
        app.MapPost("/api/audio/restart", async () =>
        {
            await mutations.WaitAsync();
            try { audio.Configure(store.Current.Audio); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPost("/api/laplace/reconnect", async () =>
        {
            await mutations.WaitAsync();
            try { await laplace.Configure(store.Current.Laplace); return Results.Ok(); }
            finally { mutations.Release(); }
        });
        app.MapPut("/api/startup", async (HttpRequest request) =>
        {
            var data = await request.ReadFromJsonAsync<StartupRequest>() ?? throw new ArgumentException("缺少启动设置。");
            WindowsStartup.Set(data.Enabled); Broadcast(); return Results.Ok();
        });
        app.MapPost("/api/open/{page}", (string page) =>
        {
            if (page is not ("obs" or "config")) return Results.NotFound();
            Program.Open(page == "obs" ? ObsUrl : ConfigUrl); return Results.Ok();
        });
        app.MapPost("/api/shutdown", (HttpResponse response) =>
        {
            response.OnCompleted(() => { ShutdownRequested?.Invoke(); return Task.CompletedTask; });
            return Results.Accepted();
        });
        app.Map("/ws/events", context => events.Handle(context, StateMessage(), app.Lifetime.ApplicationStopping));
        app.Map("/ws/audio", context => frames.Handle(context, stopping: app.Lifetime.ApplicationStopping));
        var provider = new PhysicalFileProvider(webRoot);
        app.Use(async (context, next) =>
        {
            if (context.Request.Path == "/" || context.Request.Path == "/index.html")
            {
                context.Response.ContentType = "text/html; charset=utf-8";
                await context.Response.SendFileAsync(Path.Combine(webRoot, context.Connection.LocalPort == configPort ? "config.html" : "index.html"));
                return;
            }
            if (context.Request.Path == "/config.html" && context.Connection.LocalPort != configPort) { context.Response.StatusCode = 404; return; }
            await next(context);
        });
        app.UseStaticFiles(new StaticFileOptions { FileProvider = provider });
        audio.Frame += frames.Publish;
        audio.Changed += Broadcast;
        nowPlaying.Changed += Broadcast;
        laplace.Changed += Broadcast;
        laplace.Event += data => events.Publish(new { type = "chat", data });
        obs.Changed += Broadcast;
        obs.SceneChanged += ApplyObsScene;
    }
    public async Task Start()
    {
        await app.StartAsync();
        nowPlaying.Start();
        audio.Configure(store.Current.Audio);
        obs.Configure(store.Current.Obs);
        await laplace.Configure(store.Current.Laplace);
    }
    public async ValueTask DisposeAsync()
    {
        obs.Changed -= Broadcast;
        await obs.DisposeAsync();
        audio.Changed -= Broadcast; laplace.Changed -= Broadcast; nowPlaying.Changed -= Broadcast;
        await nowPlaying.DisposeAsync();
        audio.Dispose(); await laplace.DisposeAsync();
        await app.StopAsync(TimeSpan.FromSeconds(5)); await app.DisposeAsync();
    }
    private record StartupRequest(bool Enabled);
    private record LayoutModeRequest(string Mode);

    private async Task ApplyObsScene(string scene)
    {
        await mutations.WaitAsync();
        try
        {
            var mode = store.Current.Obs.ModeForScene(scene);
            if (mode is null || mode == store.Current.LayoutMode) return;
            await store.Save(store.Current.SwitchLayout(mode)); Broadcast();
        }
        finally { mutations.Release(); }
    }
}
