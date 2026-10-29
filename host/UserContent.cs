using System.Text.Json;
namespace StreamUI;
public sealed class UserContent
{
    public string Root { get; }
    public string Scenes => Path.Combine(Root, "scenes");
    public string Plugins => Path.Combine(Root, "plugins");
    public UserContent(string directory)
    {
        Root = Path.GetFullPath(directory);
        foreach (var name in new[] { "scenes", "plugins", "scene-settings", "plugin-settings" }) Directory.CreateDirectory(Path.Combine(Root, name));
    }
    public void InitializeExamples(string webRoot)
    {
        var source = Path.Combine(webRoot, "examples", "scenes");
        foreach (var id in new[] { "live", "away" })
        {
            var destination = Path.Combine(Scenes, id);
            if (Directory.Exists(destination)) continue;
            Directory.CreateDirectory(destination);
            foreach (var file in Directory.EnumerateFiles(Path.Combine(source, id))) File.Copy(file, Path.Combine(destination, Path.GetFileName(file)));
        }
    }
    private string SettingsPath(string kind, string id)
    {
        if (kind is not ("scene" or "plugin") || !HostSettings.IsId(id)) throw new ArgumentException("设置对象无效。");
        return Path.Combine(Root, kind + "-settings", id + ".json");
    }
    public JsonElement ReadSettings(string kind, string id)
    {
        var path = SettingsPath(kind, id);
        using var document = JsonDocument.Parse(File.Exists(path) ? File.ReadAllText(path) : "{}");
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new ArgumentException("设置应为 JSON 对象。");
        return document.RootElement.Clone();
    }
    public async Task SaveSettings(string kind, string id, JsonElement settings)
    {
        if (settings.ValueKind != JsonValueKind.Object) throw new ArgumentException("设置应为 JSON 对象。");
        var path = SettingsPath(kind, id);
        await File.WriteAllTextAsync(path + ".tmp", settings.GetRawText());
        File.Move(path + ".tmp", path, true);
    }
}
