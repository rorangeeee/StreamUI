using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StreamUI;

public record ObsStatus(string State, string? Scene = null, string? Error = null);

/// <summary>OBS WebSocket v5: observe the program scene, without changing OBS scenes or sources.</summary>
public sealed class ObsSceneService : IAsyncDisposable
{
    private CancellationTokenSource? cancellation;
    private ClientWebSocket? socket;
    private readonly List<(Task Task, CancellationTokenSource Source)> runs = [];
    public ObsStatus Status { get; private set; } = new("disabled");
    public event Action? Changed;
    public event Func<string, Task>? SceneChanged;

    public static string Authentication(string password, string salt, string challenge)
    {
        static string Hash(string text) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
        return Hash(Hash(password + salt) + challenge);
    }

    public void Configure(ObsSettings settings)
    {
        cancellation?.Cancel(); socket?.Abort();
        foreach (var run in runs.Where(run => run.Task.IsCompleted)) run.Source.Dispose();
        runs.RemoveAll(run => run.Task.IsCompleted);
        cancellation = null;
        SetStatus(new(settings.Enabled ? "connecting" : "disabled"));
        if (!settings.Enabled) return;
        var source = new CancellationTokenSource(); cancellation = source;
        runs.Add((Run(settings, source), source));
    }

    private void SetStatus(ObsStatus status)
    {
        if (Status == status) return;
        Status = status; Changed?.Invoke();
    }

    private async Task Run(ObsSettings settings, CancellationTokenSource source)
    {
        var token = source.Token;
        while (!token.IsCancellationRequested)
        {
            using var client = new ClientWebSocket(); socket = client;
            client.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);
            client.Options.KeepAliveTimeout = TimeSpan.FromSeconds(15);
            try
            {
                SetStatus(new("connecting"));
                using (var handshake = CancellationTokenSource.CreateLinkedTokenSource(token))
                {
                    handshake.CancelAfter(TimeSpan.FromSeconds(10));
                    await client.ConnectAsync(new Uri(settings.Url), handshake.Token);
                    using var hello = await Receive(client, handshake.Token);
                    if (hello.RootElement.GetProperty("op").GetInt32() != 0) throw new InvalidDataException("OBS 未返回 WebSocket v5 握手。");
                    var data = hello.RootElement.GetProperty("d");
                    var identify = new Dictionary<string, object> { ["rpcVersion"] = 1, ["eventSubscriptions"] = 6 };
                    if (data.TryGetProperty("authentication", out var auth))
                        identify["authentication"] = Authentication(settings.Password, auth.GetProperty("salt").GetString()!, auth.GetProperty("challenge").GetString()!);
                    await Send(client, new { op = 1, d = identify }, handshake.Token);
                    using var identified = await Receive(client, handshake.Token);
                    if (identified.RootElement.GetProperty("op").GetInt32() != 2) throw new InvalidDataException("OBS WebSocket 身份验证失败。");
                }
                if (token.IsCancellationRequested) break;
                SetStatus(new("connected"));
                var requestId = Guid.NewGuid().ToString("N");
                async Task QueryScene() => await Send(client, new { op = 6, d = new { requestType = "GetCurrentProgramScene", requestId } }, token);
                await QueryScene();
                while (!token.IsCancellationRequested)
                {
                    using var message = await Receive(client, token);
                    var root = message.RootElement;
                    var op = root.GetProperty("op").GetInt32();
                    var data = root.GetProperty("d");
                    string? scene = null;
                    if (op == 5)
                    {
                        var type = data.GetProperty("eventType").GetString();
                        if (type == "CurrentProgramSceneChanged") scene = data.GetProperty("eventData").GetProperty("sceneName").GetString();
                        else if (type == "CurrentSceneCollectionChanging") requestId = Guid.NewGuid().ToString("N");
                        else if (type == "CurrentSceneCollectionChanged") await QueryScene();
                    }
                    else if (op == 7 && data.GetProperty("requestId").GetString() == requestId)
                    {
                        if (!data.GetProperty("requestStatus").GetProperty("result").GetBoolean()) throw new InvalidDataException("OBS 无法读取当前输出场景。");
                        var response = data.GetProperty("responseData");
                        scene = response.TryGetProperty("sceneName", out var name) ? name.GetString()
                            : response.GetProperty("currentProgramSceneName").GetString();
                    }
                    if (scene is null || token.IsCancellationRequested) continue;
                    // A late initial response must not override a newer scene event.
                    if (op == 5) requestId = Guid.NewGuid().ToString("N");
                    SetStatus(new("connected", scene));
                    if (SceneChanged is { } callback) await callback(scene);
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException or JsonException or IOException or KeyNotFoundException or InvalidOperationException)
            {
                if (token.IsCancellationRequested) break;
                var detail = client.CloseStatus == (WebSocketCloseStatus)4009 ? "OBS 密码不正确。" : "OBS 连接失败，请检查 WebSocket 服务、地址和密码。";
                SetStatus(new("reconnecting", Error: detail));
            }
            finally { if (ReferenceEquals(socket, client)) socket = null; }
            try { await Task.Delay(3000, token); } catch (OperationCanceledException) { break; }
        }
    }

    private static async Task Send(ClientWebSocket client, object message, CancellationToken token) =>
        await client.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message), WebSocketMessageType.Text, true, token);

    private static async Task<JsonDocument> Receive(ClientWebSocket client, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var bytes = new byte[4096];
        while (true)
        {
            var result = await client.ReceiveAsync(bytes, token);
            if (result.MessageType == WebSocketMessageType.Close) throw new WebSocketException("OBS 已关闭连接。");
            if (result.MessageType != WebSocketMessageType.Text || buffer.Length + result.Count > 65536) throw new InvalidDataException("OBS 消息格式无效。");
            buffer.Write(bytes, 0, result.Count);
            if (result.EndOfMessage) return JsonDocument.Parse(buffer.ToArray());
        }
    }

    public async ValueTask DisposeAsync()
    {
        cancellation?.Cancel(); socket?.Abort();
        await Task.WhenAll(runs.Select(run => run.Task));
        foreach (var run in runs) run.Source.Dispose();
    }
}
